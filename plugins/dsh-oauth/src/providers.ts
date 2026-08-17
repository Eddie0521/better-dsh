/**
 * Provider registry: maps provider names to their OAuth configuration.
 *
 * Each entry knows how to start the OAuth flow (PKCE browser flow or device
 * code flow), exchange the code for tokens, and which credential ref the
 * resulting access token should be mirrored into.
 *
 * The built-in list reuses pi-ai's own OAuth implementations where they
 * exist (anthropic, github-copilot, openrouter, openai-codex, kimi-coding,
 * xai, radius). Users can add custom providers through settings.
 */

export interface ProviderOAuthConfig {
  /** Display name shown in /oauth status and login prompts. */
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
  /** Optional: base URL for the provider's API (for documentation only). */
  apiBaseUrl?: string
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
    label: 'OpenAI Codex',
    flow: 'pkce',
    credentialRef: 'OPENAI_OAUTH_ACCESS_TOKEN',
    authorizeUrl: 'https://platform.openai.com/oauth/authorize',
    tokenUrl: 'https://platform.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    pkceRequired: true,
  },
  xai: {
    label: 'xAI (Grok)',
    flow: 'pkce',
    credentialRef: 'XAI_OAUTH_ACCESS_TOKEN',
    authorizeUrl: 'https://x.ai/oauth/authorize',
    tokenUrl: 'https://x.ai/oauth/token',
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
