import { create } from 'zustand'
import type { FsChangeEvent, WorkspaceInfo } from '@shared/types'
import { isInside, normalizeSlashes } from '@shared/paths'
import { atom } from '../lib/api'
import type { WorkspaceStoreApi } from './contracts'
import { useSettingsStore } from './settings'
import { errorMessage, toast } from './toast'

export interface OpenWorkspaceOptions {
  /** Do not toast on failure (used when restoring the last workspace at startup). */
  silent?: boolean
}

export interface WorkspaceState extends WorkspaceStoreApi {
  /** True while a workspace is being opened. */
  opening: boolean
  /** Bumped on every successful open so views can reset their state. */
  generation: number
  openWorkspace(path: string, options?: OpenWorkspaceOptions): Promise<void>
}

let filesRequest = 0

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: null,
  files: [],
  filesLoading: false,
  opening: false,
  generation: 0,

  openFolderDialog: async () => {
    try {
      const path = await atom.workspace.openDialog()
      if (path) await get().openWorkspace(path)
    } catch (err) {
      toast.error('Could not open folder', errorMessage(err))
    }
  },

  openWorkspace: async (path, options = {}) => {
    set({ opening: true })
    try {
      const info = await atom.workspace.open(path)
      applyWorkspace(info)
    } catch (err) {
      if (!options.silent) toast.error('Could not open folder', errorMessage(err))
      else console.warn('[workspace] restore failed', err)
    } finally {
      set({ opening: false })
    }
  },

  closeWorkspace: () => {
    filesRequest++
    set({ workspace: null, files: [], filesLoading: false, generation: get().generation + 1 })
    void useSettingsStore
      .getState()
      .update({ lastWorkspace: null })
      .catch(() => undefined)
  },

  refreshFiles: async () => {
    const ws = get().workspace
    if (!ws) {
      set({ files: [], filesLoading: false })
      return
    }
    const req = ++filesRequest
    set({ filesLoading: true })
    try {
      const files = await atom.workspace.listFiles(ws.path)
      if (req !== filesRequest) return
      set({ files, filesLoading: false })
    } catch (err) {
      if (req !== filesRequest) return
      set({ filesLoading: false })
      console.warn('[workspace] listFiles failed', err)
    }
  }
}))

function applyWorkspace(info: WorkspaceInfo | null): void {
  const prev = useWorkspaceStore.getState().workspace
  const same = !!prev && !!info && normalizeSlashes(prev.path) === normalizeSlashes(info.path)
  if (same) {
    if (prev.name !== info.name || prev.isGitRepo !== info.isGitRepo) useWorkspaceStore.setState({ workspace: info })
    return
  }
  useWorkspaceStore.setState({ workspace: info, files: [], generation: useWorkspaceStore.getState().generation + 1 })
  if (info) void useWorkspaceStore.getState().refreshFiles()
}

// The main process may switch workspaces on its own (e.g. a second instance passing a folder).
const offWorkspaceChanged = atom.workspace.onChanged((ws) => applyWorkspace(ws))

/** `.git` internals are never part of the quick-open index (ripgrep lists with `--glob !.git`). */
function isGitInternal(path: string): boolean {
  return /(^|\/)\.git(\/|$)/.test(normalizeSlashes(path))
}

/**
 * Keep the quick-open file list fresh incrementally. (A full re-list would hit main's 5 s cache and return
 * stale data right after a change.) A batch is applied in one pass — later events for a path win — so a
 * large checkout does not copy the (up to 50k entry) list once per event.
 */
const offFsChange = atom.fs.onChange((events: FsChangeEvent[]) => {
  const { workspace, files } = useWorkspaceStore.getState()
  if (!workspace || files.length === 0) return
  const present = new Map<string, boolean>()
  const removedDirs: string[] = []
  for (const e of events) {
    if (!isInside(workspace.path, e.path) || isGitInternal(e.path)) continue
    if (e.kind === 'add') present.set(e.path, true)
    else if (e.kind === 'unlink') present.set(e.path, false)
    else if (e.kind === 'unlinkDir') {
      removedDirs.push(e.path)
      for (const p of present.keys()) if (isInside(e.path, p)) present.set(p, false)
    }
  }
  if (!present.size && !removedDirs.length) return
  let changed = false
  const next: string[] = []
  for (const f of files) {
    const state = present.get(f)
    const keep = state ?? !removedDirs.some((d) => isInside(d, f))
    if (keep) next.push(f)
    else changed = true
    if (state !== undefined) present.delete(f)
  }
  for (const [p, isPresent] of present) {
    if (!isPresent) continue
    next.push(p)
    changed = true
  }
  if (changed) useWorkspaceStore.setState({ files: next })
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    offWorkspaceChanged()
    offFsChange()
  })
}
