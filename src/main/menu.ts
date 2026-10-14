import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { IPC } from '../shared/ipc'
import type { MenuCommand } from '../shared/types'
import { manageWorkspaceTrust } from './agent/workspace-trust'
import { ctx } from './context'
import { getCurrentWorkspace } from './services/workspace'

/**
 * Native menu. Command items only *display* their shortcut (registerAccelerator: false) — the renderer
 * owns all keybindings so that shortcuts behave the same with or without the menu bar.
 */
export function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const cmd = (label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => ctx.send(IPC.appMenuCommandEvent, command)
  })

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: 'ATOM Code',
            submenu: [
              cmd('About ATOM Code', 'help.about'),
              { type: 'separator' },
              cmd('Settings…', 'view.settings', 'Cmd+,'),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        cmd('New File', 'file.newFile', 'CmdOrCtrl+N'),
        cmd('Open Folder…', 'file.openFolder', 'CmdOrCtrl+O'),
        { type: 'separator' },
        cmd('Save', 'file.save', 'CmdOrCtrl+S'),
        cmd('Save All', 'file.saveAll', 'CmdOrCtrl+Alt+S'),
        { type: 'separator' },
        cmd('Close Editor', 'file.closeEditor', 'CmdOrCtrl+W'),
        ...(isMac ? [] : ([{ type: 'separator' }, cmd('Settings', 'view.settings', 'Ctrl+,'), { role: 'quit' }] as MenuItemConstructorOptions[]))
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        cmd('Command Palette…', 'view.commandPalette', 'CmdOrCtrl+Shift+P'),
        cmd('Go to File…', 'view.quickOpen', 'CmdOrCtrl+P'),
        { type: 'separator' },
        cmd('Toggle Sidebar', 'view.toggleSidebar', 'CmdOrCtrl+B'),
        cmd('Toggle Panel', 'view.togglePanel', 'CmdOrCtrl+J'),
        cmd('Toggle Agent', 'view.toggleAgent', 'CmdOrCtrl+Alt+B'),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(ctx.isDev ? ([{ role: 'toggleDevTools' }, { role: 'reload' }] as MenuItemConstructorOptions[]) : [])
      ]
    },
    {
      label: 'Agent',
      submenu: [
        cmd('New Chat', 'agent.newChat', 'CmdOrCtrl+Shift+L'),
        cmd('Focus Agent', 'agent.focus', 'CmdOrCtrl+L'),
        { type: 'separator' },
        {
          label: 'Workspace Trust…',
          click: () => void manageWorkspaceTrust(getCurrentWorkspace()?.path ?? null).catch(() => undefined)
        }
      ]
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? ([{ role: 'front' }] as MenuItemConstructorOptions[]) : [])]
    },
    {
      role: 'help',
      submenu: [cmd(`About ATOM Code ${app.getVersion()}`, 'help.about')]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
