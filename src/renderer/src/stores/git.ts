import { create } from 'zustand'
import type { GitBranchInfo, GitFileChange, GitStatus } from '@shared/types'
import { isInside, normalizeSlashes } from '@shared/paths'
import { atom } from '../lib/api'
import { useAuthStore } from './auth'
import { errorMessage, toast } from './toast'
import { useWorkspaceStore } from './workspace'

export type GitBusyOp = 'commit' | 'push' | 'pull' | 'generate' | 'checkout' | 'init' | 'stage' | 'discard'

export interface CommitOptions {
  amend?: boolean
  /** Stage every change (including untracked files) before committing. */
  all?: boolean
  /** Push after a successful commit. */
  push?: boolean
}

interface GitState {
  status: GitStatus | null
  loading: boolean
  branches: GitBranchInfo[]
  busy: GitBusyOp | null
  commitMessage: string
  lastError: string | null

  setCommitMessage(message: string): void
  refresh(): Promise<void>
  /** Debounced refresh (fs events, window focus). */
  scheduleRefresh(delayMs?: number): void
  loadBranches(): Promise<void>
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  discard(paths: string[]): Promise<void>
  stageAll(): Promise<void>
  unstageAll(): Promise<void>
  commit(options?: CommitOptions): Promise<boolean>
  push(): Promise<void>
  pull(): Promise<void>
  checkout(branch: string): Promise<void>
  createBranch(name: string): Promise<void>
  init(): Promise<void>
  generateMessage(): Promise<void>
}

const root = (): string | null => useWorkspaceStore.getState().workspace?.path ?? null

let refreshTimer: ReturnType<typeof setTimeout> | null = null
let refreshSeq = 0

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? ''
}

export const useGitStore = create<GitState>((set, get) => {
  /** Runs a git operation with busy state + error toast, then refreshes. */
  const run = async <T>(op: GitBusyOp | null, label: string, fn: (root: string) => Promise<T>): Promise<T | undefined> => {
    const r = root()
    if (!r) return undefined
    if (op) set({ busy: op })
    try {
      return await fn(r)
    } catch (err) {
      const msg = errorMessage(err)
      set({ lastError: msg })
      toast.error(label, msg)
      return undefined
    } finally {
      if (op) set({ busy: null })
      void get().refresh()
    }
  }

  return {
    status: null,
    loading: false,
    branches: [],
    busy: null,
    commitMessage: '',
    lastError: null,

    setCommitMessage: (commitMessage) => set({ commitMessage }),

    refresh: async () => {
      const r = root()
      const seq = ++refreshSeq
      if (!r) {
        set({ status: null, loading: false, branches: [] })
        return
      }
      set({ loading: true })
      try {
        const status = await atom.git.status(r)
        if (seq !== refreshSeq) return
        set({ status, loading: false, lastError: null })
      } catch (err) {
        if (seq !== refreshSeq) return
        set({ loading: false, lastError: errorMessage(err) })
      }
    },

    scheduleRefresh: (delayMs = 600) => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void get().refresh()
      }, delayMs)
    },

    loadBranches: async () => {
      const r = root()
      if (!r || !get().status?.isRepo) return
      try {
        set({ branches: await atom.git.branches(r) })
      } catch (err) {
        toast.error('Could not list branches', errorMessage(err))
      }
    },

    stage: async (paths) => {
      if (paths.length) await run(null, 'Stage failed', (r) => atom.git.stage(r, paths))
    },
    unstage: async (paths) => {
      if (paths.length) await run(null, 'Unstage failed', (r) => atom.git.unstage(r, paths))
    },
    discard: async (paths) => {
      if (paths.length) await run('discard', 'Discard failed', (r) => atom.git.discard(r, paths))
    },
    stageAll: async () => {
      const files = get().status?.files.filter((f) => f.workingTree !== ' ' || f.untracked) ?? []
      await get().stage(files.map((f) => f.path))
    },
    unstageAll: async () => {
      const files = get().status?.files.filter((f) => f.staged) ?? []
      await get().unstage(files.map((f) => f.path))
    },

    commit: async (options = {}) => {
      const message = get().commitMessage.trim()
      if (!message && !options.amend) {
        toast.warning('Write a commit message first', 'Or press ✨ to let ATOM write one from your changes.')
        return false
      }
      const status = get().status
      const hasStaged = !!status?.files.some((f) => f.staged)
      const stageEverything = options.all || (!hasStaged && !options.amend)
      if (!options.amend && status && status.files.length === 0) {
        toast.info('Nothing to commit', 'The working tree is clean.')
        return false
      }
      let finalMessage = message
      const hash = await run('commit', 'Commit failed', async (r) => {
        if (stageEverything) {
          const paths = (status?.files ?? []).filter((f) => !f.staged || f.workingTree !== ' ').map((f) => f.path)
          if (paths.length) await atom.git.stage(r, paths)
        }
        // Amending without a new message keeps the previous one.
        if (!finalMessage && options.amend) finalMessage = (await atom.git.log(r, 1))[0]?.message ?? ''
        if (!finalMessage) throw new Error('Commit message is empty.')
        return atom.git.commit(r, finalMessage, { amend: options.amend })
      })
      if (hash === undefined) return false
      set({ commitMessage: '' })
      toast.success(options.amend ? 'Amended last commit' : 'Committed', `${hash.slice(0, 7)} · ${firstLine(finalMessage)}`)
      if (options.push) await get().push()
      return true
    },

    push: async () => {
      const out = await run('push', 'Push failed', (r) => atom.git.push(r))
      if (out !== undefined) toast.success('Pushed', firstLine(out) || undefined)
    },
    pull: async () => {
      const out = await run('pull', 'Pull failed', (r) => atom.git.pull(r))
      if (out !== undefined) toast.success('Pulled', firstLine(out) || undefined)
    },
    checkout: async (branch) => {
      const ok = await run('checkout', `Could not switch to ${branch}`, async (r) => {
        await atom.git.checkout(r, branch)
        return true
      })
      if (ok) toast.success(`Switched to ${branch}`)
    },
    createBranch: async (name) => {
      const ok = await run('checkout', 'Could not create branch', async (r) => {
        await atom.git.createBranch(r, name)
        return true
      })
      if (ok) toast.success(`Created and switched to ${name}`)
    },
    init: async () => {
      const ok = await run('init', 'Could not initialize repository', async (r) => {
        await atom.git.init(r)
        return true
      })
      if (ok) toast.success('Initialized an empty Git repository')
    },

    generateMessage: async () => {
      const r = root()
      if (!r || get().busy === 'generate') return
      set({ busy: 'generate' })
      try {
        const message = (await atom.ai.commitMessage(r)).trim()
        if (message) set({ commitMessage: message })
        else toast.info('No changes to describe')
      } catch (err) {
        const msg = errorMessage(err)
        const authProblem = /log ?in|auth|401|api key|credential/i.test(msg)
        toast.show({
          kind: 'error',
          message: 'Could not generate a commit message',
          detail: msg,
          action: authProblem
            ? {
                label: 'Sign in',
                run: () => useAuthStore.getState().openLogin()
              }
            : undefined
        })
      } finally {
        set({ busy: null })
      }
    }
  }
})

