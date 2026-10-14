import { useMemo } from 'react'
import { Copy, History, Maximize2, MessageSquare, MessageSquarePlus, Minimize2, MoreHorizontal, PanelRightClose, Pencil, Plus, Settings2, SquareX } from 'lucide-react'
import { copyChatTranscript } from '../../../lib/agent-commands'
import { formatKeybinding } from '../../../lib/platform'
import { useAgentStore } from '../../../stores/agent'
import { useLayoutStore } from '../../../stores/layout'
import { useWorkspaceStore } from '../../../stores/workspace'
import { IconButton, Menu, type MenuEntry } from '../../ui'
import { useAnchoredMenu } from '../composer/useAnchoredMenu'
import { ChatTabs, closeChatTab, useTabRename } from './ChatTabs'
import { useSessionHistory } from './session-history'
import { relativeTime } from './time'

/** Show the History sidebar view (and leave the maximized agent layout so it is visible). */
export function showHistoryView(): void {
  const layout = useLayoutStore.getState()
  if (layout.agentMaximized) layout.setAgentMaximized(false)
  useLayoutStore.setState({ sidebarVisible: true, sidebarView: 'history' })
}

function startNewChat(): void {
  const agent = useAgentStore.getState()
  agent.newChat()
  agent.focusComposer()
}

/** Agent panel header: chat tabs + new chat, history, maximize and overflow menu. */
export function AgentHeader({ chatId }: { chatId: string | null }) {
  const maximized = useLayoutStore((s) => s.agentMaximized)
  const setMaximized = useLayoutStore((s) => s.setAgentMaximized)

  return (
    <div className="@container flex h-[38px] shrink-0 items-center gap-1 border-b border-line pl-1.5 pr-1">
      <ChatTabs />
      <div className="flex shrink-0 items-center gap-0.5 pl-0.5">
        <IconButton title={`New chat (${formatKeybinding('mod+shift+l')})`} icon={<Plus size={15} />} onClick={startNewChat} />
        <HistoryButton />
        <span className="hidden @sm:flex">
          <IconButton
            title={maximized ? 'Restore layout' : 'Maximize agent'}
            icon={maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            onClick={() => setMaximized(!maximized)}
          />
        </span>
        <MoreMenu chatId={chatId} />
      </div>
    </div>
  )
}

function HistoryButton() {
  const menu = useAnchoredMenu('bottom-end')
  const sessions = useSessionHistory((s) => s.sessions)
  const loading = useSessionHistory((s) => s.loading)
  const error = useSessionHistory((s) => s.error)
  const hasWorkspace = useWorkspaceStore((s) => !!s.workspace)
  const activeSession = useAgentStore((s) => {
    const c = s.activeChatId ? s.chats[s.activeChatId] : null
    return c ? (c.sessionId ?? c.resumeSessionId ?? null) : null
  })

  const onClick = (): void => {
    if (!menu.open) void useSessionHistory.getState().refresh()
    menu.toggle()
  }

  const entries = useMemo<MenuEntry[]>(() => {
    if (!hasWorkspace) return [{ id: 'none', label: 'Open a folder to see its chats', disabled: true }]
    const now = Date.now()
    const out: MenuEntry[] = [{ type: 'header', id: 'h', label: 'Recent chats' }]
    const recent = sessions.slice(0, 15)
    if (!recent.length) {
      out.push({
        id: 'empty',
        label: loading ? 'Loading…' : error ? 'Could not load chat history' : 'No previous chats in this folder',
        description: error ?? undefined,
        disabled: true
      })
    }
    for (const s of recent) {
      out.push({
        id: s.sessionId,
        label: s.title || 'Untitled chat',
        description: [relativeTime(s.lastModified, now), s.gitBranch].filter(Boolean).join(' · '),
        icon: <MessageSquare size={13} />,
        checked: s.sessionId === activeSession,
        onSelect: () => useAgentStore.getState().resumeSession(s.sessionId, s.title)
      })
    }
    out.push({ type: 'separator', id: 'sep' }, { id: 'all', label: 'Show all chat history', icon: <History size={13} />, onSelect: showHistoryView })
    return out
  }, [hasWorkspace, sessions, loading, error, activeSession])

  return (
    <>
      <IconButton ref={menu.anchorRef} title="Chat history" icon={<History size={14} />} active={menu.open} onClick={onClick} />
      <Menu {...menu.props} entries={entries} minWidth={280} className="max-w-[360px]" />
    </>
  )
}

function MoreMenu({ chatId }: { chatId: string | null }) {
  const menu = useAnchoredMenu('bottom-end')
  const hasItems = useAgentStore((s) => (chatId ? (s.chats[chatId]?.items.length ?? 0) > 0 : false))
  const maximized = useLayoutStore((s) => s.agentMaximized)

  const entries: MenuEntry[] = [
    {
      id: 'rename',
      label: 'Rename chat',
      icon: <Pencil size={13} />,
      disabled: !chatId,
      onSelect: () => chatId && useTabRename.getState().start(chatId)
    },
    {
      id: 'export',
      label: 'Copy transcript as Markdown',
      icon: <Copy size={13} />,
      disabled: !hasItems,
      onSelect: () => void copyChatTranscript(chatId ?? undefined)
    },
    { id: 'new', label: 'New chat', icon: <MessageSquarePlus size={13} />, shortcut: 'mod+shift+l', onSelect: startNewChat },
    { type: 'separator', id: 's1' },
    {
      id: 'maximize',
      label: maximized ? 'Restore layout' : 'Maximize agent',
      icon: maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />,
      onSelect: () => useLayoutStore.getState().setAgentMaximized(!maximized)
    },
    { id: 'history', label: 'Chat history', icon: <History size={13} />, onSelect: showHistoryView },
    { id: 'settings', label: 'Agent settings…', icon: <Settings2 size={13} />, onSelect: () => useLayoutStore.getState().openSettings('agent') },
    { type: 'separator', id: 's2' },
    { id: 'close-chat', label: 'Close chat', icon: <SquareX size={13} />, disabled: !chatId, onSelect: () => chatId && void closeChatTab(chatId) },
    {
      id: 'close-panel',
      label: 'Close panel',
      icon: <PanelRightClose size={13} />,
      shortcut: 'mod+alt+b',
      onSelect: () => {
        const layout = useLayoutStore.getState()
        if (layout.agentMaximized) layout.setAgentMaximized(false)
        layout.setAgentVisible(false)
      }
    }
  ]

  return (
    <>
      <IconButton ref={menu.anchorRef} title="More actions" icon={<MoreHorizontal size={15} />} active={menu.open} onClick={menu.toggle} />
      <Menu {...menu.props} entries={entries} minWidth={230} />
    </>
  )
}
