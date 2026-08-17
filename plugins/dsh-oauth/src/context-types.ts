/** Minimal context types for the client plugin (matches dsh-client-runtime shape). */

export interface SlotRegistration {
  name: string
  id: string
  order: number
  label: () => string
  inject: Record<string, unknown>
}

export interface Slots {
  inject(slotName: string, fn: () => ReturnType<Slots['register']>): () => void
  register(registration: SlotRegistration, component: React.FC<{ injected: Record<string, unknown> }>): () => void
}

export interface Locale {
  t(key: string): string
}

export interface Context {
  slots: Slots
  locale: Locale
}
