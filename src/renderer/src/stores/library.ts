import { create } from 'zustand'
import type { CommandInfo, LibraryIndex, LibraryKind, LibraryScope, SkillInfo, SubagentInfo } from '@shared/types'
import { basename, dirname, joinPath, normalizeSlashes } from '@shared/paths'
import { atom } from '../lib/api'
import { useSettingsStore } from './settings'
import { useWorkspaceStore } from './workspace'
import { errorMessage } from './toast'

/**
 * Cached index of skills, subagents and slash commands from the three library scopes
 * (ATOM built-in plugin, ~/.claude, <workspace>/.claude).
 */

export type LibraryItemInfo = SkillInfo | SubagentInfo | CommandInfo
export type WritableScope = Exclude<LibraryScope, 'atom'>

export interface LibraryState {
  index: LibraryIndex | null
  loading: boolean
  error: string | null
  /** Workspace the current index was built for. */
  workspace: string | null
  refresh(): Promise<void>
  /** Enable / disable a skill for the agent (persists `settings.agent.disabledSkills`). */
  toggleSkill(qualifiedName: string, enabled: boolean): Promise<void>
  /** Writes a new library file and returns its absolute path. */
  createItem(kind: LibraryKind, scope: WritableScope, name: string, content: string): Promise<string>
  deleteItem(path: string): Promise<void>
  /** Copies a (typically bundled) item into the user scope and returns the new file path. */
  duplicateToUser(item: LibraryItemInfo): Promise<string>
}

export function libraryKindOf(item: LibraryItemInfo): LibraryKind {
  if ('dir' in item) return 'skill'
  if ('argumentHint' in item || normalizeSlashes(item.path).includes('/commands/')) return 'command'
  return 'agent'
}

function currentWorkspace(): string | null {
  return useWorkspaceStore.getState().workspace?.path ?? null
}

/** Rewrites the `name:` line of a YAML frontmatter block (no-op when there is none). */
function renameInFrontmatter(content: string, name: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!m) return content
  const fm = m[1]
  const next = /^name:.*$/m.test(fm) ? fm.replace(/^name:.*$/m, `name: ${name}`) : `name: ${name}\n${fm}`
  return content.replace(fm, next)
}

let refreshSeq = 0

export const useLibraryStore = create<LibraryState>((set, get) => ({
  index: null,
  loading: false,
  error: null,
  workspace: null,

  refresh: async () => {
    const seq = ++refreshSeq
    const workspace = currentWorkspace()
    set({ loading: true })
    try {
      const index = await atom.library.list(workspace)
      if (seq !== refreshSeq) return
      set({ index, loading: false, error: null, workspace })
    } catch (err) {
      if (seq !== refreshSeq) return
      set({ loading: false, error: errorMessage(err) })
    }
  },

  toggleSkill: async (qualifiedName, enabled) => {
    const disabled = useSettingsStore.getState().settings.agent.disabledSkills
    const next = enabled ? disabled.filter((n) => n !== qualifiedName) : Array.from(new Set([...disabled, qualifiedName]))
    // Optimistic update of the cached index so the toggle feels instant.
    const index = get().index
    if (index) {
      set({ index: { ...index, skills: index.skills.map((s) => (s.qualifiedName === qualifiedName ? { ...s, enabled } : s)) } })
    }
    await useSettingsStore.getState().update({ agent: { disabledSkills: next } })
  },

  createItem: async (kind, scope, name, content) => {
    const workspace = currentWorkspace()
    if (scope === 'project' && !workspace) throw new Error('Open a folder to create project-scoped items.')
    const path = await atom.library.save({ kind, scope, name, content, workspace: workspace ?? undefined })
    await get().refresh()
    return path
  },

  deleteItem: async (path) => {
    await atom.library.delete(path)
    await get().refresh()
  },

  duplicateToUser: async (item) => {
    const kind = libraryKindOf(item)
    const index = get().index
    const taken = new Set(
      [...(index?.skills ?? []), ...(index?.agents ?? []), ...(index?.commands ?? [])]
        .filter((i) => i.scope === 'user' && libraryKindOf(i) === kind)
        .map((i) => i.name)
    )
    // Command names may contain ":" for nested folders; library names must be kebab-case.
    const base =
      item.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 56) || kind
    let name = base
    for (let n = 2; taken.has(name); n++) name = n === 2 ? `${base}-copy` : `${base}-copy-${n - 1}`

    const original = await atom.library.read(item.path)
    const content = name === item.name ? original : kind === 'command' ? original : renameInFrontmatter(original, name)
    const path = await atom.library.save({ kind, scope: 'user', name, content })

    // Skills can bundle extra files (scripts, references) next to SKILL.md — copy them too.
    if (kind === 'skill' && 'files' in item && item.files.length > 0) {
      const newDir = dirname(path)
      for (const rel of item.files) {
        if (basename(rel).toUpperCase() === 'SKILL.MD') continue
        try {
          await atom.fs.copy(joinPath(item.dir, rel), joinPath(newDir, rel))
        } catch {
          /* best effort: the SKILL.md itself was copied */
        }
      }
    }
    await get().refresh()
    return path
  }
}))

// ── Auto refresh ────────────────────────────────────────────────────────────

/** Only keep the index fresh once something actually asked for it. */
function isActive(): boolean {
  const s = useLibraryStore.getState()
  return s.index !== null || s.loading
}

useWorkspaceStore.subscribe((state, prev) => {
  if (state.workspace?.path === prev.workspace?.path) return
  if (isActive()) void useLibraryStore.getState().refresh()
})

let lastFocus = 0
window.addEventListener('focus', () => {
  const now = Date.now()
  if (now - lastFocus < 5000 || !isActive()) return
  lastFocus = now
  void useLibraryStore.getState().refresh()
})

// Project-scope files live in <workspace>/.claude — refresh when they change on disk.
let fsTimer: ReturnType<typeof setTimeout> | null = null
atom.fs.onChange((events) => {
  if (!isActive()) return
  const relevant = events.some((e) => {
    const p = normalizeSlashes(e.path)
    return p.includes('/.claude/skills') || p.includes('/.claude/agents') || p.includes('/.claude/commands')
  })
  if (!relevant) return
  if (fsTimer) clearTimeout(fsTimer)
  fsTimer = setTimeout(() => {
    fsTimer = null
    void useLibraryStore.getState().refresh()
  }, 400)
})
