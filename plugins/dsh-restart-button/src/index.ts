/**
 * Host half of dsh-restart-button: one exact route `POST /dsh-restart` that
 * triggers the supervisor's detached restart and answers immediately. The
 * supervisor (`$DSH_HOME/bin/dsh-supervisor.sh restart`) returns at once and
 * its setsid worker performs stop → start in its own session, so this handler
 * never blocks and the client's response arrives before the server bounces.
 *
 * The route is only reachable from the same origin (the server binds
 * loopback by default); POST-only keeps a stray GET from restarting the box.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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

declare module 'cordis' {
  interface Context {
    webServer: SidebarWebServerLike
    effect(fn: () => void | (() => void), label?: string): void
  }
}

function writeJson(res: RouteResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Services required before mounting. */
export const inject = ['webServer']

/** Client plugin body. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-restart',
    handler: (req, res) => {
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: 'POST only' })
        return
      }
      try {
        const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
        const supervisor = join(dshHome, 'bin', 'dsh-supervisor.sh')
        if (!existsSync(supervisor)) {
          throw new Error(`supervisor not found: ${supervisor} (run better-dsh install.sh)`)
        }
        const child = spawn('bash', [supervisor, 'restart'], { detached: true, stdio: 'ignore' })
        child.unref()
        writeJson(res, 200, { ok: true })
      } catch (error) {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-restart-button: route')
}
