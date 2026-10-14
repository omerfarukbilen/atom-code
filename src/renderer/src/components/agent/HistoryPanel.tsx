import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Copy, FolderOpen, GitBranch, History, MessageSquare, MessageSquarePlus, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import type { SessionSummary } from '@shared/types'
import { cn } from '../../lib/cn'
import { useAgentStore } from '../../stores/agent'
import { useLayoutStore } from '../../stores/layout'
import { toast } from '../../stores/toast'
import { useWorkspaceStore } from '../../stores/workspace'
import { Button, EmptyState, IconButton, Input, Menu, Spinner, confirmDialog, useContextMenu, type MenuEntry } from '../ui'
import { ViewHeader } from '../workbench/ViewHeader'
import { useSessionHistory } from './header/session-history'
import { HISTORY_GROUPS, fullDate, historyGroup, relativeTime } from './header/time'

function openSession(session: SessionSummary): void {
  const layout = useLayoutStore.getState()
  if (!layout.agentVisible) layout.setAgentVisible(true)
  useAgentStore.getState().resumeSession(session.sessionId, session.title)
}

async function deleteSession(session: SessionSummary): Promise<void> {
  const ok = await confirmDialog({
    title: 'Delete this chat?',
    message: `“${session.title || 'Untitled chat'}” will be permanently deleted from disk. This can’t be undone.`,
    confirmLabel: 'Delete',
    danger: true,
    icon: <Trash2 size={16} className="text-danger" />
  })
  if (ok) await useSessionHistory.getState().remove(session.sessionId)
}

function startNewChat(): void {
  const agent = useAgentStore.getState()
  agent.newChat()
  agent.focusComposer()
}

/** Sidebar view listing the stored agent sessions of the workspace, grouped by recency. */
export function HistoryPanel() {
  const workspace = useWorkspaceStore((s) => s.workspace)
  const sessions = useSessionHistory((s) => s.sessions)
  const loading = useSessionHistory((s) => s.loading)
  const error = useSessionHistory((s) => s.error)
  const visible = useLayoutStore((s) => s.sidebarVisible && s.sidebarView === 'history')
  const [query, setQuery] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)

  /** Session ids open in tabs ("\n"-joined so the selector result is a stable string). */
  const openIds = useAgentStore((s) =>
    s.order
      .map((id) => s.chats[id]?.sessionId ?? s.chats[id]?.resumeSessionId ?? '')
      .filter(Boolean)
      .join('\n')
  )
  const activeSessionId = useAgentStore((s) => {
    const c = s.activeChatId ? s.chats[s.activeChatId] : null
    return c ? (c.sessionId ?? c.resumeSessionId ?? null) : null
  })
  const openSet = useMemo(() => new Set(openIds ? openIds.split('\n') : []), [openIds])

  useEffect(() => {
    if (visible) void useSessionHistory.getState().refresh()
  }, [visible, workspace?.path])

  // A chat that just got its session id (first message sent) should appear without a manual refresh.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (!visible) return
    const t = setTimeout(() => void useSessionHistory.getState().refresh({ force: true }), 900)
    return () => clearTimeout(t)
  }, [openIds, visible])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? sessions.filter((s) => `${s.title}\n${s.firstPrompt ?? ''}\n${s.gitBranch ?? ''}`.toLowerCase().includes(q))
      : sessions
    const now = Date.now()
    return HISTORY_GROUPS.map((g) => ({ group: g, items: filtered.filter((s) => historyGroup(s.lastModified, now) === g) })).filter((g) => g.items.length)
  }, [sessions, query])

  const refresh = (): void => void useSessionHistory.getState().refresh({ force: true })

  let content
  if (!workspace) {
    content = (
      <EmptyState
        icon={<History size={28} />}
        title="No folder open"
        description="Chats are stored per project. Open a folder to see its conversations with ATOM."
        action={
          <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => void useWorkspaceStore.getState().openFolderDialog()}>
            Open Folder…
          </Button>
        }
      />
    )
  } else if (!sessions.length && loading) {
    content = (
      <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted">
        <Spinner size={12} /> Loading chats…
      </div>
    )
  } else if (!sessions.length && error) {
    content = (
      <EmptyState
        icon={<History size={28} />}
        title="Could not load chat history"
        description={error}
        action={
          <Button size="sm" icon={<RefreshCw size={13} />} onClick={refresh}>
            Try again
          </Button>
        }
      />
    )
  } else if (!sessions.length) {
    content = (
      <EmptyState
        icon={<MessageSquare size={28} />}
        title="No chats yet"
        description="Your conversations with ATOM in this folder will appear here, ready to pick up where you left off."
        action={
          <Button size="sm" variant="primary" icon={<MessageSquarePlus size={13} />} onClick={startNewChat}>
            New chat
          </Button>
        }
      />
    )
  } else if (!groups.length) {
    content = <div className="px-4 py-6 text-center text-[12px] text-muted">No chats match “{query.trim()}”</div>
  } else {
    content = groups.map(({ group, items }) => (
      <div key={group} className="pb-2">
        <div className="sticky top-0 z-[1] bg-sidebar px-4 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-subtle">{group}</div>
        {items.map((s) => (
          <SessionRow
            key={s.sessionId}
            session={s}
            active={s.sessionId === activeSessionId}
            open={openSet.has(s.sessionId)}
            renaming={renamingId === s.sessionId}
            onStartRename={() => setRenamingId(s.sessionId)}
            onEndRename={() => setRenamingId(null)}
          />
        ))}
      </div>
    ))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader
        title="Agent History"
        actions={
          <>
            <IconButton title="New chat" icon={<Plus size={14} />} onClick={startNewChat} />
            <IconButton title="Refresh" icon={<RefreshCw size={13} className={cn(loading && 'animate-spin')} />} onClick={refresh} disabled={!workspace} />
          </>
        }
      />
      {workspace && sessions.length > 0 && (
        <div className="shrink-0 px-3 pb-2">
          <Input
            inputSize="sm"
            icon={<Search size={12} />}
            value={query}
            placeholder="Search chats"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation()
                setQuery('')
              }
            }}
            right={
              query ? (
                <button type="button" title="Clear search" onClick={() => setQuery('')} className="text-subtle hover:text-fg">
                  <X size={12} />
                </button>
              ) : undefined
            }
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">{content}</div>
    </div>
  )
}

