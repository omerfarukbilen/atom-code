import { app, BrowserWindow, ipcMain, nativeTheme, session, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { registerAppIpc } from './app-ipc'
import { ctx } from './context'
import { buildMenu } from './menu'
import { registerSettingsIpc, settingsService } from './services/settings'
import { registerWorkspaceIpc } from './services/workspace'
import { registerFsIpc, stopWatching } from './services/fs'
import { registerSearchIpc } from './services/search'
import { registerGitIpc } from './services/git'
import { registerTerminalIpc, disposeTerminals } from './services/terminal'
import { registerAuthIpc, disposeAuth } from './services/auth'
import { registerLibraryIpc } from './services/library'
import { registerAgentIpc, disposeAgents, closeAllChats } from './agent/manager'
import { registerAiIpc, disposeAi } from './agent/oneshot'
import { registerIdeBridgeIpc, cancelPendingIdeRequests } from './agent/ide-bridge'
import { adoptLoginShellPath } from './services/shell-env'
import { registerWorkspaceTrustIpc } from './agent/workspace-trust'

const THEME_BACKGROUND: Record<string, string> = {
  'atom-dark': '#16171d',
  'atom-midnight': '#0b0d14',
  'atom-light': '#f7f7f9'
}

app.setName('ATOM Code')
// Identify ATOM Code to the Claude Agent SDK (User-Agent of API requests).
process.env.CLAUDE_AGENT_SDK_CLIENT_APP = `atom-code/${app.getVersion()}`
// GUI launches get a minimal PATH: start reading the login shell's PATH now, services wait for it.
const shellPathReady = adoptLoginShellPath()

let allowClose = false
let closeAckTimer: ReturnType<typeof setTimeout> | undefined
/** True between a close request and the renderer's answer. */
let closeRequested = false
/** The close request came from quitting the app (Cmd+Q, menu, Dock, logout): quit once it is allowed. */
let quitRequested = false

const TITLE_BAR_HEIGHT = 38

function themeColors(theme: string): { isLight: boolean; background: string; symbolColor: string } {
  const isLight = theme === 'atom-light'
  return {
    isLight,
    background: THEME_BACKGROUND[theme] ?? THEME_BACKGROUND['atom-dark'],
    symbolColor: isLight ? '#3a3d4a' : '#c9cbd6'
  }
}

/** Re-theme the native parts of the window (caption buttons overlay, background, native dialogs/menus). */
function applyWindowTheme(win: BrowserWindow, theme: string): void {
  const { isLight, background, symbolColor } = themeColors(theme)
  nativeTheme.themeSource = isLight ? 'light' : 'dark'
  if (win.isDestroyed()) return
  win.setBackgroundColor(background)
  if (process.platform !== 'darwin') {
    try {
      win.setTitleBarOverlay({ color: background, symbolColor, height: TITLE_BAR_HEIGHT })
    } catch {
      /* no overlay on this platform / window */
    }
  }
}

/** Quit (when quitting was requested) or close the window, once closing is allowed. */
function proceedWithClose(win: BrowserWindow | null): void {
  allowClose = true
  if (quitRequested) app.quit()
  else if (win && !win.isDestroyed()) win.close()
}

function createWindow(): BrowserWindow {
  const settings = settingsService.get()
  const isMac = process.platform === 'darwin'
  const { isLight, background, symbolColor } = themeColors(settings.theme)
  nativeTheme.themeSource = isLight ? 'light' : 'dark'

  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: background,
    title: 'ATOM Code',
    icon: join(ctx.resourcesDir, 'icon.png'),
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 12 } }
      : {
          titleBarOverlay: {
            color: background,
            symbolColor,
            height: TITLE_BAR_HEIGHT
          }
        }),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  ctx.setWindow(win)

  win.once('ready-to-show', () => win.show())
  win.on('maximize', () => ctx.send(IPC.appMaximizedEvent, true))
  win.on('unmaximize', () => ctx.send(IPC.appMaximizedEvent, false))

  // Ask the renderer whether it is safe to close (unsaved files). It answers via IPC.appConfirmClose.
  win.on('close', (e) => {
    if (allowClose || win.webContents.isDestroyed()) return
    e.preventDefault()
    closeRequested = true
    ctx.send(IPC.appBeforeCloseEvent)
    // Never trap the user: close anyway if the renderer does not acknowledge the request quickly
    // (crashed, hung or still booting). Once acknowledged, the renderer's dialog decides.
    clearTimeout(closeAckTimer)
    closeAckTimer = setTimeout(() => {
      if (!allowClose && !win.isDestroyed()) proceedWithClose(win)
    }, 2500)
  })
  win.on('unresponsive', () => {
    if (!closeRequested) return
    allowClose = true
    win.destroy()
    if (quitRequested) app.quit()
  })
  // A reloaded or closed renderer has no record of its chats, terminals or IDE requests: release them
  // so CLIs, shells and permission prompts are never orphaned (macOS keeps the app alive on close).
  const releaseRendererState = (): void => {
    void closeAllChats()
    disposeTerminals()
    cancelPendingIdeRequests()
  }
  win.webContents.on('did-navigate', releaseRendererState)
  win.on('closed', () => {
    ctx.setWindow(null)
    releaseRendererState()
  })

  // External links open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file:')) return
    e.preventDefault()
    if (/^https?:/i.test(url)) shell.openExternal(url)
  })

  // Developer aid: ATOM_CAPTURE=/path/shot.png renders the window, saves a screenshot and quits.
  const capturePath = process.env['ATOM_CAPTURE']
  if (capturePath) {
    win.webContents.once('did-finish-load', () => {
      const delay = Number(process.env['ATOM_CAPTURE_DELAY'] ?? 4000)
      setTimeout(async () => {
        try {
          const image = await win.webContents.capturePage()
          const { writeFile } = await import('node:fs/promises')
          await writeFile(capturePath, image.toPNG())
        } catch (err) {
          console.error('[capture] failed', err)
        }
        allowClose = true
        app.quit()
      }, delay)
    })
  }

  if (ctx.isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
  return win
}