// ── Derived helpers ─────────────────────────────────────────────────────────

export type GitDecoration = { letter: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'muted'; label: string }

/** Single-letter decoration for a change (explorer, SCM list). */
export function decorationFor(change: GitFileChange): GitDecoration {
  if (change.conflicted) return { letter: '!', tone: 'danger', label: 'Conflict' }
  if (change.untracked) return { letter: 'U', tone: 'success', label: 'Untracked' }
  const code = change.workingTree !== ' ' ? change.workingTree : change.index
  switch (code) {
    case 'A':
      return { letter: 'A', tone: 'success', label: 'Added' }
    case 'D':
      return { letter: 'D', tone: 'danger', label: 'Deleted' }
    case 'R':
      return { letter: 'R', tone: 'info', label: 'Renamed' }
    case 'C':
      return { letter: 'C', tone: 'info', label: 'Copied' }
    case 'U':
      return { letter: '!', tone: 'danger', label: 'Conflict' }
    default:
      return { letter: 'M', tone: 'warning', label: 'Modified' }
  }
}

/** Decoration of the staged (index) side only. */
export function stagedDecorationFor(change: GitFileChange): GitDecoration {
  switch (change.index) {
    case 'A':
      return { letter: 'A', tone: 'success', label: 'Added' }
    case 'D':
      return { letter: 'D', tone: 'danger', label: 'Deleted' }
    case 'R':
      return { letter: 'R', tone: 'info', label: 'Renamed' }
    default:
      return { letter: 'M', tone: 'warning', label: 'Modified' }
  }
}

export const TONE_TEXT: Record<GitDecoration['tone'], string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  muted: 'text-muted'
}

const TONE_RANK: Record<GitDecoration['tone'], number> = { danger: 4, warning: 3, success: 2, info: 1, muted: 0 }

export interface GitDecorationMap {
  files: Map<string, GitDecoration>
  /** Folder → strongest decoration among its descendants. */
  folders: Map<string, GitDecoration>
}

/** Builds lookup maps keyed by normalized absolute path. */
export function buildDecorationMap(status: GitStatus | null, workspaceRoot: string | null): GitDecorationMap {
  const files = new Map<string, GitDecoration>()
  const folders = new Map<string, GitDecoration>()
  if (!status?.isRepo || !workspaceRoot) return { files, folders }
  const rootNorm = normalizeSlashes(workspaceRoot).replace(/\/+$/, '')
  for (const change of status.files) {
    const p = normalizeSlashes(change.path)
    const deco = decorationFor(change)
    files.set(p, deco)
    if (!isInside(rootNorm, p)) continue
    let dir = p.slice(0, p.lastIndexOf('/'))
    while (dir.length >= rootNorm.length && dir !== rootNorm) {
      const prev = folders.get(dir)
      if (prev && TONE_RANK[prev.tone] >= TONE_RANK[deco.tone]) break
      folders.set(dir, deco)
      const i = dir.lastIndexOf('/')
      if (i <= 0) break
      dir = dir.slice(0, i)
    }
  }
  return { files, folders }
}

// ── Automatic refresh ───────────────────────────────────────────────────────

let lastWorkspacePath: string | null = null
function syncWorkspace(): void {
  const path = useWorkspaceStore.getState().workspace?.path ?? null
  if (path === lastWorkspacePath) return
  lastWorkspacePath = path
  useGitStore.setState({ status: null, branches: [], commitMessage: '', busy: null })
  void useGitStore.getState().refresh()
}
const offWorkspace = useWorkspaceStore.subscribe(syncWorkspace)
syncWorkspace()

const offFs = atom.fs.onChange((events) => {
  const r = root()
  if (!r) return
  // .git/index, HEAD and refs changes matter (commits/checkout from a terminal); object writes do not.
  const relevant = events.some((e) => {
    const p = normalizeSlashes(e.path)
    return !p.includes('/.git/objects/') && !p.endsWith('.lock')
  })
  if (relevant) useGitStore.getState().scheduleRefresh(700)
})

const onFocus = (): void => {
  if (root()) useGitStore.getState().scheduleRefresh(150)
}
window.addEventListener('focus', onFocus)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    offWorkspace()
    offFs()
    window.removeEventListener('focus', onFocus)
  })
}
