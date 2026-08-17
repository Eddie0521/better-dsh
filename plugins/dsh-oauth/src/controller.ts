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

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from 'cordis'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { ProviderOAuthConfig } from './providers.js'

const CALLBACK_HOST = '127.0.0.1'
const CALLBACK_PATH = '/callback'
const TOKEN_SET_VERSION = 1
const MAX_WIRE_JSON_BYTES = 64 * 1024

interface StoredTokenSet {
  readonly version: 1
  readonly accessToken: string
  readonly refreshToken: string
  readonly tokenType: 'Bearer'
  readonly expiresAt: number
  readonly scope?: string
}

interface PendingLogin {
  readonly server: Server
  readonly state: string
  readonly verifier: string
  readonly redirectUri: string
  readonly authorizationUrl: string
  readonly timeout: NodeJS.Timeout
}

interface TokenResponse {
  readonly accessToken: string
  readonly refreshToken?: string
  readonly expiresIn: number
  readonly tokenType: 'Bearer'
  readonly scope?: string
}

interface DeviceCodeResponse {
  readonly deviceCode: string
  readonly userCode: string
  readonly verificationUri: string
  readonly expiresIn: number
  readonly interval: number
}

export class OAuthController {
  private readonly lifetime = new AbortController()
  private pending: PendingLogin | undefined
  private refreshTimer: NodeJS.Timeout | undefined
  private queueTail: Promise<void> = Promise.resolve()
  private tokenSet: StoredTokenSet | undefined

  constructor(
    private readonly ctx: Context,
    private readonly provider: ProviderOAuthConfig,
    private readonly tokenSetRef: CredentialRef,
    private readonly accessTokenRef: CredentialRef,
  ) {}

  // ── lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    const hit = await this.ctx.credentials.resolve(this.tokenSetRef)
    if (hit === undefined) return
    this.tokenSet = this.parseStoredTokenSet(hit.value)
    await this.repairMirror(this.tokenSet)
    this.scheduleRefresh(this.tokenSet)
  }

  dispose(): void {
    this.lifetime.abort()
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer)
    this.refreshTimer = undefined
    void this.stopPending()
  }

  // ── command handler ────────────────────────────────────────────────────

  async command(rawInput: string): Promise<{ kind: 'success' | 'error'; text: string }> {
    const input = rawInput.trim()
    if (input === '' || input === 'status') return { kind: 'success', text: await this.status() }
    if (input === 'login') {
      try {
        if (this.provider.flow === 'device-code') {
          const result = await this.beginDeviceCodeLogin()
          return { kind: 'success', text: result }
        }
        const url = await this.beginPkceLogin()
        return {
          kind: 'success',
          text: [
            `Open this URL to sign in to ${this.provider.label}:`,
            url,
            '',
            'After the browser reports success, run /oauth status to verify.',
          ].join('\n'),
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : `${this.provider.label} OAuth login failed.` }
      }
    }
    if (input === 'logout') {
      try {
        const warning = await this.enqueue(() => this.logout())
        return { kind: 'success', text: warning ?? `${this.provider.label} OAuth credentials removed.` }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : `${this.provider.label} OAuth logout failed.` }
      }
    }
    return { kind: 'error', text: 'Usage: /oauth [login|status|logout]' }
  }

  // ── status ─────────────────────────────────────────────────────────────

  private async status(): Promise<string> {
    if (this.tokenSet === undefined) return `${this.provider.label}: not signed in`
    const expiresAt = new Date(this.tokenSet.expiresAt)
    const remaining = Math.max(0, this.tokenSet.expiresAt - Date.now())
    const minutes = Math.floor(remaining / 60_000)
    return [
      `${this.provider.label}: signed in`,
      `  token expires at ${expiresAt.toISOString()}`,
      `  ${minutes} minute(s) remaining`,
      `  credential ref: ${this.accessTokenRef}`,
    ].join('\n')
  }

  // ── PKCE browser flow ──────────────────────────────────────────────────

  private async beginPkceLogin(): Promise<string> {
    if (this.pending !== undefined) return this.pending.authorizationUrl
    if (this.provider.authorizeUrl === undefined) throw new Error(`${this.provider.label}: no authorize URL configured`)

    const verifier = this.randomBase64Url(32)
    const state = this.randomBase64Url(32)
    const challenge = this.pkceChallenge(verifier)

    const server = createServer((request, response) => {
      void this.handleCallback(request, response).catch(() => {
        if (response.headersSent) response.destroy()
        else this.callbackPage(response, 500, `${this.provider.label} login failed`, 'The local callback failed.')
      })
    })
    server.on('clientError', (_error, socket) => socket.destroy())

    const callbackPort = this.provider.callbackPort ?? 0
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => { reject(error) }
      server.once('error', onError)
      server.listen(callbackPort, CALLBACK_HOST, () => {
        server.off('error', onError)
        resolve()
      })
    })

    const address = server.address() as AddressInfo | null
    if (address === null) {
      await new Promise<void>(resolve => server.close(() => resolve()))
      throw new Error(`${this.provider.label}: loopback callback server did not publish an address`)
    }
    const redirectUri = `http://${CALLBACK_HOST}:${address.port}${CALLBACK_PATH}`

    const authorization = new URL(this.provider.authorizeUrl)
    authorization.searchParams.set('response_type', 'code')
    authorization.searchParams.set('client_id', this.provider.clientId)
    authorization.searchParams.set('redirect_uri', redirectUri)
    authorization.searchParams.set('scope', this.provider.scopes.join(' '))
    authorization.searchParams.set('state', state)
    if (this.provider.pkceRequired) {
      authorization.searchParams.set('code_challenge', challenge)
      authorization.searchParams.set('code_challenge_method', 'S256')
    }

    const timeout = setTimeout(() => {
      if (this.pending?.server !== server) return
      this.pending = undefined
      server.close()
    }, 5 * 60_000)
    timeout.unref()

    this.pending = { server, state, verifier, redirectUri, authorizationUrl: authorization.href, timeout }
    return authorization.href
  }

  private async handleCallback(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pending = this.pending
    if (pending === undefined) {
      this.callbackPage(response, 410, 'Login expired', 'Return to DSH and start a new login.')
      return
    }
    const url = new URL(request.url ?? '/', pending.redirectUri)
    if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
      this.callbackPage(response, 404, 'Not found', '')
      return
    }
    const state = url.searchParams.get('state')
    if (state === null || !this.statesMatch(pending.state, state)) {
      this.callbackPage(response, 400, 'Login rejected', 'The OAuth state value did not match.')
      return
    }
    const providerError = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    this.pending = undefined
    clearTimeout(pending.timeout)
    pending.server.close()
    if (providerError !== null) {
      this.callbackPage(response, 400, 'Login denied', 'Authorization was not completed.')
      return
    }
    if (code === null || code.length === 0) {
      this.callbackPage(response, 400, 'Login rejected', 'The authorization response did not contain a code.')
      return
    }
    try {
      await this.enqueue(async () => {
        const token = await this.exchangeCode(code, pending)
        if (token.refreshToken === undefined) throw new Error(`${this.provider.label} OAuth did not return a refresh token`)
        await this.commitTokenResponse(token, token.refreshToken)
      })
      this.callbackPage(response, 200, `${this.provider.label} connected`, 'Login succeeded. You may close this tab and return to DSH.')
    } catch {
      this.callbackPage(response, 502, `${this.provider.label} login failed`, 'The authorization code could not be exchanged.')
    }
  }

  private async exchangeCode(code: string, pending: PendingLogin): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.provider.clientId,
      code,
      redirect_uri: pending.redirectUri,
    })
    if (this.provider.pkceRequired) body.set('code_verifier', pending.verifier)
    return this.tokenRequest(body)
  }

  // ── device code flow ───────────────────────────────────────────────────

  private async beginDeviceCodeLogin(): Promise<string> {
    if (this.provider.deviceCodeUrl === undefined) throw new Error(`${this.provider.label}: no device code URL configured`)
    const body = new URLSearchParams({
      client_id: this.provider.clientId,
      scope: this.provider.scopes.join(' '),
    })
    const response = await this.fetch(this.provider.deviceCodeUrl, { method: 'POST', body })
    if (!response.ok) throw new Error(`${this.provider.label} device code request failed: ${response.status}`)
    const data = JSON.parse(await response.text()) as DeviceCodeResponse
    const pollPromise = this.pollDeviceCode(data.deviceCode, data.interval, data.expiresIn)
    pollPromise.then(token => {
      if (token !== undefined) {
        void this.enqueue(async () => {
          await this.commitTokenResponse(token, token.refreshToken ?? '')
        })
      }
    }).catch(error => {
      this.ctx.logger.warn(`${this.provider.label}: device code polling failed: ${error}`)
    })
    return [
      `To sign in to ${this.provider.label}, open this URL in your browser:`,
      data.verificationUri,
      `Enter code: ${data.userCode}`,
      '',
      'Waiting for authorization... run /oauth status to check.',
    ].join('\n')
  }

  private async pollDeviceCode(deviceCode: string, interval: number, expiresIn: number): Promise<TokenResponse | undefined> {
    const deadline = Date.now() + expiresIn * 1000
    const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
    while (Date.now() < deadline) {
      if (this.lifetime.signal.aborted) return undefined
      await sleep(interval * 1000)
      const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: this.provider.clientId,
        device_code: deviceCode,
      })
      try {
        const response = await this.fetch(this.provider.tokenUrl, { method: 'POST', body })
        const text = await response.text()
        const data = JSON.parse(text)
        if (response.ok) {
          return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in ?? 3600,
            tokenType: data.token_type ?? 'Bearer',
            scope: data.scope,
          }
        }
        if (data.error === 'authorization_pending' || data.error === 'slow_down') continue
        if (data.error === 'expired_token') return undefined
        throw new Error(`${data.error}: ${data.error_description ?? 'device code flow failed'}`)
      } catch {
        continue
      }
    }
    return undefined
  }

  // ── token refresh ──────────────────────────────────────────────────────

  private async refresh(): Promise<void> {
    const current = this.tokenSet
    if (current === undefined) return
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.provider.clientId,
      refresh_token: current.refreshToken,
    })
    const token = await this.tokenRequest(body)
    await this.commitTokenResponse(token, token.refreshToken ?? current.refreshToken)
  }

  private scheduleRefresh(tokenSet: StoredTokenSet): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer)
    const delay = Math.max(0, tokenSet.expiresAt - Date.now() - 60_000)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      void this.enqueue(() => this.refresh()).catch(() => {
        this.refreshTimer = setTimeout(() => {
          this.refreshTimer = undefined
          void this.enqueue(() => this.refresh()).catch(() => {})
        }, 30_000)
      })
    }, Math.min(delay, 2_147_483_647))
    this.refreshTimer.unref()
  }

  // ── credential storage (dual-write) ────────────────────────────────────

  private async commitTokenResponse(token: TokenResponse, refreshToken: string): Promise<void> {
    const expiresAt = Math.round(Date.now() + token.expiresIn * 1000)
    const next: StoredTokenSet = Object.freeze({
      version: TOKEN_SET_VERSION,
      accessToken: token.accessToken,
      refreshToken,
      tokenType: token.tokenType,
      expiresAt,
      ...(token.scope !== undefined ? { scope: token.scope } : {}),
    })
    await this.ctx.credentials.set(this.tokenSetRef, JSON.stringify(next))
    this.tokenSet = next
    await this.ctx.credentials.set(this.accessTokenRef, next.accessToken)
    this.scheduleRefresh(next)
  }

  private async repairMirror(tokenSet: StoredTokenSet): Promise<void> {
    const mirror = await this.ctx.credentials.resolve(this.accessTokenRef)
    if (mirror?.value === tokenSet.accessToken) return
    await this.ctx.credentials.set(this.accessTokenRef, tokenSet.accessToken)
  }

  // ── logout ─────────────────────────────────────────────────────────────

  private async logout(): Promise<string | undefined> {
    await this.stopPending()
    const current = this.tokenSet
    let warning: string | undefined
    if (current !== undefined && this.provider.revokeUrl !== undefined) {
      try {
        const response = await this.fetch(this.provider.revokeUrl, {
          method: 'POST',
          body: new URLSearchParams({
            client_id: this.provider.clientId,
            token: current.refreshToken,
            token_type_hint: 'refresh_token',
          }),
        })
        if (!response.ok) warning = `${this.provider.label} credentials removed locally; remote revocation returned HTTP ${response.status}.`
      } catch {
        warning = `${this.provider.label} credentials removed locally; remote revocation could not be confirmed.`
      }
    }
    if (current !== undefined) {
      const mirror = await this.ctx.credentials.resolve(this.accessTokenRef)
      if (mirror?.value === current.accessToken) await this.ctx.credentials.unset(this.accessTokenRef)
    }
    await this.ctx.credentials.unset(this.tokenSetRef)
    this.tokenSet = undefined
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer)
    this.refreshTimer = undefined
    return warning
  }

  // ── HTTP ───────────────────────────────────────────────────────────────

  private async tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
    const response = await this.fetch(this.provider.tokenUrl, { method: 'POST', body })
    const text = await response.text()
    if (!response.ok) throw new Error(`${this.provider.label} token endpoint returned ${response.status}: ${text}`)
    const data = JSON.parse(text)
    if (data.access_token === undefined) throw new Error(`${this.provider.label} token response missing access_token`)
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in ?? 3600,
      tokenType: data.token_type ?? 'Bearer',
      scope: data.scope,
    }
  }

  private async fetch(input: string, init?: { method?: string; body?: URLSearchParams }): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(30_000)])
    const headers: Record<string, string> = { 'Accept': 'application/json' }
    if (init?.body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded'
    const response = await fetch(input, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body?.toString(),
      signal,
    })
    return { ok: response.ok, status: response.status, text: () => response.text() }
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private randomBase64Url(bytes: number): string {
    return randomBytes(bytes).toString('base64url')
  }

  private pkceChallenge(verifier: string): string {
    return createHash('sha256').update(verifier, 'ascii').digest('base64url')
  }

  private statesMatch(expected: string, received: string): boolean {
    const a = Buffer.from(expected)
    const b = Buffer.from(received)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private parseStoredTokenSet(raw: string): StoredTokenSet {
    const parsed = JSON.parse(raw)
    if (parsed.version !== TOKEN_SET_VERSION) throw new Error(`${this.provider.label}: stored token set version mismatch`)
    return Object.freeze(parsed)
  }

  private callbackPage(response: ServerResponse, status: number, title: string, message: string): void {
    response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${message}</p></body></html>`)
  }

  private async stopPending(): Promise<void> {
    if (this.pending === undefined) return
    clearTimeout(this.pending.timeout)
    this.pending.server.close()
    this.pending = undefined
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queueTail.then(operation)
    this.queueTail = run.then(() => {}, () => {})
    return run
  }
}
