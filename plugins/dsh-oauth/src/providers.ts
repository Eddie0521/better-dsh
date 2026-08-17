/**
 * Provider registry: maps provider names to their OAuth configuration and
 * reuses pi-ai's built-in model catalog so reasoning levels and input
 * modalities come for free.
 */

export interface ProviderOAuthConfig {
  /** Display name shown in the settings section and login prompts. */
  label: string
  /** Authentication method: 'pkce' (browser) or 'device-code' (no browser). */
  flow: 'pkce' | 'device-code'
  /** The credential ref that the access token mirror is written to. */
  credentialRef: string
  /** OAuth authorization endpoint (PKCE flow). */
  authorizeUrl?: string
  /** OAuth token endpoint. */
  tokenUrl: string
  /** OAuth device code endpoint (device-code flow). */
  deviceCodeUrl?: string
  /** OAuth revocation endpoint. */
  revokeUrl?: string
  /** OAuth client id. */
  clientId: string
  /** OAuth scopes to request. */
  scopes: string[]
  /** Whether the provider supports PKCE S256. */
  pkceRequired: boolean
  /** Optional: override the default callback port (0 = OS-assigned). */
  callbackPort?: number
}

/** Built-in provider OAuth configurations. */
export const builtinProviders: Record<string, ProviderOAuthConfig> = {
  anthropic: {
    label: 'Anthropic (Claude Pro/Max)',
    flow: 'pkce',
    credentialRef: 'ANTHROPIC_OAUTH_ACCESS_TOKEN',
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://platform.claude.com/v1/oauth/token',
    revokeUrl: 'https://platform.claude.com/v1/oauth/revoke',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    scopes: ['org:create_api_key', 'user:profile', 'user:inference', 'user:sessions:claude_code', 'user:mcp_servers', 'user:file_upload'],
    pkceRequired: true,
    callbackPort: 53692,
  },
  openrouter: {
    label: 'OpenRouter',
    flow: 'pkce',
    credentialRef: 'OPENROUTER_OAUTH_ACCESS_TOKEN',
    authorizeUrl: 'https://openrouter.ai/login',
    tokenUrl: 'https://openrouter.ai/api/v1/auth/keys',
    clientId: 'dsh-oauth',
    scopes: ['openid', 'profile', 'email'],
    pkceRequired: false,
  },
  'github-copilot': {
    label: 'GitHub Copilot',
    flow: 'device-code',
    credentialRef: 'GITHUB_COPILOT_OAUTH_ACCESS_TOKEN',
    deviceCodeUrl: 'https://github.com/login/device/code',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientId: 'Iv1.b507a4d6c5e3f8e2',
    scopes: ['read:user', 'copilot'],
    pkceRequired: false,
  },
  'openai-codex': {
    label: 'OpenAI Codex (ChatGPT Plus/Pro)',
    flow: 'pkce',
    credentialRef: 'OPENAI_OAUTH_ACCESS_TOKEN',
    authorizeUrl: 'https://platform.openai.com/oauth/authorize',
    tokenUrl: 'https://platform.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    pkceRequired: true,
  },
  'kimi-coding': {
    label: 'Kimi Code (subscription)',
    flow: 'device-code',
    credentialRef: 'KIMI_OAUTH_ACCESS_TOKEN',
    deviceCodeUrl: 'https://platform.moonshot.cn/oauth/device/code',
    tokenUrl: 'https://platform.moonshot.cn/oauth/token',
    clientId: 'dsh-oauth',
    scopes: ['kimi:inference'],
    pkceRequired: false,
  },
  xai: {
    label: 'xAI (Grok/X subscription)',
    flow: 'pkce',
    credentialRef: 'XAI_OAUTH_ACCESS_TOKEN',
    authorizeUrl: 'https://x.ai/oauth/authorize',
    tokenUrl: 'https://x.ai/oauth/token',
    clientId: 'dsh-oauth',
    scopes: ['openid', 'profile'],
    pkceRequired: true,
  },
  radius: {
    label: 'Radius',
    flow: 'pkce',
    credentialRef: 'RADIUS_OAUTH_ACCESS_TOKEN',
    authorizeUrl: 'https://radius.ai/oauth/authorize',
    tokenUrl: 'https://radius.ai/oauth/token',
    clientId: 'dsh-oauth',
    scopes: ['openid', 'profile'],
    pkceRequired: true,
  },
}

/** Get a provider config by name, or undefined if not found. */
export function getProvider(name: string): ProviderOAuthConfig | undefined {
  return builtinProviders[name]
}

/** List all available provider names. */
export function listProviderNames(): string[] {
  return Object.keys(builtinProviders)
}

/** Get pi-ai's built-in model catalog for a provider. */
export async function getProviderModels(providerName: string): Promise<Array<{
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  input: string[]
  reasoning: boolean | Record<string, string | null>
  api: string
}>> {
  try {
    const mod = await import('@earendil-works/pi-ai/providers/all')
    const models = mod.getBuiltinModels(providerName)
    return models.map((m: any) => ({
      id: m.id,
      name: m.name ?? m.id,
      contextWindow: m.contextWindow ?? 0,
      maxTokens: m.maxTokens ?? 0,
      input: m.input ?? ['text'],
      reasoning: m.reasoning ?? false,
      api: m.api ?? 'openai-completions',
    }))
  } catch {
    return []
  }
}
