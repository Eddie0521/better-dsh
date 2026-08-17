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
/** Always-on watch cadence (agent/terminal restarts are slower-paced). */
const WATCH_INTERVAL_MS = 2000
/** If the origin never goes down within this window, the click likely failed. */
const RESTART_TIMEOUT_MS = 20000
/** Rail-mode (collapsed sidebar) hides the button below this width. */
const MIN_ROW_WIDTH = 150

const STYLE_ID = 'dsh-restart-button-style'
const ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>'
/**
 * sessionStorage marker set right before a restart-triggered reload; the
 * freshly loaded page reads it once to play the "刷新成功" toast from the button.
 */
const RELOAD_MARKER = 'dsh-restart-button:just-restarted'
/** Toast window: only play when the marker is this fresh. */
const STAR_FRESHNESS_MS = 60000

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
.dsh-restart-button-toast {
  position: fixed;
  z-index: 2147483000;
  color: var(--dsw-alias-state-success-primary);
  background: var(--dsw-alias-bg-layer-3);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
  line-height: 1.6;
  white-space: nowrap;
  pointer-events: none;
  transform: translate(-50%, -50%);
  animation: dshRestartButtonToastUp 1.6s ease-out forwards;
}
@keyframes dshRestartButtonToastUp {
  0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
  12%  { opacity: 1; transform: translate(-50%, -90%) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -360%) scale(1); }
}
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
  let watchTimer: number | undefined
  let restarting = false
  /** True while the click flow owns the button state (and will reload). */
  let clickActive = false

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
    } else if (next === 'restarting') {
      button.title = '服务重启中…'
    } else {
      button.title = '重启服务（dsh restart + 刷新页面）'
    }
  }

  /**
   * Always-on watch: when the origin drops for ANY reason (agent-side
   * restart, terminal restart, crash), the button shows the restarting
   * state; when it comes back, the page reloads itself (fresh UI + the star
   * pop). Skipped while the click flow owns the button.
   */
  const startWatch = (): void => {
    let watchDown = false
    const probe = async (): Promise<void> => {
      if (clickActive) return
      try {
        const response = await fetch(`/?probe=${Date.now()}`, {
          cache: 'no-store',
          method: 'GET',
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        })
        if (!response.ok) {
          watchDown = true
          setState('restarting')
          return
        }
        if (watchDown) {
          // Down and back up: a restart happened (from any side). Reload.
          watchDown = false
          if (watchTimer !== undefined) {
            window.clearInterval(watchTimer)
            watchTimer = undefined
          }
          sessionStorage.setItem(RELOAD_MARKER, String(Date.now()))
          setState('idle')
          window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS)
        }
      } catch {
        watchDown = true
        setState('restarting')
      }
    }
    watchTimer = window.setInterval(() => void probe(), WATCH_INTERVAL_MS)
  }

  const watchForRecovery = (): void => {
    let down = false
    const startedAt = Date.now()
    const probe = async (): Promise<void> => {
      if (!down && Date.now() - startedAt > RESTART_TIMEOUT_MS) {
        // The server never went away — the restart did not happen.
        stopProbe()
        clickActive = false
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
          clickActive = false
          sessionStorage.setItem(RELOAD_MARKER, String(Date.now()))
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
    clickActive = true
    setState('restarting')
    try {
      const response = await fetch(RESTART_URL, { method: 'POST', keepalive: true })
      if (!response.ok) {
        clickActive = false
        setState('error')
        return
      }
      watchForRecovery()
    } catch {
      clickActive = false
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

  /**
   * One-shot star pop: a small gold star rises from the button and fades.
   * Called on a freshly loaded page right after a restart-triggered reload.
   */
  const playToast = (from: HTMLElement): void => {
    const rect = from.getBoundingClientRect()
    const toast = document.createElement('span')
    toast.className = 'dsh-restart-button-toast'
    toast.textContent = '刷新成功'
    toast.style.left = `${Math.round(rect.left + rect.width / 2)}px`
    toast.style.top = `${Math.round(rect.top + rect.height / 2)}px`
    document.body.appendChild(toast)
    toast.addEventListener('animationend', () => toast.remove(), { once: true })
  }

  /**
   * Toast-after-reload: consume the reload marker and play the "刷新成功"
   * toast, but only once the button actually exists — the shell may render
   * the sidebar after this plugin's apply runs, so callers retry via the
   * MutationObserver.
   */
  const maybePlayToast = (): void => {
    if (!button) return
    let marker: string | null = null
    try {
      marker = sessionStorage.getItem(RELOAD_MARKER)
    } catch {
      return
    }
    if (marker === null) return
    try {
      sessionStorage.removeItem(RELOAD_MARKER)
    } catch {
      // Storage unavailable — still play (the marker just persists).
    }
    if (Date.now() - Number(marker) < STAR_FRESHNESS_MS) {
      playToast(button)
    }
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
    maybePlayToast()
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
  maybePlayToast()
  // Always-on watch: any external restart (agent tool, terminal `dsh restart`)
  // shows the restarting state on the button, then reloads when the server is back.
  startWatch()
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
    if (watchTimer !== undefined) window.clearInterval(watchTimer)
    button?.remove()
    style?.remove()
  }
}
