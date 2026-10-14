import { dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { IPC } from '../../shared/ipc'
import type { RecentWorkspace, WorkspaceInfo } from '../../shared/types'
import { ctx } from '../context'
import { assertAbsolutePath, friendlyFsError, pathExists, startWatching, stopWatching } from './fs'
import { listWorkspaceFiles } from './search'
import { settingsService } from './settings'

const MAX_RECENT_WORKSPACES = 12
const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin'

let current: WorkspaceInfo | null = null

/** The workspace currently open in the window, or null. */
export function getCurrentWorkspace(): WorkspaceInfo | null {
  return current
}

function samePath(a: string, b: string): boolean {
  return CASE_INSENSITIVE_FS ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** True when `.git` (folder, or file for worktrees/submodules) exists in `root` or any ancestor. */
async function detectGitRepo(root: string): Promise<boolean> {
  let dir = root
  for (;;) {
    if (await pathExists(join(dir, '.git'))) return true
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

function folderName(p: string): string {
  return basename(p) || p
}

async function openWorkspace(rawPath: unknown): Promise<WorkspaceInfo> {
  const root = assertAbsolutePath(rawPath, 'Folder path')
  try {
    const st = await stat(root)
    if (!st.isDirectory()) throw new Error(`Not a folder: ${root}`)
  } catch (err) {
    const e = friendlyFsError(err, root, 'Opening folder')
    throw e.message.startsWith('File not found') ? new Error(`Folder not found: ${root}`) : e
  }

  const info: WorkspaceInfo = { path: root, name: folderName(root), isGitRepo: await detectGitRepo(root) }
  const reopened = current !== null && samePath(current.path, root)
  current = info

  const settings = settingsService.get()
  const entry: RecentWorkspace = { path: root, name: info.name, openedAt: Date.now() }
  const recentWorkspaces = [entry, ...settings.recentWorkspaces.filter((r) => !samePath(r.path, root))].slice(
    0,
    MAX_RECENT_WORKSPACES
  )
  try {
    await settingsService.update({ recentWorkspaces, lastWorkspace: root })
  } catch {
    /* persisting history is best effort; the workspace is open regardless */
  }

  // Re-opening the same folder keeps the running watcher (and its pending events) alive.
  if (!reopened) startWatching(root)
  ctx.send(IPC.workspaceChangedEvent, info)
  return info
}

async function showOpenDialog(): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: 'Open Folder',
    buttonLabel: 'Open',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: current?.path ?? settingsService.get().lastWorkspace ?? homedir()
  }
  const win = ctx.getWindow()
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0] ?? null
}

export function registerWorkspaceIpc(): void {
  ipcMain.handle(IPC.workspaceOpenDialog, () => showOpenDialog())
  ipcMain.handle(IPC.workspaceOpen, (_e, path: unknown) => openWorkspace(path))
  ipcMain.handle(IPC.workspaceGetCurrent, () => current)
  ipcMain.handle(IPC.workspaceListFiles, (_e, root: unknown) => listWorkspaceFiles(assertAbsolutePath(root, 'Workspace root')))

  // The renderer closes a workspace by clearing `lastWorkspace`; release the watcher when that happens.
  let lastWorkspace = settingsService.get().lastWorkspace
  settingsService.onChange((s) => {
    const prev = lastWorkspace
    lastWorkspace = s.lastWorkspace
    if (prev !== null && s.lastWorkspace === null && current) {
      current = null
      stopWatching()
    }
  })
}
