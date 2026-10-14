/**
 * Stored agent sessions for the current workspace (SDK session transcripts on disk), shared by the
 * header's history dropdown, the empty chat's "Recent" list and the History sidebar view.
 */
import { create } from 'zustand'
import type { SessionSummary } from '@shared/types'
import { atom } from '../../../lib/api'
import { useAgentStore } from '../../../stores/agent'
import { errorMessage, toast } from '../../../stores/toast'
import { useWorkspaceStore } from '../../../stores/workspace'

interface SessionHistoryState {
  /** Workspace the list belongs to (null = no folder open). */
  workspace: string | null
  sessions: SessionSummary[]
  loading: boolean
  error: string | null
  loadedAt: number
  /** Reload the list (cached for a few seconds unless `force`). */
  refresh(opts?: { force?: boolean }): Promise<void>
  rename(sessionId: string, title: string): Promise<void>
  remove(sessionId: string): Promise<void>
}

const CACHE_MS = 4000
let seq = 0

function currentWorkspace(): string | null {
  return useWorkspaceStore.getState().workspace?.path ?? null
}

/** Chat tab currently showing a session, if any. */
export function chatIdForSession(sessionId: string): string | null {
  const s = useAgentStore.getState()
  return s.order.find((id) => s.chats[id]?.sessionId === sessionId || s.chats[id]?.resumeSessionId === sessionId) ?? null
}

export const useSessionHistory = create<SessionHistoryState>((set, get) => ({
  workspace: null,
  sessions: [],
  loading: false,
  error: null,
  loadedAt: 0,

  refresh: async (opts) => {
    const ws = currentWorkspace()
    if (!ws) {
      seq++
      set({ workspace: null, sessions: [], loading: false, error: null, loadedAt: Date.now() })
      return
    }
    const s = get()
    if (!opts?.force && s.workspace === ws && !s.error && Date.now() - s.loadedAt < CACHE_MS) return
    const id = ++seq
    set(s.workspace === ws ? { loading: true } : { loading: true, workspace: ws, sessions: [], error: null })
    try {
      const sessions = await atom.agent.listSessions(ws)
      if (id !== seq) return
      set({
        sessions: [...sessions].sort((a, b) => b.lastModified - a.lastModified),
        workspace: ws,
        loading: false,
        error: null,
        loadedAt: Date.now()
      })
    } catch (err) {
      if (id !== seq) return
      set({ loading: false, error: errorMessage(err), loadedAt: Date.now() })
    }
  },

  rename: async (sessionId, title) => {
    const ws = get().workspace ?? currentWorkspace()
    const clean = title.replace(/\s+/g, ' ').trim()
    if (!ws || !clean) return
    const before = get().sessions
    set({ sessions: before.map((x) => (x.sessionId === sessionId ? { ...x, title: clean } : x)) })
    const open = chatIdForSession(sessionId)
    if (open) {
      // renameChat also persists the title to the session file.
      useAgentStore.getState().renameChat(open, clean)
      return
    }
    try {
      await atom.agent.renameSession(sessionId, clean, ws)
    } catch (err) {
      set({ sessions: before })
      toast.error('Could not rename the chat', errorMessage(err))
    }
  },

  remove: async (sessionId) => {
    const ws = get().workspace ?? currentWorkspace()
    if (!ws) return
    const open = chatIdForSession(sessionId)
    if (open) useAgentStore.getState().closeChat(open)
    const before = get().sessions
    set({ sessions: before.filter((x) => x.sessionId !== sessionId) })
    try {
      await atom.agent.deleteSession(sessionId, ws)
    } catch (err) {
      set({ sessions: before })
      toast.error('Could not delete the chat', errorMessage(err))
    }
  }
}))

// Drop the list when the workspace changes so no stale sessions from another project are shown.
useWorkspaceStore.subscribe((state, prev) => {
  if ((state.workspace?.path ?? null) !== (prev.workspace?.path ?? null)) {
    seq++
    useSessionHistory.setState({ workspace: state.workspace?.path ?? null, sessions: [], loading: false, error: null, loadedAt: 0 })
  }
})
