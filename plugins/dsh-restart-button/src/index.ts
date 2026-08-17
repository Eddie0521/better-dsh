/**
 * Host half of dsh-restart-button: one exact route `POST /dsh-restart` plus
 * one model-facing tool `dsh_restart`, both triggering the supervisor's
 * detached restart and answering immediately. The supervisor
 * (`$DSH_HOME/bin/dsh-supervisor.sh restart`) returns at once and its setsid
 * worker performs stop → start in its own session, so neither the route nor
 * the tool blocks, and the caller's response arrives before the server
 * bounces.
 *
 * The route is only reachable from the same origin (the server binds
 * loopback by default); POST-only keeps a stray GET from restarting the box.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from 'cordis'

/** The request face route handlers receive (structural subset of node's IncomingMessage). */
interface RouteRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
}

/** The response face route handlers write to (structural subset of ServerResponse). */
interface RouteResponse {
  statusCode: number
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

/** The webServer service face this plugin consumes. */
interface SidebarWebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: RouteRequest, res: RouteResponse) => void | Promise<void>
  }): () => void
}

/** The tools service face this plugin consumes. */
interface SidebarToolsLike {
  register(tool: unknown): () => void
}

declare module 'cordis' {
  interface Context {
    webServer: SidebarWebServerLike
    tools: SidebarToolsLike
    effect(fn: () => void | (() => void), label?: string): void
  }
}

function writeJson(res: RouteResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * Spawn the supervisor's detached restart. Returns immediately; the setsid
 * worker inside the supervisor performs stop → start (~5 s) on its own.
 * @returns a short human note about the scheduled restart.
 */
function triggerRestart(): string {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const supervisor = join(dshHome, 'bin', 'dsh-supervisor.sh')
  if (!existsSync(supervisor)) {
    throw new Error(`supervisor not found: ${supervisor} (run better-dsh install.sh)`)
  }
  const child = spawn('bash', [supervisor, 'restart'], { detached: true, stdio: 'ignore' })
  child.unref()
  return `detached restart scheduled via ${supervisor} (~5 s; the web session reconnects automatically)`
}

/** Services required before mounting. */
export const inject = ['webServer', 'tools']

/** Client plugin body. */
export function apply(ctx: Context): void {
  // HTTP path (used by the in-UI refresh button).
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-restart',
    handler: (req, res) => {
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: 'POST only' })
        return
      }
      try {
        triggerRestart()
        writeJson(res, 200, { ok: true })
      } catch (error) {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-restart-button: route')

  // AI-native path: the agent can call the same restart through a tool.
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'dsh_restart',
    description:
      'Restart the DeepSeek Harness web server with the supervisor\'s detached restart (~5 s: stop, boot, self-check). '
      + 'The browser session reconnects automatically; the sidebar refresh button shows the restarting state while the server is down. '
      + 'CAUTION: the calling agent turn is interrupted by the bounce — the restart completes on its own and the session resumes after the server is back.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          note: { type: 'string' },
        },
      },
      render: (_args: unknown, value: { ok: boolean; note?: string }): Array<{ type: 'text'; text: string }> => [
        { type: 'text', text: value.ok ? `restart scheduled: ${value.note ?? ''}` : 'restart failed' },
      ],
    },
    execute: async (_args: unknown, exec: { signal: { throwIfAborted(): void } }) => {
      exec.signal.throwIfAborted()
      const note = triggerRestart()
      return { ok: true, note }
    },
  })), 'dsh-restart-button: tool')
}
