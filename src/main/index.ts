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
import { registerAgentIpc, disposeAgents } from './agent/manager'
import { registerAiIpc } from './agent/oneshot'
import { registerIdeBridgeIpc } from './agent/ide-bridge'

const THEME_BACKGROUND: Record<string, string> = {
  'atom-dark': '#16171d',
  'atom-midnight': '#0b0d14',
  'atom-light': '#f7f7f9'
}

app.setName('ATOM Code')
// Identify ATOM Code to the Claude Agent SDK (User-Agent of API requests).
process.env.CLAUDE_AGENT_SDK_CLIENT_APP = `atom-code/${app.getVersion()}`

let allowClose = false

function createWindow(): BrowserWindow {
  const settings = settingsService.get()
  const isMac = process.platform === 'darwin'
  const isLight = settings.theme === 'atom-light'
  const background = THEME_BACKGROUND[settings.theme] ?? THEME_BACKGROUND['atom-dark']
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
            symbolColor: isLight ? '#3a3d4a' : '#c9cbd6',
            height: 38
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
    ctx.send(IPC.appBeforeCloseEvent)
    // Never trap the user: close anyway if the renderer does not answer.
    setTimeout(() => {
      if (!allowClose && !win.isDestroyed()) {
        allowClose = true
        win.close()
      }
    }, 4000)
  })
  win.on('closed', () => ctx.setWindow(null))

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
    await settingsService.init()

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

    ipcMain.handle(IPC.appConfirmClose, (_e, allow: boolean) => {
      if (!allow) return
      allowClose = true
      ctx.getWindow()?.close()
    })

    installContentSecurityPolicy()
    buildMenu()
    createWindow()

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

  app.on('before-quit', async () => {
    allowClose = true
    stopWatching()
    disposeTerminals()
    disposeAuth()
    await disposeAgents()
  })
}
