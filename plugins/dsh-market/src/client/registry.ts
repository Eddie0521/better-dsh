/**
 * dsh-market data layer — public APIs only, all CORS-enabled:
 *
 * - npm registry search: https://registry.npmjs.org/-/v1/search
 *   (the ecosystem corpus: packages declaring the `dsh-plugin` keyword,
 *   or any full-text query the user types)
 * - npm downloads: https://api.npmjs.org/downloads/point/last-month/<names>
 *   (bulk, up to 128 names per call — real per-package download counts)
 * - GitHub search: https://api.github.com/search/repositories
 *   (repo: qualifiers can be repeated in ONE query, so a page of npm
 *   packages resolves its star counts with a few requests; the
 *   `topic:dsh-plugin` corpus backs the star-ranking mode)
 *
 * Star lookups are cached in localStorage (24h TTL) so repeat visits and
 * fast scrolling stay within GitHub's 10 search-requests/minute limit.
 */

/** One npm search hit (the slice the market reads). */
export interface NpmSearchObject {
  package: {
    name: string
    version: string
    description?: string
    date?: string
    links?: {
      npm?: string
      homepage?: string
      repository?: string
    }
  }
  score: {
    detail: {
      /** Download-driven 0..1 popularity signal from npm's own scoring. */
      popularity: number
    }
  }
}

/** A GitHub repository row (search API shape). */
export interface GitHubRepo {
  full_name: string
  name: string
  owner: { login: string }
  stargazers_count: number
  description?: string | null
  html_url: string
  homepage?: string | null
  pushed_at?: string
}

/** One normalized market row (both corpora converge here). */
export interface MarketItem {
  /** Stable list key: npm package name in downloads mode, full_name in stars mode. */
  key: string
  name: string
  description: string
  version?: string
  /** GitHub stars; undefined = unknown (lookup failed or not attempted). */
  stars?: number
  /** Last-month npm downloads; undefined = unknown / no npm package. */
  downloads?: number
  npmUrl?: string
  repoUrl?: string
  updatedAt?: string
  source: 'npm' | 'github'
}

const SEARCH_PAGE_SIZE = 36
const TOPIC_PAGE_SIZE = 100

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } })
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} for ${url}`) as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return response.json() as Promise<T>
}

/** npm registry search (ecosystem corpus; empty query browses the `dsh-plugin` keyword). */
export async function npmSearchPage(
  query: string,
  from: number,
  signal?: AbortSignal,
): Promise<{ total: number; objects: NpmSearchObject[] }> {
  const text = query.trim() ? query.trim() : 'keywords:dsh-plugin'
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=${SEARCH_PAGE_SIZE}&from=${from}`
  return getJson<{ total: number; objects: NpmSearchObject[] }>(url, signal)
}

/**
 * Real last-month download counts. The bulk endpoint rejects scoped package
 * names, so scoped names are fetched individually (URL-encoded slash).
 * Missing packages simply have no entry.
 */
export async function npmDownloads(names: readonly string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const unscoped: string[] = []
  const scoped: string[] = []
  for (const name of names) {
    if (name.includes('/')) scoped.push(name)
    else unscoped.push(name)
  }
  for (let i = 0; i < unscoped.length; i += 100) {
    const chunk = unscoped.slice(i, i + 100)
    const url = `https://api.npmjs.org/downloads/point/last-month/${chunk.map(encodeURIComponent).join(',')}`
    const data = await getJson<Record<string, { downloads?: number } | null>>(url)
    for (const name of chunk) {
      const entry = data[name]
      if (entry && typeof entry.downloads === 'number') map.set(name, entry.downloads)
    }
  }
  for (const name of scoped) {
    try {
      const url = `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`
      const data = await getJson<{ downloads?: number }>(url)
      if (typeof data.downloads === 'number') map.set(name, data.downloads)
    } catch {
      // Individual scoped lookup failed — the package just shows no downloads.
    }
  }
  return map
}

