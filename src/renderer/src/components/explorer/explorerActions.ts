import type { FileEntry } from '@shared/types'
import { basename, dirname, isInside, joinPath, relativePath } from '@shared/paths'
import { atom } from '../../lib/api'
import { isMac, isWindows } from '../../lib/platform'
import { useAgentStore } from '../../stores/agent'
import { useEditorStore } from '../../stores/editor'
import { useLayoutStore } from '../../stores/layout'
import { useTerminalStore } from '../../stores/terminal'
import { errorMessage, toast } from '../../stores/toast'
import { useWorkspaceStore } from '../../stores/workspace'
import { confirmDialog } from '../ui/ConfirmDialog'
import { useExplorerStore } from './explorerStore'

/** File operations shared by the explorer tree, its context menu and the explorer.* commands. */

export const revealLabel = isMac ? 'Reveal in Finder' : isWindows ? 'Reveal in File Explorer' : 'Open Containing Folder'

/** Folder that "New File" targets: the selected folder, the selected file's folder, or the root. */
export function targetFolder(): string | null {
  const { root, selected, children } = useExplorerStore.getState()
  if (!root) return null
  if (!selected) return root
  const parent = dirname(selected)
  const entry = (children[parent] ?? []).find((e) => e.path === selected)
  if (entry?.isDirectory) return entry.path
  return isInside(root, parent) ? parent : root
}

export function startNewFile(kind: 'new-file' | 'new-folder', parent?: string | null): void {
  const folder = parent ?? targetFolder()
  if (!folder) return
  const layout = useLayoutStore.getState()
  if (!layout.sidebarVisible || layout.sidebarView !== 'explorer') useLayoutStore.setState({ sidebarVisible: true, sidebarView: 'explorer' })
  useExplorerStore.getState().startEdit({ kind, parent: folder })
}

