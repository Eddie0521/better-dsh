# dsh-market

<h4 align="right"><a href="README.md">简体中文</a> | <strong>English</strong></h4>

<p align="center">
  <img src="https://github.com/Eddie0521/better-dsh/raw/main/assets/deepseek.svg" alt="DeepSeek" width="138" />
</p>

<h1 align="center">dsh-market</h1>

<p align="center"><strong>A plugin marketplace built into the DeepSeek Harness Web UI</strong></p>

<p align="center">
  Adds a <strong>Plugin Market</strong> tab to <strong>Settings → Plugins</strong>: search DeepSeek Harness plugins through the public npm / GitHub APIs, sort by downloads or stars, two-column grid, lazy loading on scroll.
</p>

## Features

- 🏪 **Inside Settings**: registers the `settings.plugins.tab` slot, side by side with the "Plugin list" tab.
- 🔍 **Search box**: type a keyword to search (300 ms debounce); empty to browse all.
- 📊 **Sort by downloads**: npm registry search (the `dsh-plugin` keyword corpus), each page enriched with real last-30-day download counts (npm bulk API) and re-sorted by downloads.
- ⭐ **Sort by stars**: GitHub `topic:dsh-plugin` search, globally star-sorted server-side, filtered to repos that actually ship an npm package.
- 🪜 **Two-column lazy grid**: IntersectionObserver loads the next page when the sentinel scrolls into view (a "Load more" button backs it up).
- 🔒 **Read-only, browser-only**: every request hits public CORS-enabled APIs; no Host channel, no write access.

## Install

### Option A: via better-dsh (local development)

The plugin lives in the better-dsh repo at `plugins/dsh-market/`. Running better-dsh's `install.sh` builds it, links it into the profile, and mounts it:

```bash
git clone https://github.com/Eddie0521/better-dsh.git
cd better-dsh
bash install.sh
dsh restart   # then refresh the browser page
```

### Option B: via npm (official install)

```bash
dsh plugin --profile web add dsh-market
```

The package ships a `dsh.bundle.patch`, so the official CLI appends it to the profile's bundle stack and mounts it automatically.

## Usage

1. Open the Web UI → Settings → Plugins → the "Plugin Market" tab.
2. Default sort is by downloads; click "By stars" to switch the corpus.
3. Type a keyword in the search box (e.g. `sidebar`, `feishu`).
4. Scroll the list — the next page loads automatically; cards link to npm / GitHub.

## Data sources & limitations

- **npm registry search**: `registry.npmjs.org/-/v1/search`; the empty query browses `keywords:dsh-plugin` (the ecosystem's self-declared keyword, ~900+ packages).
- **Downloads**: `api.npmjs.org/downloads/point/last-month` (last 30 days, batched).
- **Stars**: `api.github.com/search/repositories` with repeated `repo:` qualifiers, batched; results are cached in localStorage (24 h TTL) to stay under GitHub's unauthenticated search limit (10 req/min). When rate-limited, stars simply show as unavailable.
- **Stars-mode filter**: keeps only repos with a same-named npm package whose name matches `dsh-*` / `deepseek-harness` / the `deepseek-ai` org, and excludes the harness monorepo — so GitHub-topic noise stays out.
- Official `@deepseek-ai/dsh-*` packages do not carry the `dsh-plugin` keyword and are not in this corpus (they ship preinstalled with every profile).

## Development

```bash
pnpm install
pnpm build      # produces lib/index.js (empty host stub) + lib/client.js (browser bundle)
pnpm watch      # incremental build
pnpm typecheck
```

- The client bundle registers via `window.__ModuleLoader__.load({ id: "dsh-market", … })`; `dsh.client.platform: web` lets client-modules discover and serve `/plugins/dsh-market/client.js`.
- Tab registration: `ctx.slots.inject('settings.plugins.tab', …)` with `order: 20`, after the inventory tab (order 10).

## License

[MIT](LICENSE). DeepSeek Harness and its assets retain their respective upstream licenses and trademarks.
