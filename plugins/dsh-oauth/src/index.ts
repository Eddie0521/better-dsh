/**
 * dsh-oauth — bring pi-ai's OAuth capability into DSH.
 *
 * Registers /oauth [login|status|logout] command. Login runs the PKCE or
 * device-code flow for the configured provider, persists tokens to DSH's
 * credential store, and mirrors the access token into a credential ref
 * that pi-ai adapter reads via apiKeyEnv — no adapter changes needed.
 *
 * Usage in settings.yaml:
 *   llm-pi-ai:
 *     providers:
 *       anthropic:
 *         apiKeyEnv: ANTHROPIC_OAUTH_ACCESS_TOKEN   # ← the mirror ref
 *         models: [...]
 *
 * Then in DSH Web:
 *   /oauth login anthropic
 *   /oauth status
 *   /oauth logout anthropic
 */

import type { Context } from 'cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import { OAuthController } from './controller.js'
import { builtinProviders, getProvider, listProviderNames, type ProviderOAuthConfig } from './providers.js'

export const name = 'dsh-oauth'
export const inject = ['commands', 'credentials']

export const Config = z.object({
  provider: z.string().default('anthropic').description('OAuth provider name: ' + listProviderNames().join(', ')),
})

export interface Config {
  provider: string
}

const controllers = new Map<string, OAuthController>()

export async function apply(ctx: Context, config: Config): Promise<void> {
  const providerName = config.provider
  const provider = getProvider(providerName)
  if (provider === undefined) {
    ctx.logger.error(`dsh-oauth: unknown provider "${providerName}". Available: ${listProviderNames().join(', ')}`)
    return
  }

  const tokenSetRef = credentialRef(`${providerName.toUpperCase().replace(/-/g, '_')}_OAUTH_TOKENS`)
  const accessTokenRef = credentialRef(provider.credentialRef)

  const controller = new OAuthController(ctx, provider, tokenSetRef, accessTokenRef)
  controllers.set(providerName, controller)

  await controller.start()
  ctx.effect(() => () => {
    controller.dispose()
    controllers.delete(providerName)
  }, 'dsh-oauth.lifecycle')

  ctx.commands.register({
    name: 'oauth',
    description: `OAuth login for ${provider.label} (login, status, logout)`,
    input: { hint: '[login|status|logout]' },
    handler: (invocation) => controller.command(invocation.rawInput),
  })
}
