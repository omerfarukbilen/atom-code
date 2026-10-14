/**
 * IDE bridge — lets main-process code (the agent's `atom-ide` MCP tools) query the renderer:
 * open editors, selection, diagnostics, opening files (docs/ARCHITECTURE.md §5).
 *
 * main → renderer: `IPC.ideRequestEvent` with an `IdeRequest`
 * renderer → main: `IPC.ideRespond(requestId, { result } | { error })`
 */
import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { IdeMethod, IdeRequest } from '../../shared/types'
import { ctx } from '../context'

const DEFAULT_TIMEOUT_MS = 8000
const MAX_TIMEOUT_MS = 120_000

interface PendingRequest {
  method: IdeMethod
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingRequest>()
let registered = false

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function settle(requestId: string): PendingRequest | undefined {
  const req = pending.get(requestId)
  if (!req) return undefined
  pending.delete(requestId)
  clearTimeout(req.timer)
  return req
}

/**
 * Ask the renderer to answer an IDE query. Resolves with the renderer's result, rejects with a clear
 * Error when the window is gone, the renderer reports an error, or it does not answer in time.
 */
export function requestIde<T>(method: IdeMethod, params: Record<string, unknown> = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const win = ctx.getWindow()
  if (!win || win.webContents.isDestroyed()) {
    return Promise.reject(new Error('The ATOM Code window is not open, so the editor cannot be queried right now.'))
  }
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS
  const requestId = randomUUID()

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!settle(requestId)) return
      reject(new Error(`The editor did not answer "${method}" within ${Math.round(timeout / 100) / 10}s (it may still be loading).`))
    }, timeout)
    pending.set(requestId, { method, resolve: (value) => resolve(value as T), reject, timer })
    const request: IdeRequest = { requestId, method, params }
    try {
      ctx.send(IPC.ideRequestEvent, request)
    } catch (err) {
      settle(requestId)
      reject(new Error(`Could not reach the editor: ${err instanceof Error ? err.message : String(err)}`))
    }
  })
}

/** Reject every in-flight IDE request (e.g. when the window is closing). */
export function cancelPendingIdeRequests(reason = 'The editor window was closed.'): void {
  for (const id of [...pending.keys()]) settle(id)?.reject(new Error(reason))
}

export function registerIdeBridgeIpc(): void {
  if (registered) return
  registered = true
  ipcMain.handle(IPC.ideRespond, (event, requestId: unknown, payload: unknown) => {
    if (typeof requestId !== 'string') return
    // Only the ATOM Code window may answer IDE requests.
    const win = ctx.getWindow()
    if (!win || event.sender !== win.webContents) return
    const req = settle(requestId)
    if (!req) return // timed out or unknown — nothing to do
    if (isRecord(payload) && 'error' in payload && payload.error !== undefined && payload.error !== null) {
      const message = typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error)
      req.reject(new Error(message || `The editor could not complete "${req.method}".`))
      return
    }
    req.resolve(isRecord(payload) ? payload.result : undefined)
  })
}
