import { create } from 'zustand'
import type { FileEntry, FsChangeEvent } from '@shared/types'
import { dirname, isInside, normalizeSlashes } from '@shared/paths'
import { atom } from '../../lib/api'
import { useWorkspaceStore } from '../../stores/workspace'

/**
 * Explorer tree state: lazily loaded directory listings, expanded folders (persisted per workspace),
 * selection, inline editing and drag-and-drop target. Lives outside the component so the tree keeps its
 * state while another sidebar view is shown, and so fs events are applied even when it is hidden.
 */
export type ExplorerEditing = { kind: 'new-file' | 'new-folder'; parent: string } | { kind: 'rename'; path: string }

interface ExplorerState {
  root: string | null
  children: Record<string, FileEntry[]>
  loading: Record<string, boolean>
  expanded: Record<string, boolean>
  selected: string | null
  editing: ExplorerEditing | null
  dropTarget: string | null
  /** Incremented whenever the view should scroll the selection into view. */
  revealNonce: number
  rootError: string | null

  reset(root: string | null): void
  loadDir(path: string): Promise<void>
  toggle(path: string): void
  expand(path: string): Promise<void>
  collapse(path: string): void
  collapseAll(): void
  refreshAll(): Promise<void>
  select(path: string | null, reveal?: boolean): void
  reveal(path: string): Promise<void>
  startEdit(editing: ExplorerEditing | null): void
  setDropTarget(path: string | null): void
}

const STORAGE_PREFIX = 'atom.explorer.expanded:'

function loadExpanded(root: string): Record<string, boolean> {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_PREFIX + root) ?? '[]') as unknown
    if (!Array.isArray(list)) return {}
    return Object.fromEntries(list.filter((p): p is string => typeof p === 'string').map((p) => [p, true]))
  } catch {
    return {}
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function saveExpanded(root: string, expanded: Record<string, boolean>): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const list = Object.keys(expanded).filter((k) => expanded[k]).slice(0, 500)
      localStorage.setItem(STORAGE_PREFIX + root, JSON.stringify(list))
    } catch {
      /* storage unavailable */
    }
  }, 300)
}

const inflight = new Map<string, Promise<void>>()

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  root: null,
  children: {},
  loading: {},
  expanded: {},
  selected: null,
  editing: null,
  dropTarget: null,
  revealNonce: 0,
  rootError: null,

  reset: (root) => {
    inflight.clear()
    const expanded = root ? loadExpanded(root) : {}
    set({ root, children: {}, loading: {}, expanded, selected: null, editing: null, dropTarget: null, rootError: null })
    if (!root) return
    void get()
      .loadDir(root)
      .then(() => {
        // Restore previously expanded folders (parents first so the tree fills in top-down).
        const dirs = Object.keys(expanded)
          .filter((d) => isInside(root, d) && d !== root)
          .sort((a, b) => a.length - b.length)
        return Promise.all(dirs.map((d) => get().loadDir(d)))
      })
  },

  loadDir: (path) => {
    const existing = inflight.get(path)
    if (existing) return existing
    const slowTimer = setTimeout(() => set({ loading: { ...get().loading, [path]: true } }), 150)
    const p = atom.fs
      .readDir(path)
      .then((entries) => {
        const root = get().root
        if (!root || !isInside(root, path)) return
        set({ children: { ...get().children, [path]: entries } })
        if (path === get().root) set({ rootError: null })
      })
      .catch((err: unknown) => {
        if (path === get().root) {
          set({ rootError: err instanceof Error ? err.message : String(err) })
          return
        }
        // Folder vanished or is unreadable: forget it.
        const { [path]: _gone, ...children } = get().children
        const expanded = { ...get().expanded }
        delete expanded[path]
        set({ children, expanded })
      })
      .finally(() => {
        clearTimeout(slowTimer)
        inflight.delete(path)
        if (get().loading[path]) {
          const { [path]: _done, ...loading } = get().loading
          set({ loading })
        }
      })
    inflight.set(path, p)
    return p
  },

  toggle: (path) => {
    if (get().expanded[path]) get().collapse(path)
    else void get().expand(path)
  },

  expand: async (path) => {
    const expanded = { ...get().expanded, [path]: true }
    set({ expanded })
    const root = get().root
    if (root) saveExpanded(root, expanded)
    if (!get().children[path]) await get().loadDir(path)
  },

  collapse: (path) => {
    const expanded = { ...get().expanded }
    delete expanded[path]
    set({ expanded })
    const root = get().root
    if (root) saveExpanded(root, expanded)
  },

  collapseAll: () => {
    set({ expanded: {} })
    const root = get().root
    if (root) saveExpanded(root, {})
  },

  refreshAll: async () => {
    const { root, children } = get()
    if (!root) return
    await Promise.all(Object.keys(children).map((d) => get().loadDir(d)))
  },

  select: (path, reveal = false) => set({ selected: path, revealNonce: reveal ? get().revealNonce + 1 : get().revealNonce }),

  reveal: async (path) => {
    const root = get().root
    if (!root || !isInside(root, path) || path === root) return
    // Expand every ancestor between the root and the file.
    const chain: string[] = []
    let dir = dirname(path)
    while (dir && normalizeSlashes(dir) !== normalizeSlashes(root) && isInside(root, dir)) {
      chain.unshift(dir)
      const next = dirname(dir)
      if (next === dir) break
      dir = next
    }
    const expanded = { ...get().expanded }
    let changed = false
    for (const d of chain) {
      if (!expanded[d]) {
        expanded[d] = true
        changed = true
      }
    }
    if (changed) {
      set({ expanded })
      saveExpanded(root, expanded)
    }
    for (const d of chain) if (!get().children[d]) await get().loadDir(d)
    if (get().selected !== path || changed) get().select(path, true)
  },

  startEdit: (editing) => {
    set({ editing })
    if (editing && editing.kind !== 'rename' && editing.parent !== get().root && !get().expanded[editing.parent]) {
      void get().expand(editing.parent)
    }
  },

  setDropTarget: (dropTarget) => {
    if (get().dropTarget !== dropTarget) set({ dropTarget })
  }
}))

// ── Wiring ──────────────────────────────────────────────────────────────────

let currentRoot: string | null = null
function syncRoot(): void {
  const path = useWorkspaceStore.getState().workspace?.path ?? null
  if (path === currentRoot) return
  currentRoot = path
  useExplorerStore.getState().reset(path)
}
const offWorkspace = useWorkspaceStore.subscribe(syncRoot)
syncRoot()

/** Re-read every loaded folder that an fs event touched. */
const offFs = atom.fs.onChange((events: FsChangeEvent[]) => {
  const state = useExplorerStore.getState()
  if (!state.root) return
  const dirs = new Set<string>()
  const removed: string[] = []
  for (const e of events) {
    if (!isInside(state.root, e.path)) continue
    const parent = dirname(e.path)
    if (state.children[parent]) dirs.add(parent)
    if (e.kind === 'unlinkDir') removed.push(e.path)
  }
  if (removed.length) {
    const children = { ...state.children }
    const expanded = { ...state.expanded }
    for (const key of Object.keys(children)) if (removed.some((r) => isInside(r, key))) delete children[key]
    for (const key of Object.keys(expanded)) if (removed.some((r) => isInside(r, key))) delete expanded[key]
    useExplorerStore.setState({ children, expanded })
  }
  for (const d of dirs) void state.loadDir(d)
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    offWorkspace()
    offFs()
  })
}
