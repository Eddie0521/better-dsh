/**
 * Structural types for the cordis services dsh-market consumes, plus the
 * Context augmentation the client half shares. A third-party plugin resolves
 * outside the DSH monorepo's single cordis instance, so the upstream
 * `declare module 'cordis'` augmentations do not reach this Context — the
 * members below mirror the actual runtime shapes this plugin touches:
 * - slots: the client runtime SlotRegistry (register + inject)
 * - locale: the client locale service (@deepseek-ai/dsh-client-locale)
 * - effect: the DSH-vendored cordis lifecycle helper
 *
 * This file must stay FREE of Node.js types: it is part of the
 * CLIENT-reachable declaration graph.
 */
import type { Context as CordisContext } from 'cordis'

/** Registration options the client passes to `ctx.slots.register` (subset of the real options). */
export interface MarketSlotRegisterOptions {
  name: string
  id?: string
  order?: number
  label?: string | (() => string)
  locale?: string
  /** Business-face factory; args depend on the slot scope. */
  inject?: (...args: any[]) => Record<string, unknown>
}

/** The client slots service face (register returns the disposer). */
export interface MarketSlotsService {
  register(options: MarketSlotRegisterOptions, component: unknown): () => void
  /**
   * Run a callback for each declaration lifetime of a slot (the runtime
   * SlotRegistry.inject): a no-op while the slot is undeclared, so the
   * settings tab registration waits for the Plugins settings section.
   */
  inject(key: string, callback: () => (() => void) | void): () => void
}

/** The client locale service face (only the slices dsh-market touches). */
export interface MarketLocaleService {
  /** Bind a namespace: returns the key → text lookup for that namespace. */
  bind(ns: string): (key: string) => string
  /** Register locale dictionaries for a namespace; returns the disposer. */
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
}

declare module 'cordis' {
  interface Context {
    slots: MarketSlotsService
    locale: MarketLocaleService
    /** Register a lifecycle callback (DSH-vendored cordis). */
    effect(fn: () => void | (() => void), label?: string): void
  }
}

export type Context = CordisContext
