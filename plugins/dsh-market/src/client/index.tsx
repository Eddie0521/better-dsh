/**
 * Client half of dsh-market: registers the 插件市场 tab into the
 * 设置 → 插件 (Plugins settings section) through the `settings.plugins.tab`
 * slot, next to the inventory tab. The tab itself is browser-only — it talks
 * to the public npm/GitHub APIs straight from the page (CORS-enabled), so no
 * host channel is needed.
 */
import type { Context } from '../context-types.ts'
import { MarketplaceTab } from './MarketplaceTab.tsx'
import { en, LOCALE_NS, zh } from './locales.ts'

/** Services required before mounting (provided by the client runtime). */
export const inject = ['slots', 'locale']

/**
 * Client plugin body.
 * @param ctx - the client cordis context (slots, locale).
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(LOCALE_NS, { zh, en }),
    'dsh-market: dictionaries',
  )
  const t = ctx.locale.bind(LOCALE_NS)
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'market',
    order: 20,
    label: () => t('nav'),
    locale: LOCALE_NS,
    inject: () => ({}),
  }, MarketplaceTab))
}
