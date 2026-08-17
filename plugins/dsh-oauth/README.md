# dsh-oauth

DSH 插件：为 pi-ai 适配层补上 OAuth 登录能力。

## 为什么需要这个插件

DSH 的 `dsh-llm-pi-ai` 适配层只支持 API Key 认证，主动放弃了 pi-ai SDK 的 OAuth 能力。这个插件通过 credential mirror 模式补上这个缺口：独立运行 OAuth 流程，把 access token 写入 DSH credential store，让现有 adapter 透明消费。

## 支持的 Provider

| Provider | 认证流程 | Credential Ref |
|----------|---------|----------------|
| anthropic | PKCE (浏览器) | `ANTHROPIC_OAUTH_ACCESS_TOKEN` |
| openrouter | PKCE (浏览器) | `OPENROUTER_OAUTH_ACCESS_TOKEN` |
| github-copilot | Device Code | `GITHUB_COPILOT_OAUTH_ACCESS_TOKEN` |
| openai-codex | PKCE (浏览器) | `OPENAI_OAUTH_ACCESS_TOKEN` |
| xai | PKCE (浏览器) | `XAI_OAUTH_ACCESS_TOKEN` |

## 使用方法

### 1. 配置 provider

在 `~/.dsh/settings.yaml` 里把 provider 的 `apiKeyEnv` 指向 OAuth credential ref：

```yaml
llm-pi-ai:
  providers:
    anthropic:
      apiKeyEnv: ANTHROPIC_OAUTH_ACCESS_TOKEN
      models:
        - id: claude-sonnet-4-20250514
          name: Claude Sonnet 4
          contextWindow: 200000
          maxTokens: 64000
```

### 2. 配置插件默认 provider

在 `~/.dsh/settings.yaml` 里配置 dsh-oauth：

```yaml
dsh-oauth:
  provider: anthropic
```

### 3. 登录

在 DSH Web 对话框输入：

```
/oauth login
```

PKCE 流程会打开浏览器授权页；device-code 流程会显示验证 URL 和代码。

### 4. 检查状态

```
/oauth status
```

### 5. 登出

```
/oauth logout
```

## 工作原理

```
/oauth login
  ↓
插件运行 OAuth PKCE / Device Code 流程
  ↓
拿到 access token + refresh token
  ↓
双写 credential store:
  1. {PROVIDER}_OAUTH_TOKENS — 完整 token set（可恢复）
  2. {PROVIDER}_OAUTH_ACCESS_TOKEN — access token 镜像
  ↓
pi-ai adapter 通过 apiKeyEnv 读取镜像，透明使用
  ↓
access token 过期前 60 秒自动刷新
```

## License

MIT