interface SessionRowProps {
  session: SessionSummary
  active: boolean
  open: boolean
  renaming: boolean
  onStartRename(): void
  onEndRename(): void
}

const SessionRow = memo(function SessionRow({ session, active, open, renaming, onStartRename, onEndRename }: SessionRowProps) {
  const ctx = useContextMenu()
  const title = session.title || 'Untitled chat'

  const entries: MenuEntry[] = [
    { id: 'open', label: active ? 'Show chat' : 'Open chat', icon: <MessageSquare size={13} />, onSelect: () => openSession(session) },
    { id: 'rename', label: 'Rename…', icon: <Pencil size={13} />, onSelect: onStartRename },
    {
      id: 'copy-id',
      label: 'Copy session ID',
      icon: <Copy size={13} />,
      onSelect: () =>
        void navigator.clipboard.writeText(session.sessionId).then(
          () => toast.success('Session ID copied'),
          () => toast.error('Could not access the clipboard')
        )
    },
    { type: 'separator', id: 's' },
    { id: 'delete', label: 'Delete…', icon: <Trash2 size={13} />, danger: true, onSelect: () => void deleteSession(session) }
  ]

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openSession(session)
    } else if (e.key === 'F2') {
      e.preventDefault()
      onStartRename()
    } else if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) {
      e.preventDefault()
      void deleteSession(session)
    }
  }

  const tooltip = [title, session.firstPrompt && session.firstPrompt !== title ? session.firstPrompt.slice(0, 300) : '', fullDate(session.lastModified)]
    .filter(Boolean)
    .join('\n')

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        title={renaming ? undefined : tooltip}
        onClick={() => !renaming && openSession(session)}
        onContextMenu={ctx.onContextMenu}
        onKeyDown={onKeyDown}
        className={cn(
          'group/row mx-1.5 flex items-start gap-2 rounded-md px-2 py-1.5 outline-none transition-colors duration-100 focus-visible:ring-1 focus-visible:ring-accent',
          active ? 'bg-active' : 'hover:bg-hover'
        )}
      >
        <span className="relative mt-0.5 flex shrink-0">
          <MessageSquare size={13} className={active ? 'text-accent' : 'text-subtle'} />
          {open && !active && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent" title="Open in a tab" />}
        </span>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <RenameField session={session} onDone={onEndRename} />
          ) : (
            <div className={cn('truncate text-[12.5px]', active ? 'text-fg' : 'text-fg/90')}>{title}</div>
          )}
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-subtle">
            <span className="shrink-0">{relativeTime(session.lastModified)}</span>
            {session.gitBranch && (
              <span className="flex min-w-0 items-center gap-0.5">
                <GitBranch size={10} className="shrink-0" />
                <span className="truncate">{session.gitBranch}</span>
              </span>
            )}
          </div>
        </div>
        {!renaming && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
            <IconButton
              size="xs"
              title="Rename"
              icon={<Pencil size={11} />}
              onClick={(e) => {
                e.stopPropagation()
                onStartRename()
              }}
            />
            <IconButton
              size="xs"
              title="Delete"
              icon={<Trash2 size={11} />}
              className="hover:text-danger"
              onClick={(e) => {
                e.stopPropagation()
                void deleteSession(session)
              }}
            />
          </div>
        )}
      </div>
      <Menu {...ctx.props} entries={entries} minWidth={190} />
    </>
  )
})

function RenameField({ session, onDone }: { session: SessionSummary; onDone(): void }) {
  const [value, setValue] = useState(session.title)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const finish = (commit: boolean): void => {
    if (done.current) return
    done.current = true
    const clean = value.replace(/\s+/g, ' ').trim()
    if (commit && clean && clean !== session.title) void useSessionHistory.getState().rename(session.sessionId, clean)
    onDone()
  }

  return (
    <input
      ref={ref}
      value={value}
      spellCheck={false}
      aria-label="Chat name"
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
      className="h-5 w-full rounded border border-accent bg-input px-1 text-[12.5px] text-fg outline-none"
    />
  )
}
