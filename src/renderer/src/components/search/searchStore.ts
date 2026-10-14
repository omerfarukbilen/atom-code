import { create } from 'zustand'
import type { SearchResult } from '@shared/types'
import { atom } from '../../lib/api'
import { errorMessage } from '../../stores/toast'
import { useWorkspaceStore } from '../../stores/workspace'

/** Workspace text search (ripgrep in main). State lives here so it survives switching sidebar views. */
interface SearchState {
  query: string
  isRegex: boolean
  caseSensitive: boolean
  wholeWord: boolean
  include: string
  exclude: string
  showDetails: boolean
  result: SearchResult | null
  searching: boolean
  error: string | null
  /** Files (absolute path) whose match list is collapsed. */
  collapsed: Record<string, boolean>
  /** Incremented to ask the view to focus + select the query input. */
  focusNonce: number

  set(patch: Partial<Pick<SearchState, 'query' | 'isRegex' | 'caseSensitive' | 'wholeWord' | 'include' | 'exclude' | 'showDetails'>>): void
  run(): Promise<void>
  /** Debounced run (300 ms). */
  schedule(): void
  clear(): void
  toggleCollapsed(path: string): void
  setAllCollapsed(collapsed: boolean): void
  requestFocus(seed?: string): void
}

let timer: ReturnType<typeof setTimeout> | null = null
let seq = 0

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  isRegex: false,
  caseSensitive: false,
  wholeWord: false,
  include: '',
  exclude: '',
  showDetails: false,
  result: null,
  searching: false,
  error: null,
  collapsed: {},
  focusNonce: 0,

  set: (patch) => {
    set(patch)
    const searchAffecting = Object.keys(patch).some((k) => k !== 'showDetails')
    if (searchAffecting) get().schedule()
  },

  run: async () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const { query, isRegex, caseSensitive, wholeWord, include, exclude } = get()
    const root = useWorkspaceStore.getState().workspace?.path
    const id = ++seq
    if (!query || !root) {
      set({ result: null, searching: false, error: null })
      return
    }
    if (isRegex) {
      try {
        new RegExp(query)
      } catch (err) {
        set({ error: `Invalid regular expression: ${errorMessage(err)}`, searching: false })
        return
      }
    }
    set({ searching: true, error: null })
    try {
      const result = await atom.search.find(root, {
        query,
        isRegex,
        caseSensitive,
        wholeWord,
        include: include.trim() || undefined,
        exclude: exclude.trim() || undefined,
        maxResults: 2000
      })
      if (id !== seq) return
      set({ result, searching: false, collapsed: {} })
    } catch (err) {
      if (id !== seq) return // superseded (main cancels the previous search)
      set({ searching: false, error: errorMessage(err) })
    }
  },

  schedule: () => {
    if (timer) clearTimeout(timer)
    if (!get().query) {
      seq++
      void atom.search.cancel().catch(() => undefined)
      set({ result: null, searching: false, error: null })
      return
    }
    set({ searching: true })
    timer = setTimeout(() => void get().run(), 300)
  },

  clear: () => {
    if (timer) clearTimeout(timer)
    seq++
    void atom.search.cancel().catch(() => undefined)
    set({ query: '', result: null, searching: false, error: null, collapsed: {} })
  },

  toggleCollapsed: (path) => set({ collapsed: { ...get().collapsed, [path]: !get().collapsed[path] } }),

  setAllCollapsed: (collapsed) => {
    const files = get().result?.files ?? []
    set({ collapsed: collapsed ? Object.fromEntries(files.map((f) => [f.path, true])) : {} })
  },

  requestFocus: (seed) => {
    if (seed && seed !== get().query) get().set({ query: seed })
    set({ focusNonce: get().focusNonce + 1 })
  }
}))

// New workspace → stale results.
let lastRoot: string | null = null
const offWorkspace = useWorkspaceStore.subscribe((s) => {
  const root = s.workspace?.path ?? null
  if (root === lastRoot) return
  lastRoot = root
  seq++
  useSearchStore.setState({ result: null, searching: false, error: null, collapsed: {} })
  if (root && useSearchStore.getState().query) useSearchStore.getState().schedule()
})

if (import.meta.hot) import.meta.hot.dispose(() => offWorkspace())
