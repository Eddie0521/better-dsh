import { credentialRef } from "@deepseek-ai/dsh-credentials";
import z from "@deepseek-ai/schemastery";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
//#region src/controller.ts
/**
* OAuth controller: manages the PKCE / device-code login flow, token
* persistence, automatic refresh, and logout for one provider.
*
* Token storage uses DSH's credential store (ctx.credentials) with a
* dual-write strategy (same as ZenMux):
*   1. tokenSetRef — full versioned token set (access + refresh + expiry)
*   2. credentialRef — raw access token mirror (what pi-ai adapter reads)
*
* The pi-ai adapter does not know or care that the token came from OAuth —
* it just reads the credentialRef via apiKeyEnv.
*/
const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PATH = "/callback";
const TOKEN_SET_VERSION = 1;
var OAuthController = class {
	ctx;
	provider;
	tokenSetRef;
	accessTokenRef;
	lifetime = new AbortController();
	pending;
	refreshTimer;
	queueTail = Promise.resolve();
	tokenSet;
	constructor(ctx, provider, tokenSetRef, accessTokenRef) {
		this.ctx = ctx;
		this.provider = provider;
		this.tokenSetRef = tokenSetRef;
		this.accessTokenRef = accessTokenRef;
	}
	async start() {
		const hit = await this.ctx.credentials.resolve(this.tokenSetRef);
		if (hit === void 0) return;
		this.tokenSet = this.parseStoredTokenSet(hit.value);
		await this.repairMirror(this.tokenSet);
		this.scheduleRefresh(this.tokenSet);
	}
	dispose() {
		this.lifetime.abort();
		if (this.refreshTimer !== void 0) clearTimeout(this.refreshTimer);
		this.refreshTimer = void 0;
		this.stopPending();
	}
	async command(rawInput) {
		const input = rawInput.trim();
		if (input === "" || input === "status") return {
			kind: "success",
			text: await this.status()
		};
		if (input === "login") try {
			if (this.provider.flow === "device-code") return {
				kind: "success",
				text: await this.beginDeviceCodeLogin()
			};
			const url = await this.beginPkceLogin();
			return {
				kind: "success",
				text: [
					`Open this URL to sign in to ${this.provider.label}:`,
					url,
					"",
					"After the browser reports success, run /oauth status to verify."
				].join("\n")
			};
		} catch (error) {
			return {
				kind: "error",
				text: error instanceof Error ? error.message : `${this.provider.label} OAuth login failed.`
			};
		}
		if (input === "logout") try {
			return {
				kind: "success",
				text: await this.enqueue(() => this.logout()) ?? `${this.provider.label} OAuth credentials removed.`
			};
		} catch (error) {
			return {
				kind: "error",
				text: error instanceof Error ? error.message : `${this.provider.label} OAuth logout failed.`
			};
		}
		return {
			kind: "error",
			text: "Usage: /oauth [login|status|logout]"
		};
	}
	async status() {
		if (this.tokenSet === void 0) return `${this.provider.label}: not signed in`;
		const expiresAt = new Date(this.tokenSet.expiresAt);
		const remaining = Math.max(0, this.tokenSet.expiresAt - Date.now());
		const minutes = Math.floor(remaining / 6e4);
		return [
			`${this.provider.label}: signed in`,
			`  token expires at ${expiresAt.toISOString()}`,
			`  ${minutes} minute(s) remaining`,
			`  credential ref: ${this.accessTokenRef}`
		].join("\n");
	}
	async beginPkceLogin() {
		if (this.pending !== void 0) return this.pending.authorizationUrl;
		if (this.provider.authorizeUrl === void 0) throw new Error(`${this.provider.label}: no authorize URL configured`);
		const verifier = this.randomBase64Url(32);
		const state = this.randomBase64Url(32);
		const challenge = this.pkceChallenge(verifier);
		const server = createServer((request, response) => {
			this.handleCallback(request, response).catch(() => {
				if (response.headersSent) response.destroy();
				else this.callbackPage(response, 500, `${this.provider.label} login failed`, "The local callback failed.");
			});
		});
		server.on("clientError", (_error, socket) => socket.destroy());
		const callbackPort = this.provider.callbackPort ?? 0;
		await new Promise((resolve, reject) => {
			const onError = (error) => {
				reject(error);
			};
			server.once("error", onError);
			server.listen(callbackPort, CALLBACK_HOST, () => {
				server.off("error", onError);
				resolve();
			});
		});
		const address = server.address();
		if (address === null) {
			await new Promise((resolve) => server.close(() => resolve()));
			throw new Error(`${this.provider.label}: loopback callback server did not publish an address`);
		}
		const redirectUri = `http://${CALLBACK_HOST}:${address.port}${CALLBACK_PATH}`;
		const authorization = new URL(this.provider.authorizeUrl);
		authorization.searchParams.set("response_type", "code");
		authorization.searchParams.set("client_id", this.provider.clientId);
		authorization.searchParams.set("redirect_uri", redirectUri);
		authorization.searchParams.set("scope", this.provider.scopes.join(" "));
		authorization.searchParams.set("state", state);
		if (this.provider.pkceRequired) {
			authorization.searchParams.set("code_challenge", challenge);
			authorization.searchParams.set("code_challenge_method", "S256");
		}
		const timeout = setTimeout(() => {
			if (this.pending?.server !== server) return;
			this.pending = void 0;
			server.close();
		}, 3e5);
		timeout.unref();
		this.pending = {
			server,
			state,
			verifier,
			redirectUri,
			authorizationUrl: authorization.href,
			timeout
		};
		return authorization.href;
	}
	async handleCallback(request, response) {
		const pending = this.pending;
		if (pending === void 0) {
			this.callbackPage(response, 410, "Login expired", "Return to DSH and start a new login.");
			return;
		}
		const url = new URL(request.url ?? "/", pending.redirectUri);
		if (request.method !== "GET" || url.pathname !== CALLBACK_PATH) {
			this.callbackPage(response, 404, "Not found", "");
			return;
		}
		const state = url.searchParams.get("state");
		if (state === null || !this.statesMatch(pending.state, state)) {
			this.callbackPage(response, 400, "Login rejected", "The OAuth state value did not match.");
			return;
		}
		const providerError = url.searchParams.get("error");
		const code = url.searchParams.get("code");
		this.pending = void 0;
		clearTimeout(pending.timeout);
		pending.server.close();
		if (providerError !== null) {
			this.callbackPage(response, 400, "Login denied", "Authorization was not completed.");
			return;
		}
		if (code === null || code.length === 0) {
			this.callbackPage(response, 400, "Login rejected", "The authorization response did not contain a code.");
			return;
		}
		try {
			await this.enqueue(async () => {
				const token = await this.exchangeCode(code, pending);
				if (token.refreshToken === void 0) throw new Error(`${this.provider.label} OAuth did not return a refresh token`);
				await this.commitTokenResponse(token, token.refreshToken);
			});
			this.callbackPage(response, 200, `${this.provider.label} connected`, "Login succeeded. You may close this tab and return to DSH.");
		} catch {
			this.callbackPage(response, 502, `${this.provider.label} login failed`, "The authorization code could not be exchanged.");
		}
	}
	async exchangeCode(code, pending) {
		const body = new URLSearchParams({
			grant_type: "authorization_code",
			client_id: this.provider.clientId,
			code,
			redirect_uri: pending.redirectUri
		});
		if (this.provider.pkceRequired) body.set("code_verifier", pending.verifier);
		return this.tokenRequest(body);
	}
	async beginDeviceCodeLogin() {
		if (this.provider.deviceCodeUrl === void 0) throw new Error(`${this.provider.label}: no device code URL configured`);
		const body = new URLSearchParams({
			client_id: this.provider.clientId,
			scope: this.provider.scopes.join(" ")
		});
		const response = await this.fetch(this.provider.deviceCodeUrl, {
			method: "POST",
			body
		});
		if (!response.ok) throw new Error(`${this.provider.label} device code request failed: ${response.status}`);
		const data = JSON.parse(await response.text());
		this.pollDeviceCode(data.deviceCode, data.interval, data.expiresIn).then((token) => {
			if (token !== void 0) this.enqueue(async () => {
				await this.commitTokenResponse(token, token.refreshToken ?? "");
			});
		}).catch((error) => {
			this.ctx.logger.warn(`${this.provider.label}: device code polling failed: ${error}`);
		});
		return [
			`To sign in to ${this.provider.label}, open this URL in your browser:`,
			data.verificationUri,
			`Enter code: ${data.userCode}`,
			"",
			"Waiting for authorization... run /oauth status to check."
		].join("\n");
	}
	async pollDeviceCode(deviceCode, interval, expiresIn) {
		const deadline = Date.now() + expiresIn * 1e3;
		const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		while (Date.now() < deadline) {
			if (this.lifetime.signal.aborted) return void 0;
			await sleep(interval * 1e3);
			const body = new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				client_id: this.provider.clientId,
				device_code: deviceCode
			});
			try {
				const response = await this.fetch(this.provider.tokenUrl, {
					method: "POST",
					body
				});
				const text = await response.text();
				const data = JSON.parse(text);
				if (response.ok) return {
					accessToken: data.access_token,
					refreshToken: data.refresh_token,
					expiresIn: data.expires_in ?? 3600,
					tokenType: data.token_type ?? "Bearer",
					scope: data.scope
				};
				if (data.error === "authorization_pending" || data.error === "slow_down") continue;
				if (data.error === "expired_token") return void 0;
				throw new Error(`${data.error}: ${data.error_description ?? "device code flow failed"}`);
			} catch {
				continue;
			}
		}
	}
	async refresh() {
		const current = this.tokenSet;
		if (current === void 0) return;
		const body = new URLSearchParams({
			grant_type: "refresh_token",
			client_id: this.provider.clientId,
			refresh_token: current.refreshToken
		});
		const token = await this.tokenRequest(body);
		await this.commitTokenResponse(token, token.refreshToken ?? current.refreshToken);
	}
	scheduleRefresh(tokenSet) {
		if (this.refreshTimer !== void 0) clearTimeout(this.refreshTimer);
		const delay = Math.max(0, tokenSet.expiresAt - Date.now() - 6e4);
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = void 0;
			this.enqueue(() => this.refresh()).catch(() => {
				this.refreshTimer = setTimeout(() => {
					this.refreshTimer = void 0;
					this.enqueue(() => this.refresh()).catch(() => {});
				}, 3e4);
			});
		}, Math.min(delay, 2147483647));
		this.refreshTimer.unref();
	}
	async commitTokenResponse(token, refreshToken) {
		const expiresAt = Math.round(Date.now() + token.expiresIn * 1e3);
		const next = Object.freeze({
			version: TOKEN_SET_VERSION,
			accessToken: token.accessToken,
			refreshToken,
			tokenType: token.tokenType,
			expiresAt,
			...token.scope !== void 0 ? { scope: token.scope } : {}
		});
		await this.ctx.credentials.set(this.tokenSetRef, JSON.stringify(next));
		this.tokenSet = next;
		await this.ctx.credentials.set(this.accessTokenRef, next.accessToken);
		this.scheduleRefresh(next);
	}
	async repairMirror(tokenSet) {
		if ((await this.ctx.credentials.resolve(this.accessTokenRef))?.value === tokenSet.accessToken) return;
		await this.ctx.credentials.set(this.accessTokenRef, tokenSet.accessToken);
	}
	async logout() {
		await this.stopPending();
		const current = this.tokenSet;
		let warning;
		if (current !== void 0 && this.provider.revokeUrl !== void 0) try {
			const response = await this.fetch(this.provider.revokeUrl, {
				method: "POST",
				body: new URLSearchParams({
					client_id: this.provider.clientId,
					token: current.refreshToken,
					token_type_hint: "refresh_token"
				})
			});
			if (!response.ok) warning = `${this.provider.label} credentials removed locally; remote revocation returned HTTP ${response.status}.`;
		} catch {
			warning = `${this.provider.label} credentials removed locally; remote revocation could not be confirmed.`;
		}
		if (current !== void 0) {
			if ((await this.ctx.credentials.resolve(this.accessTokenRef))?.value === current.accessToken) await this.ctx.credentials.unset(this.accessTokenRef);
		}
		await this.ctx.credentials.unset(this.tokenSetRef);
		this.tokenSet = void 0;
		if (this.refreshTimer !== void 0) clearTimeout(this.refreshTimer);
		this.refreshTimer = void 0;
		return warning;
	}
	async tokenRequest(body) {
		const response = await this.fetch(this.provider.tokenUrl, {
			method: "POST",
			body
		});
		const text = await response.text();
		if (!response.ok) throw new Error(`${this.provider.label} token endpoint returned ${response.status}: ${text}`);
		const data = JSON.parse(text);
		if (data.access_token === void 0) throw new Error(`${this.provider.label} token response missing access_token`);
		return {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresIn: data.expires_in ?? 3600,
			tokenType: data.token_type ?? "Bearer",
			scope: data.scope
		};
	}
	async fetch(input, init) {
		const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(3e4)]);
		const headers = { "Accept": "application/json" };
		if (init?.body !== void 0) headers["Content-Type"] = "application/x-www-form-urlencoded";
		const response = await fetch(input, {
			method: init?.method ?? "GET",
			headers,
			body: init?.body?.toString(),
			signal
		});
		return {
			ok: response.ok,
			status: response.status,
			text: () => response.text()
		};
	}
	randomBase64Url(bytes) {
		return randomBytes(bytes).toString("base64url");
	}
	pkceChallenge(verifier) {
		return createHash("sha256").update(verifier, "ascii").digest("base64url");
	}
	statesMatch(expected, received) {
		const a = Buffer.from(expected);
		const b = Buffer.from(received);
		return a.length === b.length && timingSafeEqual(a, b);
	}
	parseStoredTokenSet(raw) {
		const parsed = JSON.parse(raw);
		if (parsed.version !== TOKEN_SET_VERSION) throw new Error(`${this.provider.label}: stored token set version mismatch`);
		return Object.freeze(parsed);
	}
	callbackPage(response, status, title, message) {
		response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
		response.end(`<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${message}</p></body></html>`);
	}
	async stopPending() {
		if (this.pending === void 0) return;
		clearTimeout(this.pending.timeout);
		this.pending.server.close();
		this.pending = void 0;
	}
	enqueue(operation) {
		const run = this.queueTail.then(operation);
		this.queueTail = run.then(() => {}, () => {});
		return run;
	}
};
//#endregion
//#region src/providers.ts
/** Built-in provider OAuth configurations. */
const builtinProviders = {
	anthropic: {
		label: "Anthropic (Claude Pro/Max)",
		flow: "pkce",
		credentialRef: "ANTHROPIC_OAUTH_ACCESS_TOKEN",
		authorizeUrl: "https://claude.ai/oauth/authorize",
		tokenUrl: "https://platform.claude.com/v1/oauth/token",
		revokeUrl: "https://platform.claude.com/v1/oauth/revoke",
		clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
		scopes: [
			"org:create_api_key",
			"user:profile",
			"user:inference",
			"user:sessions:claude_code",
			"user:mcp_servers",
			"user:file_upload"
		],
		pkceRequired: true,
		callbackPort: 53692
	},
	openrouter: {
		label: "OpenRouter",
		flow: "pkce",
		credentialRef: "OPENROUTER_OAUTH_ACCESS_TOKEN",
		authorizeUrl: "https://openrouter.ai/login",
		tokenUrl: "https://openrouter.ai/api/v1/auth/keys",
		clientId: "dsh-oauth",
		scopes: [
			"openid",
			"profile",
			"email"
		],
		pkceRequired: false
	},
	"github-copilot": {
		label: "GitHub Copilot",
		flow: "device-code",
		credentialRef: "GITHUB_COPILOT_OAUTH_ACCESS_TOKEN",
		deviceCodeUrl: "https://github.com/login/device/code",
		tokenUrl: "https://github.com/login/oauth/access_token",
		clientId: "Iv1.b507a4d6c5e3f8e2",
		scopes: ["read:user", "copilot"],
		pkceRequired: false
	},
	"openai-codex": {
		label: "OpenAI Codex",
		flow: "pkce",
		credentialRef: "OPENAI_OAUTH_ACCESS_TOKEN",
		authorizeUrl: "https://platform.openai.com/oauth/authorize",
		tokenUrl: "https://platform.openai.com/oauth/token",
		clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
		scopes: [
			"openid",
			"profile",
			"email",
			"offline_access"
		],
		pkceRequired: true
	},
	xai: {
		label: "xAI (Grok)",
		flow: "pkce",
		credentialRef: "XAI_OAUTH_ACCESS_TOKEN",
		authorizeUrl: "https://x.ai/oauth/authorize",
		tokenUrl: "https://x.ai/oauth/token",
		clientId: "dsh-oauth",
		scopes: ["openid", "profile"],
		pkceRequired: true
	}
};
/** Get a provider config by name, or undefined if not found. */
function getProvider(name) {
	return builtinProviders[name];
}
/** List all available provider names. */
function listProviderNames() {
	return Object.keys(builtinProviders);
}
//#endregion
//#region src/index.ts
const name = "dsh-oauth";
const inject = ["commands", "credentials"];
const Config = z.object({ provider: z.string().default("anthropic").description("OAuth provider name: " + listProviderNames().join(", ")) });
const controllers = /* @__PURE__ */ new Map();
async function apply(ctx, config) {
	const providerName = config.provider;
	const provider = getProvider(providerName);
	if (provider === void 0) {
		ctx.logger.error(`dsh-oauth: unknown provider "${providerName}". Available: ${listProviderNames().join(", ")}`);
		return;
	}
	const controller = new OAuthController(ctx, provider, credentialRef(`${providerName.toUpperCase().replace(/-/g, "_")}_OAUTH_TOKENS`), credentialRef(provider.credentialRef));
	controllers.set(providerName, controller);
	await controller.start();
	ctx.effect(() => () => {
		controller.dispose();
		controllers.delete(providerName);
	}, "dsh-oauth.lifecycle");
	ctx.commands.register({
		name: "oauth",
		description: `OAuth login for ${provider.label} (login, status, logout)`,
		input: { hint: "[login|status|logout]" },
		handler: (invocation) => controller.command(invocation.rawInput)
	});
}
//#endregion
export { Config, apply, inject, name };