function installContentSecurityPolicy(): void {
  if (ctx.isDev) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; worker-src 'self' blob:; " +
            "connect-src 'self'; object-src 'none'; base-uri 'self'"
        ]
      }
    })
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = ctx.getWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    await Promise.all([settingsService.init(), shellPathReady])

    registerSettingsIpc()
    registerAppIpc()
    registerWorkspaceIpc()
    registerFsIpc()
    registerSearchIpc()
    registerGitIpc()
    registerTerminalIpc()
    registerAuthIpc()
    registerLibraryIpc()
    registerAgentIpc()
    registerAiIpc()
    registerIdeBridgeIpc()
    registerWorkspaceTrustIpc()

    ipcMain.handle(IPC.appCloseAck, () => {
      clearTimeout(closeAckTimer)
      closeAckTimer = undefined
      // The unsaved-changes dialog is about to show: make sure it can be seen (a quit can come from the
      // Dock or a logout while the window is minimized or hidden).
      const win = ctx.getWindow()
      if (win) {
        if (win.isMinimized()) win.restore()
        if (!win.isVisible()) win.show()
        win.focus()
      }
    })
    ipcMain.handle(IPC.appConfirmClose, (_e, allow: boolean) => {
      clearTimeout(closeAckTimer)
      closeAckTimer = undefined
      closeRequested = false
      if (!allow) {
        // "Cancel" in the unsaved-changes dialog also cancels a quit.
        quitRequested = false
        return
      }
      // macOS does not quit when its last window closes, so a confirmed quit calls app.quit() again.
      proceedWithClose(ctx.getWindow())
    })

    installContentSecurityPolicy()
    buildMenu()
    createWindow()

    // Native parts of the window follow the theme setting at runtime too.
    let currentTheme = settingsService.get().theme
    settingsService.onChange((next) => {
      if (next.theme === currentTheme) return
      currentTheme = next.theme
      const win = ctx.getWindow()
      if (win) applyWindowTheme(win, next.theme)
      else nativeTheme.themeSource = themeColors(next.theme).isLight ? 'light' : 'dark'
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        allowClose = false
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Quitting (Cmd+Q, File ▸ Quit, Dock ▸ Quit, logout) goes through the same unsaved-changes check as
  // closing the window: hold the quit, ask the renderer, and quit again once it allows it.
  app.on('before-quit', (e) => {
    const win = ctx.getWindow()
    if (allowClose || !win || win.webContents.isDestroyed()) return
    e.preventDefault()
    quitRequested = true
    // The window's 'close' handler asks the renderer (with the acknowledge timeout and hang fallback).
    if (!closeRequested) win.close()
  })

  // Release everything only once the quit is really happening (never for a cancelled one).
  app.on('will-quit', () => {
    stopWatching()
    disposeTerminals()
    disposeAuth()
    disposeAi()
    cancelPendingIdeRequests('ATOM Code is quitting.')
    void disposeAgents()
  })
}
