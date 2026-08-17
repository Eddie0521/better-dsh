/**
 * Client half of dsh-restart-button: a refresh button at the right end of
 * the sidebar's Settings row. Click → POST /dsh-restart (the host route
 * spawns the detached supervisor restart and answers immediately) → the
 * button spins → when the origin drops and comes back (the restart), the
 * page reloads itself, so "restart + refresh" happens in one click.
 *
 * No cordis services are needed; `apply` only owns the DOM and the probe
 * interval (the disposer tears them down on activation teardown / HMR).
 */
export const inject: string[] = []

const RESTART_URL = '/dsh-restart'
const PROBE_INTERVAL_MS = 400
const PROBE_TIMEOUT_MS = 2500
const RELOAD_DELAY_MS = 300
/** If the origin never goes down within this window, the click likely failed. */
const RESTART_TIMEOUT_MS = 20000
/** Rail-mode (collapsed sidebar) hides the button below this width. */
const MIN_ROW_WIDTH = 150

const STYLE_ID = 'dsh-restart-button-style'
const ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>'

const STYLE_CSS = `
button.dsh-restart-button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
button.dsh-restart-button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
button.dsh-restart-button:disabled { cursor: default; opacity: 0.6; }
button.dsh-restart-button[data-state="restarting"] svg { animation: dshRestartButtonSpin 1s linear infinite; }
button.dsh-restart-button[data-state="error"] { color: var(--dsw-alias-state-error-primary); }
@keyframes dshRestartButtonSpin { to { transform: rotate(360deg); } }
`

/**
 * Client plugin body.
 * @returns the disposer (runs on activation teardown / HMR).
 */
export function apply(_ctx: unknown): () => void {
  let area: HTMLElement | undefined
  let button: HTMLButtonElement | undefined
  let observer: MutationObserver | undefined
  let probeTimer: number | undefined
  let restarting = false

  const stopProbe = (): void => {
    if (probeTimer !== undefined) {
      window.clearInterval(probeTimer)
      probeTimer = undefined
    }
  }

  const setState = (next: 'idle' | 'restarting' | 'error'): void => {
    restarting = next === 'restarting'
    if (!button) return
    button.disabled = restarting
    button.dataset.state = next === 'idle' ? '' : next
    if (next === 'error') {
      button.title = '重启失败，请查看服务日志'
      window.setTimeout(() => setState('idle'), 3000)
    } else {
      button.title = '重启服务（dsh restart + 刷新页面）'
    }
  }

  const watchForRecovery = (): void => {
    let down = false
    const startedAt = Date.now()
    const probe = async (): Promise<void> => {
      if (!down && Date.now() - startedAt > RESTART_TIMEOUT_MS) {
        // The server never went away — the restart did not happen.
        stopProbe()
        setState('idle')
        return
      }
      try {
        const response = await fetch(`/?probe=${Date.now()}`, {
          cache: 'no-store',
          method: 'GET',
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        })
        if (!response.ok) {
          down = true
          return
        }
        if (down) {
          // Down and back up: the restart completed. Reload for a fresh UI.
          stopProbe()
          window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS)
        }
      } catch {
        down = true
      }
    }
    probeTimer = window.setInterval(() => void probe(), PROBE_INTERVAL_MS)
  }

  const onClick = async (): Promise<void> => {
    if (restarting) return
    setState('restarting')
    try {
      const response = await fetch(RESTART_URL, { method: 'POST', keepalive: true })
      if (!response.ok) {
        setState('error')
        return
      }
      watchForRecovery()
    } catch {
      setState('error')
    }
  }

  const buildButton = (): HTMLButtonElement => {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'dsh-restart-button'
    element.title = '重启服务（dsh restart + 刷新页面）'
    element.innerHTML = ICON_SVG
    element.addEventListener('click', () => void onClick())
    return element
  }

  const syncVisibility = (): void => {
    if (!area || !button) return
    button.style.display = area.getBoundingClientRect().width < MIN_ROW_WIDTH ? 'none' : 'inline-flex'
  }

  const mount = (): void => {
    const el = document.querySelector<HTMLElement>('div[class*="settingsArea"]')
    if (!el || el === area) return
    area = el
    // Turn the settings row into a flex row so the trigger shrinks and the
    // refresh button sits at its far right end.
    el.style.display = 'flex'
    el.style.alignItems = 'center'
    el.style.gap = '6px'
    const trigger = el.querySelector<HTMLElement>('button')
    if (trigger) {
      trigger.style.flex = '1 1 auto'
      trigger.style.minWidth = '0'
    }
    if (!button) button = buildButton()
    el.appendChild(button)
    syncVisibility()
  }

  // Styles (injected once per activation, removed on disposal).
  let style = document.getElementById(STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = STYLE_CSS
    document.head.appendChild(style)
  }

  mount()
  // The shell may re-render the sidebar (collapse, locale switch, HMR):
  // re-apply on any DOM change (mount is a cheap no-op when already in place).
  observer = new MutationObserver(() => {
    mount()
    syncVisibility()
  })
  observer.observe(document.body, { childList: true, subtree: true })

  return () => {
    observer?.disconnect()
    stopProbe()
    button?.remove()
    style?.remove()
  }
}
