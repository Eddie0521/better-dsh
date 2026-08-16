/**
 * The 插件市场 (Plugin Market) tab inside 设置 → 插件.
 *
 * Two corpora, both lazily paginated:
 * - downloads mode: npm registry search (the `dsh-plugin` keyword corpus,
 *   or the user's full-text query), each page enriched with real last-month
 *   download counts (npm bulk API) and GitHub stars (batched repo:
 *   search, localStorage-cached), sorted by downloads within the page;
 * - stars mode: GitHub `topic:dsh-plugin` search, globally star-sorted
 *   server-side, filtered to repos that actually ship an npm package.
 *
 * Lazy loading: an IntersectionObserver sentinel below the grid fetches the
 * next page when it scrolls into view; a manual "Load more" button stays as
 * a fallback (and for keyboard users).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  formatCount,
  githubStarsForRepos,
  githubTopicPage,
  keepRepoForMarket,
  npmDownloads,
  npmNameForRepo,
  npmSearchPage,
  repoFromUrl,
  type MarketItem,
} from './registry.ts'
import css from './market.module.css'

type Mode = 'downloads' | 'stars'

interface MarketState {
  items: MarketItem[]
  status: 'loading' | 'ready' | 'error'
  /** Corpus total (npm search total / GitHub total_count). */
  total: number
  /** Whether the server may still have more pages. */
  hasMore: boolean
}

const initial: MarketState = { items: [], status: 'loading', total: 0, hasMore: true }

const SEARCH_DEBOUNCE_MS = 350

function SearchIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="4.75" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.2 10.2 13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function Spinner(): JSX.Element {
  return <span className={css.spinner} role="status" aria-label="loading" />
}

/** Fetch one page of the active corpus and normalize it into market rows. */
async function fetchPage(
  mode: Mode,
  query: string,
  offset: number,
  signal: AbortSignal,
): Promise<{ items: MarketItem[]; total: number; hasMore: boolean }> {
  if (mode === 'downloads') {
    const { total, objects } = await npmSearchPage(query, offset, signal)
    const names = objects.map(object => object.package.name)
    const downloads = await npmDownloads(names)
    const repos = objects
      .map(object => repoFromUrl(object.package.links?.repository))
      .filter((repo): repo is { owner: string; name: string } => repo !== undefined)
    const stars = await githubStarsForRepos(repos)
    const items: MarketItem[] = objects.map(object => {
      const pkg = object.package
      const repo = repoFromUrl(pkg.links?.repository)
      const key = repo ? `${repo.owner}/${repo.name}` : pkg.name
      return {
        key,
        name: pkg.name,
        description: pkg.description ?? '',
        version: pkg.version,
        stars: repo ? stars[`${repo.owner}/${repo.name}`] : undefined,
        downloads: downloads.get(pkg.name),
        npmUrl: pkg.links?.npm ?? `https://www.npmjs.com/package/${encodeURIComponent(pkg.name)}`,
        repoUrl: repo ? `https://github.com/${repo.owner}/${repo.name}` : pkg.links?.homepage,
        updatedAt: pkg.date,
        source: 'npm',
      }
    })
    // Real downloads drive the within-page order (unknowns trail).
    items.sort((a, b) => (b.downloads ?? -1) - (a.downloads ?? -1))
    return { items, total, hasMore: offset + objects.length < total }
  }

  // Stars mode: GitHub topic, globally star-sorted; keep only npm-shipping repos.
  const page = Math.floor(offset / 100) + 1
  const { total, items: repos } = await githubTopicPage(query, page, signal)
  const names = repos.map(npmNameForRepo)
  const downloads = await npmDownloads(names)
  const kept = repos.filter(repo => keepRepoForMarket(repo, downloads))
  const items: MarketItem[] = kept.map(repo => {
    const npmName = npmNameForRepo(repo)
    const hasNpm = downloads.has(npmName)
    return {
      key: repo.full_name,
      name: npmName,
      description: repo.description ?? '',
      stars: repo.stargazers_count,
      downloads: hasNpm ? downloads.get(npmName) : undefined,
      npmUrl: hasNpm ? `https://www.npmjs.com/package/${encodeURIComponent(npmName)}` : undefined,
      repoUrl: repo.html_url,
      updatedAt: repo.pushed_at,
      source: 'github',
    }
  })
  return { items, total, hasMore: repos.length > 0 }
}