/** Parse a GitHub repository URL (from npm metadata) into owner/name. */
export function repoFromUrl(url: string | undefined): { owner: string; name: string } | undefined {
  if (!url) return undefined
  const match = url.match(/github\.com[/:]([^/]+)\/([^/#.]+)/)
  if (!match?.[1] || !match[2]) return undefined
  return { owner: match[1], name: match[2] }
}

// ── GitHub star lookups (batched repo: qualifiers + localStorage cache) ──

const STAR_CACHE_KEY = 'dsh-market:stars:v1'
const STAR_CACHE_TTL_MS = 24 * 60 * 60 * 1000
/** GitHub search allows a handful of repo: qualifiers per query. */
const REPOS_PER_QUERY = 5

interface StarCache {
  ts: number
  map: Record<string, number>
}

function readStarCache(): StarCache {
  try {
    const raw = localStorage.getItem(STAR_CACHE_KEY)
    if (!raw) return { ts: 0, map: {} }
    const parsed = JSON.parse(raw) as StarCache
    if (typeof parsed?.ts !== 'number' || typeof parsed?.map !== 'object') return { ts: 0, map: {} }
    return parsed
  } catch {
    return { ts: 0, map: {} }
  }
}

function writeStarCache(cache: StarCache): void {
  try {
    localStorage.setItem(STAR_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Storage unavailable (private mode / quota) — stars just miss the cache.
  }
}

/** Resolve stars for many repos with few requests. A batch containing a repo
 *  that does not exist (or is unsearchable) fails the WHOLE query with 422,
 *  so a failed batch falls back to one REST lookup per repo — survivors still
 *  resolve and confirmed-missing repos are cached as -1 to never retry.
 *  Rate limits (403/429) abort the remaining lookups and leave stars blank. */
export async function githubStarsForRepos(
  repos: ReadonlyArray<{ owner: string; name: string }>,
): Promise<Record<string, number | undefined>> {
  const result: Record<string, number | undefined> = {}
  if (repos.length === 0) return result
  const cache = readStarCache()
  const now = Date.now()
  const fresh = now - cache.ts < STAR_CACHE_TTL_MS

  const missing: string[] = []
  const seen = new Set<string>()
  for (const repo of repos) {
    const key = `${repo.owner}/${repo.name}`
    if (seen.has(key)) continue // dedupe: many packages point at one repo
    seen.add(key)
    if (cache.map[key] === -1) {
      result[key] = undefined // confirmed non-existent — never retry this session
      continue
    }
    if (fresh && cache.map[key] !== undefined) {
      result[key] = cache.map[key]
    } else {
      missing.push(key)
    }
  }
  if (missing.length === 0) return result

  const fetched = new Map<string, number>()
  const nonexistent: string[] = []
  let rateLimited = false

  for (let i = 0; i < missing.length && !rateLimited; i += REPOS_PER_QUERY) {
    const chunk = missing.slice(i, i + REPOS_PER_QUERY)
    try {
      const q = chunk.map(key => `repo:${key}`).join('+')
      const data = await getJson<{ items?: GitHubRepo[] }>(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=${REPOS_PER_QUERY}`,
      )
      for (const item of data.items ?? []) {
        fetched.set(item.full_name, item.stargazers_count)
      }
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status === 403 || status === 429) { rateLimited = true; break }
      // 422 (or any other failure): a listed repo cannot be searched —
      // resolve the batch one repo at a time so the rest still get stars.
      for (const key of chunk) {
        const slash = key.indexOf('/')
        const owner = key.slice(0, slash)
        const name = key.slice(slash + 1)
        try {
          const repo = await getJson<GitHubRepo>(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
          )
          fetched.set(repo.full_name, repo.stargazers_count)
        } catch (err) {
          const s = (err as { status?: number }).status
          if (s === 403 || s === 429) { rateLimited = true; break }
          if (s === 404) nonexistent.push(key)
        }
      }
    }
  }

  // Merge into the cache and persist (extend the TTL window on success);
  // confirmed-missing repos are cached as -1 so later pages skip them.
  for (const [key, stars] of fetched) {
    cache.map[key] = stars
    result[key] = stars
  }
  for (const key of nonexistent) cache.map[key] = -1
  cache.ts = now
  writeStarCache(cache)
  return result
}

// ── GitHub topic corpus (star-ranking mode) ──

/** GitHub topic search page, star-sorted globally. */
export async function githubTopicPage(
  query: string,
  page: number,
  signal?: AbortSignal,
): Promise<{ total: number; items: GitHubRepo[] }> {
  const text = query.trim() ? query.trim() : ''
  const q = text ? `topic:dsh-plugin ${text}` : 'topic:dsh-plugin'
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${TOPIC_PAGE_SIZE}&page=${page}`
  return getJson<{ total_count: number; items: GitHubRepo[] }>(url, signal).then(data => ({
    total: data.total_count,
    items: data.items ?? [],
  }))
}

/** Guess the npm package name for a GitHub repo (the ecosystem convention: repo name = package name). */
export function npmNameForRepo(repo: GitHubRepo): string {
  return repo.name.toLowerCase()
}

/**
 * Noise guard for the star mode: keep only repos that look like DSH plugins
 * AND have a matching npm package (downloads API returned a row). Excludes
 * the harness monorepo itself.
 */
export function keepRepoForMarket(repo: GitHubRepo, downloads: Map<string, number>): boolean {
  if (repo.full_name === 'deepseek-ai/deepseek-harness') return false
  const npmName = npmNameForRepo(repo)
  if (!downloads.has(npmName)) return false
  return (
    npmName.startsWith('dsh')
    || npmName.includes('deepseek-harness')
    || repo.owner.login === 'deepseek-ai'
    || npmName.includes('dsh-plugin')
  )
}

/** Format a download count compactly (1200 → "1.2k", 1500000 → "1.5m"). */
export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`
  return String(value)
}
