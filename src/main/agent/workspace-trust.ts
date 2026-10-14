/**
 * Workspace trust — the decision and the prompt (see trust.ts for why it exists).
 *
 * Until a workspace is trusted, agent sessions run without the repository's Claude Code project
 * configuration (no `project`/`local` setting sources, `strictMcpConfig`, no ATOM.md). The user is asked
 * once per app run, before the first agent launch in a folder that carries such configuration; the
 * answer "Trust" is stored in `AppSettings.trustedWorkspaces` (which restarts idle chats so they load
 * it). Agent ▸ Workspace Trust… (macOS menu) and `atom.workspace.manageTrust()` change it later.
 */
import { basename, isAbsolute } from 'node:path'
import { dialog, ipcMain, type MessageBoxOptions } from 'electron'
import { IPC } from '../../shared/ipc'
import { ctx } from '../context'
import { settingsService } from '../services/settings'
import { getCurrentWorkspace } from '../services/workspace'
import { canonicalWorkspacePath, findProjectConfig, isPathTrusted } from './trust'

/** Folders the user declined to trust in this app run (canonical paths): not asked again until restart. */
const declined = new Set<string>()
/** One prompt per folder even when several chats launch at once. */
const prompts = new Map<string, Promise<boolean>>()

const MAX_LISTED = 6

export function isWorkspaceTrusted(workspace: string, trusted: readonly unknown[] = settingsService.get().trustedWorkspaces): boolean {
  return isPathTrusted(trusted, workspace)
}

/**
 * Whether an agent launch in `workspace` may load the folder's Claude Code project configuration.
 * Asks the user (once per app run) when the folder carries such configuration and is not trusted yet.
 * Never throws: any failure counts as "not trusted".
 */
export async function ensureWorkspaceTrust(workspace: string): Promise<boolean> {
  if (isWorkspaceTrusted(workspace)) return true
  // The scripted fake agent ignores its options; never block UI automation on a native dialog.
  if (process.env['ATOM_FAKE_AGENT'] === '1') return false
  const key = canonicalWorkspacePath(workspace)
  if (declined.has(key)) return false
  const found = findProjectConfig(workspace)
  if (found.length === 0) return false // nothing the session would load
  let pending = prompts.get(key)
  if (!pending) {
    pending = askToTrust(workspace, found)
      .catch(() => false)
      .finally(() => prompts.delete(key))
    prompts.set(key, pending)
  }
  return pending
}

function listFound(found: string[]): string {
  const shown = found.slice(0, MAX_LISTED).map((f) => `  • ${f}`)
  if (found.length > MAX_LISTED) shown.push(`  • … and ${found.length - MAX_LISTED} more`)
  return shown.join('\n')
}

async function showMessage(options: MessageBoxOptions): Promise<number> {
  const win = ctx.getWindow()
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return response
}

async function askToTrust(workspace: string, found: string[]): Promise<boolean> {
  const response = await showMessage({
    type: 'warning',
    title: 'Trust this folder?',
    message: `Do you trust the files in “${basename(workspace) || workspace}”?`,
    detail: [
      'This folder contains Claude Code project configuration:',
      listFound(found),
      '',
      'If you trust it, the agent loads it: project hooks and MCP servers can run commands on this computer with your permissions — without asking — and project instructions (CLAUDE.md, ATOM.md) are added to the agent’s context.',
      '',
      'Only trust folders whose contents you or someone you trust wrote. Without trust the agent still works, but ignores the project’s Claude Code settings, hooks, MCP servers and instructions. You can change this later with “Workspace Trust…”.'
    ].join('\n'),
    buttons: ['Trust Folder', 'Don’t Trust'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })
  if (response === 0) {
    await trustWorkspace(workspace)
    return true
  }
  declined.add(canonicalWorkspacePath(workspace))
  return false
}

function storedTrust(): string[] {
  const list: unknown = settingsService.get().trustedWorkspaces
  return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string' && e.trim() !== '') : []
}

/** Store `workspace` as trusted (idle chats restart to load its configuration). */
export async function trustWorkspace(workspace: string): Promise<void> {
  const key = canonicalWorkspacePath(workspace)
  declined.delete(key)
  const list = storedTrust()
  if (isPathTrusted(list, workspace)) return
  await settingsService.update({ trustedWorkspaces: [...list, key] })
}

/** Remove every entry that trusts `workspace` (idle chats restart without its configuration). */
export async function revokeWorkspaceTrust(workspace: string): Promise<void> {
  const list = storedTrust()
  const remaining = list.filter((e) => !isPathTrusted([e], workspace))
  if (remaining.length !== list.length) await settingsService.update({ trustedWorkspaces: remaining })
  declined.add(canonicalWorkspacePath(workspace))
}

/** Agent ▸ Workspace Trust…: show the current folder's trust state and let the user change it. */
export async function manageWorkspaceTrust(workspace: string | null): Promise<void> {
  if (!workspace) {
    await showMessage({ type: 'info', title: 'Workspace Trust', message: 'Open a folder first.', buttons: ['OK'], noLink: true })
    return
  }
  const name = basename(workspace) || workspace
  const found = findProjectConfig(workspace)
  const contents = found.length > 0 ? `Claude Code project configuration in this folder:\n${listFound(found)}` : 'This folder has no Claude Code project configuration right now.'
  if (isWorkspaceTrusted(workspace)) {
    const response = await showMessage({
      type: 'info',
      title: 'Workspace Trust',
      message: `“${name}” is trusted.`,
      detail: `${contents}\n\nAgent sessions load the folder’s project settings, hooks, MCP servers and instructions. Revoking trust restarts idle chats without them.`,
      buttons: ['Keep Trusted', 'Revoke Trust'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (response === 1) await revokeWorkspaceTrust(workspace)
    return
  }
  const response = await showMessage({
    type: 'warning',
    title: 'Workspace Trust',
    message: `“${name}” is not trusted.`,
    detail: `${contents}\n\nTrusting it lets project hooks and MCP servers run commands on this computer with your permissions, and adds project instructions to the agent’s context. Only trust folders whose contents you or someone you trust wrote.`,
    buttons: ['Trust Folder', 'Keep Untrusted'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })
  if (response === 0) await trustWorkspace(workspace)
}

/** `IPC.workspaceManageTrust`: the renderer's entry point to the trust dialog (menus are hidden on Windows/Linux). */
export function registerWorkspaceTrustIpc(): void {
  ipcMain.removeHandler(IPC.workspaceManageTrust)
  ipcMain.handle(IPC.workspaceManageTrust, async (_e, path: unknown) => {
    const workspace = typeof path === 'string' && path.trim() && isAbsolute(path) ? path : (getCurrentWorkspace()?.path ?? null)
    await manageWorkspaceTrust(workspace)
    return workspace ? isWorkspaceTrusted(workspace) : false
  })
}