/** Validates a file name typed into the inline input. Returns an error message or null. */
export function validateName(name: string, parent: string, current?: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'A file or folder name must be provided.'
  if (/^[/\\]|[/\\]$/.test(trimmed)) return 'The name cannot start or end with a slash.'
  if (/[<>:"|?*\u0000-\u001f]/.test(trimmed) && isWindows) return 'The name contains characters that are not allowed.'
  if (trimmed.split(/[/\\]/).some((seg) => seg === '.' || seg === '..')) return "'.' and '..' are not valid names."
  const first = trimmed.split(/[/\\]/)[0]
  const siblings = useExplorerStore.getState().children[parent] ?? []
  if (first !== current && siblings.some((e) => e.name.toLowerCase() === first.toLowerCase() && e.name !== current)) {
    return `A file or folder '${first}' already exists at this location.`
  }
  return null
}

export async function createEntry(kind: 'new-file' | 'new-folder', parent: string, name: string): Promise<void> {
  const target = joinPath(parent, name.trim())
  try {
    if (kind === 'new-file') {
      await atom.fs.createFile(target, '')
      await useExplorerStore.getState().loadDir(dirname(target))
      await useExplorerStore.getState().reveal(target)
      await useEditorStore.getState().openFile(target, { preview: false })
    } else {
      await atom.fs.createDir(target)
      await useExplorerStore.getState().loadDir(dirname(target))
      await useExplorerStore.getState().reveal(target)
      await useExplorerStore.getState().expand(target)
    }
  } catch (err) {
    toast.error(`Could not create ${kind === 'new-file' ? 'file' : 'folder'}`, errorMessage(err))
  }
}

export async function renameEntry(path: string, newName: string): Promise<void> {
  const trimmed = newName.trim()
  if (!trimmed || trimmed === basename(path)) return
  const target = joinPath(dirname(path), trimmed)
  try {
    await atom.fs.rename(path, target)
    await useExplorerStore.getState().loadDir(dirname(path))
    await useExplorerStore.getState().reveal(target)
    reopenMovedTabs(path, target)
  } catch (err) {
    toast.error('Rename failed', errorMessage(err))
  }
}

export async function moveEntry(source: string, targetDir: string): Promise<void> {
  if (dirname(source) === targetDir || source === targetDir) return
  if (isInside(source, targetDir)) {
    toast.warning('Cannot move a folder into itself')
    return
  }
  const name = basename(source)
  const siblings = useExplorerStore.getState().children[targetDir]
  if (siblings?.some((e) => e.name === name)) {
    toast.warning(`'${name}' already exists in ${basename(targetDir)}`)
    return
  }
  const target = joinPath(targetDir, name)
  try {
    await atom.fs.rename(source, target)
    const store = useExplorerStore.getState()
    await Promise.all([store.loadDir(dirname(source)), store.loadDir(targetDir)])
    await store.reveal(target)
    reopenMovedTabs(source, target)
  } catch (err) {
    toast.error('Move failed', errorMessage(err))
  }
}

/** When a file that is open in the editor moves, open it at its new location (clean tabs only). */
function reopenMovedTabs(from: string, to: string): void {
  const editor = useEditorStore.getState()
  for (const tab of editor.tabs) {
    if (tab.kind !== 'file' || tab.dirty || !isInside(from, tab.path)) continue
    const moved = to + tab.path.slice(from.length)
    const wasActive = editor.activeTabId === tab.id
    void editor.closeTab(tab.id).then(() => (wasActive ? editor.openFile(moved, { preview: tab.preview }) : undefined))
  }
}

export async function deleteEntry(entry: Pick<FileEntry, 'path' | 'name' | 'isDirectory'>): Promise<void> {
  const ok = await confirmDialog({
    title: `Delete '${entry.name}'?`,
    message: entry.isDirectory
      ? 'This folder and everything inside it will be moved to the trash.'
      : 'The file will be moved to the trash. You can restore it from there.',
    confirmLabel: 'Move to Trash',
    danger: true
  })
  if (!ok) return
  try {
    await atom.fs.delete(entry.path)
    const store = useExplorerStore.getState()
    if (store.selected && isInside(entry.path, store.selected)) store.select(null)
    await store.loadDir(dirname(entry.path))
  } catch (err) {
    toast.error('Delete failed', errorMessage(err))
  }
}

export async function copyText(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`, text)
  } catch (err) {
    toast.error('Clipboard unavailable', errorMessage(err))
  }
}

export function copyPath(path: string): Promise<void> {
  return copyText(path, 'Path')
}

export function copyRelativePath(path: string): Promise<void> {
  const root = useWorkspaceStore.getState().workspace?.path
  return copyText(root ? relativePath(root, path) || '.' : path, 'Relative path')
}

export function revealInOs(path: string): void {
  void atom.app.showItemInFolder(path).catch((err: unknown) => toast.error(revealLabel, errorMessage(err)))
}

/** Opens a new integrated terminal whose working directory is the folder (or the file's folder). */
export async function openInTerminal(entry: Pick<FileEntry, 'path' | 'isDirectory'>): Promise<void> {
  const dir = entry.isDirectory ? entry.path : dirname(entry.path)
  useLayoutStore.getState().showPanel('terminal')
  const id = await useTerminalStore.getState().create({ cwd: dir, focus: true })
  if (id) return
  // Fallback (e.g. a terminal is still starting): hand the user a ready `cd` command.
  const quoted = isWindows ? `cd "${dir}"` : `cd '${dir.replace(/'/g, `'\\''`)}'`
  await copyText(quoted, 'cd command')
}

export function addToChat(entry: Pick<FileEntry, 'path' | 'isDirectory'>): void {
  const agent = useAgentStore.getState()
  agent.addAttachment({ type: entry.isDirectory ? 'folder' : 'file', path: entry.path })
  useLayoutStore.getState().setAgentVisible(true)
  agent.focusComposer()
}
