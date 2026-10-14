import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { IPC, type WindowControlAction } from '../shared/ipc'
import type { AppPaths } from '../shared/types'
import { ctx } from './context'

export function registerAppIpc(): void {
  ipcMain.handle(IPC.appGetVersion, () => app.getVersion())

  ipcMain.handle(
    IPC.appGetPaths,
    (): AppPaths => ({
      home: homedir(),
      userData: app.getPath('userData'),
      pluginDir: ctx.pluginDir,
      claudeConfigDir: process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
    })
  )

  ipcMain.handle(IPC.appOpenExternal, async (_e, url: string) => {
    if (typeof url !== 'string' || !/^(https?:|mailto:)/i.test(url)) return
    await shell.openExternal(url)
  })

  ipcMain.handle(IPC.appShowItemInFolder, (_e, path: string) => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle(IPC.appWindowControl, (e, action: WindowControlAction) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize())
    else if (action === 'close') win.close()
  })

  ipcMain.handle(IPC.appIsMaximized, (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false)

  ipcMain.handle(IPC.appSetTitle, (e, title: string) => {
    BrowserWindow.fromWebContents(e.sender)?.setTitle(title)
  })
}
