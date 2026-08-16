/** Copy dictionaries for the dsh-market settings tab. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  nav: '插件市场',
  searchPlaceholder: '搜索插件（留空浏览全部）…',
  sortAria: '排序方式',
  sortDownloads: '按下载量',
  sortStars: '按 Star',
  total: '共 {count} 个插件',
  loaded: '已加载 {count} 个',
  loading: '加载中…',
  loadMore: '加载更多',
  loadError: '加载失败',
  empty: '没有找到插件。',
  emptyQuery: '没有匹配的插件。',
  retry: '重试',
  stars: 'Star',
  downloadsMonth: '下载/月',
  updated: '更新',
  openNpm: 'npm',
  openRepo: 'GitHub',
  sourceNpm: 'npm 包',
  sourceGitHub: 'GitHub 仓库',
} as const

/** English dictionary checked against the Chinese key set. */
export const en: Record<keyof typeof zh, string> = {
  nav: 'Plugin Market',
  searchPlaceholder: 'Search plugins (empty to browse all)…',
  sortAria: 'Sort by',
  sortDownloads: 'By downloads',
  sortStars: 'By stars',
  total: '{count} plugins',
  loaded: 'Loaded {count}',
  loading: 'Loading…',
  loadMore: 'Load more',
  loadError: 'Failed to load',
  empty: 'No plugins found.',
  emptyQuery: 'No matching plugins.',
  retry: 'Retry',
  stars: 'Stars',
  downloadsMonth: 'dl/mo',
  updated: 'Updated',
  openNpm: 'npm',
  openRepo: 'GitHub',
  sourceNpm: 'npm package',
  sourceGitHub: 'GitHub repo',
}

export const LOCALE_NS = 'dshMarket'
