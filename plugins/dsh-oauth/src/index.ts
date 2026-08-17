/**
 * dsh-oauth — bring pi-ai's OAuth capability into DSH.
 *
 * Registers an "OAuth 提供方" section in Settings with provider selection,
 * login button, status display, and model catalog. Also provides /oauth
 * [login|status|logout] command and HTTP API for the client component.
 *
 * After login, the access token is mirrored into a credential ref that
 * pi-ai adapter reads via apiKeyEnv — no adapter changes needed.
 */

import type { Context } from 'cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { OAuthController } from './controller.js'
import { builtinProviders, getProvider, listProviderNames, getProviderModels, type ProviderOAuthConfig } from './providers.js'

export const name = 'dsh-oauth'
export const inject = ['commands', 'credentials', 'webServer']

// Controllers keyed by provider name
const controllers = new Map<string, OAuthController>()

function providerCredentialRef(providerName: string): string {
  const provider = getProvider(providerName)
  return provider?.credentialRef ?? `${providerName.toUpperCase().replace(/-/g, '_')}_OAUTH_ACCESS_TOKEN`
}

function providerTokenSetRef(providerName: string): string {
  return `${providerName.toUpperCase().replace(/-/g, '_')}_OAUTH_TOKENS`
}

export async function apply(ctx: Context): Promise<void> {
  // Initialize controllers for all built-in providers
  for (const providerName of listProviderNames()) {
    const provider = getProvider(providerName)!
    const tokenSetRef = credentialRef(providerTokenSetRef(providerName))
    const accessTokenRef = credentialRef(provider.credentialRef)
    const controller = new OAuthController(ctx, provider, tokenSetRef, accessTokenRef)
    controllers.set(providerName, controller)
    await controller.start()
    ctx.effect(() => () => {
      controller.dispose()
      controllers.delete(providerName)
    }, `dsh-oauth.${providerName}.lifecycle`)
  }

  // ── HTTP API for the client component ──────────────────────────────────

  // List all OAuth providers with login status
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/oauth/api/providers',
    handler: async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return }
      const list = listProviderNames().map(name => ({
        name,
        label: getProvider(name)!.label,
        flow: getProvider(name)!.flow,
        loggedIn: controllers.get(name)?.isLoggedIn() ?? false,
        credentialRef: providerCredentialRef(name),
      }))
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(list))
    },
  }), 'dsh-oauth: providers route')

  // Login a specific provider
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/oauth/api/login',
    handler: async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return }
      const body = await readBody(req)
      const { provider } = JSON.parse(body || '{}') as { provider?: string }
      if (provider === undefined || !controllers.has(provider)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Unknown provider' }))
        return
      }
      try {
        const controller = controllers.get(provider)!
        const result = await controller.command('login')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: result.kind === 'success', text: result.text }))
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
      }
    },
  }), 'dsh-oauth: login route')

  // Logout a specific provider
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/oauth/api/logout',
    handler: async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return }
      const body = await readBody(req)
      const { provider } = JSON.parse(body || '{}') as { provider?: string }
      if (provider === undefined || !controllers.has(provider)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Unknown provider' }))
        return
      }
      try {
        const controller = controllers.get(provider)!
        const result = await controller.command('logout')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: result.kind === 'success', text: result.text }))
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
      }
    },
  }), 'dsh-oauth: logout route')

  // Get models for a provider (from pi-ai catalog)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/oauth/api/models',
    handler: async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return }
      const url = new URL(req.url ?? '/oauth/api/models', 'http://localhost')
      const provider = url.searchParams.get('provider')
      if (provider === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Missing provider parameter' }))
        return
      }
      const models = await getProviderModels(provider)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ ok: true, models }))
    },
  }), 'dsh-oauth: models route')

  // ── /oauth command (uses first logged-in provider or default) ──────────

  ctx.commands.register({
    name: 'oauth',
    description: 'OAuth login for pi-ai providers (login, status, logout)',
    input: { hint: '[login|status|logout] [provider]' },
    handler: (invocation) => {
      const parts = invocation.rawInput.trim().split(/\s+/)
      const action = parts[0] || 'status'
      const providerName = parts[1] && controllers.has(parts[1]) ? parts[1] : listProviderNames()[0]
      const controller = controllers.get(providerName)
      if (controller === undefined) {
        return Promise.resolve({ kind: 'error' as const, text: `Unknown provider. Available: ${listProviderNames().join(', ')}` })
      }
      return controller.command(action === providerName ? 'status' : action)
    },
  })
}

function readBody(req: { on: (event: string, cb: (chunk?: Buffer) => void) => void }): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk?: Buffer) => { if (chunk !== undefined) chunks.push(chunk) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}
