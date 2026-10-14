import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'

/**
 * Process-wide context shared by all main-process services.
 * Services must use `ctx.send` to push events to the renderer (it is a no-op when the window is gone).
 */
class MainContext {
  private window: BrowserWindow | null = null

  readonly isDev = !app.isPackaged

  setWindow(win: BrowserWindow | null): void {
    this.window = win
  }

  getWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null
  }

  send<T>(channel: string, payload?: T): void {
    const win = this.getWindow()
    if (!win || win.webContents.isDestroyed()) return
    win.webContents.send(channel, payload)
  }

  /** `<repo>/resources` in development, `process.resourcesPath` when packaged. */
  get resourcesDir(): string {
    return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  }

  /** Bundled ATOM plugin (skills, subagents, slash commands) loaded into every agent session. */
  get pluginDir(): string {
    return join(this.resourcesDir, 'atom-plugin')
  }
}

export const ctx = new MainContext()

/** Convert an `.asar` path into its `.asar.unpacked` twin (native binaries cannot run from inside asar). */
export function unpackedPath(p: string): string {
  return p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}