/** The tab body: search box, sort toggle, two-column lazy grid. */
export function MarketplaceTab({ t }: { t: (key: string) => string }): JSX.Element {
  const [mode, setMode] = useState<Mode>('downloads')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [state, setState] = useState<MarketState>(initial)
  const [refresh, setRefresh] = useState(0)

  const generationRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const loadingRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Debounce the search box.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  // First page on corpus change (mode / query / manual refresh).
  useEffect(() => {
    const generation = ++generationRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    loadingRef.current = true
    setState({ ...initial, status: 'loading' })
    void (async () => {
      try {
        const page = await fetchPage(mode, debouncedQuery, 0, controller.signal)
        if (generation !== generationRef.current) return
        setState({ items: page.items, status: 'ready', total: page.total, hasMore: page.hasMore })
      } catch {
        if (generation !== generationRef.current || controller.signal.aborted) return
        setState({ items: [], status: 'error', total: 0, hasMore: false })
      } finally {
        if (generation === generationRef.current) loadingRef.current = false
      }
    })()
    return () => { controller.abort() }
  }, [mode, debouncedQuery, refresh])

  // Lazy load: fetch the next page when the sentinel scrolls into view.
  const loadMore = useCallback(() => {
    if (loadingRef.current) return
    const generation = generationRef.current
    const offset = state.items.length
    const controller = new AbortController()
    abortRef.current = controller
    loadingRef.current = true
    void (async () => {
      try {
        const page = await fetchPage(mode, debouncedQuery, offset, controller.signal)
        if (generation !== generationRef.current) return
        setState(previous => ({
          items: [...previous.items, ...page.items],
          status: 'ready',
          total: page.total,
          hasMore: page.hasMore,
        }))
      } catch {
        // Keep the list; the sentinel stays armed so scrolling retries.
      } finally {
        if (generation === generationRef.current) loadingRef.current = false
      }
    })()
  }, [mode, debouncedQuery, state.items.length])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !state.hasMore) return
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) loadMore()
      },
      { rootMargin: '600px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, state.hasMore])

  const setModeSafe = (next: Mode): void => setMode(next)
  const retry = (): void => setRefresh(value => value + 1)

  const countLabel = state.total > 0 && mode === 'downloads'
    ? t('total').replace('{count}', String(state.total))
    : state.items.length > 0
      ? t('loaded').replace('{count}', String(state.items.length))
      : ''

  return (
    <div className={css.section}>
      <div className={css.toolbar}>
        <div className={css.search}>
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
          />
        </div>
        <div className={css.sort} role="group" aria-label={t('sortAria')}>
          <button
            type="button"
            data-active={mode === 'downloads'}
            aria-pressed={mode === 'downloads'}
            onClick={() => setModeSafe('downloads')}
          >
            {t('sortDownloads')}
          </button>
          <button
            type="button"
            data-active={mode === 'stars'}
            aria-pressed={mode === 'stars'}
            onClick={() => setModeSafe('stars')}
          >
            {t('sortStars')}
          </button>
        </div>
      </div>

      {countLabel ? <p className={css.total}>{countLabel}</p> : null}

      {state.items.length > 0 ? (
        <ul className={css.grid}>
          {state.items.map(item => (
            <li key={item.key} className={css.card}>
              <div className={css.cardHead}>
                <span className={css.name} title={item.name}>{item.name}</span>
                {item.version ? <span className={css.version}>{item.version}</span> : null}
              </div>
              {item.description ? <p className={css.desc}>{item.description}</p> : null}
              <div className={css.meta}>
                {item.stars !== undefined ? (
                  <span className={css.metric} title={`${t('stars')}: ${item.stars}`}>
                    ★ {formatCount(item.stars)}
                  </span>
                ) : null}
                {item.downloads !== undefined ? (
                  <span className={css.metric} title={`${t('downloadsMonth')}: ${item.downloads}`}>
                    ↓ {formatCount(item.downloads)}
                  </span>
                ) : null}
                <span className={css.badge}>{item.source === 'npm' ? t('sourceNpm') : t('sourceGitHub')}</span>
                <span className={css.links}>
                  {item.npmUrl ? (
                    <a href={item.npmUrl} target="_blank" rel="noreferrer">{t('openNpm')} ↗</a>
                  ) : null}
                  {item.repoUrl ? (
                    <a href={item.repoUrl} target="_blank" rel="noreferrer">{t('openRepo')} ↗</a>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === 'loading' && state.items.length === 0 ? (
        <p className={css.status}><Spinner /> {t('loading')}</p>
      ) : null}
      {state.status === 'error' && state.items.length === 0 ? (
        <p className={css.error}>
          {t('loadError')}
          <button type="button" onClick={retry}>{t('retry')}</button>
        </p>
      ) : null}
      {state.status === 'ready' && state.items.length === 0 ? (
        <p className={css.status}>{debouncedQuery.trim() ? t('emptyQuery') : t('empty')}</p>
      ) : null}

      <div ref={sentinelRef} className={css.sentinel} aria-hidden="true" />
      {state.hasMore && state.items.length > 0 ? (
        <button
          type="button"
          className={css.more}
          onClick={loadMore}
          disabled={state.status === 'loading'}
        >
          {t('loadMore')}
        </button>
      ) : null}
    </div>
  )
}
