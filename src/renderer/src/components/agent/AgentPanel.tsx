import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Hourglass, ImagePlus, KeyRound, TriangleAlert, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { ChatError } from '../../lib/agent-types'
import { atom } from '../../lib/api'
import { useAgentStore } from '../../stores/agent'
import { useAuthStore } from '../../stores/auth'
import { useLayoutStore } from '../../stores/layout'
import { AtomLogo, Button } from '../ui'
import { AuthGate } from '../auth/AuthGate'
import { Composer } from './composer'
import { handleDropData, isAcceptableDrag } from './composer/attachments'
import { EmptyChat } from './EmptyChat'
import { AgentHeader } from './header/AgentHeader'
import { resetTime } from './header/time'
import { MessageList, TodoStrip } from './transcript'
import { RenderBoundary } from './transcript/RenderBoundary'

/** The right-hand agent panel: chat tabs, transcript (or welcome / sign-in), todo strip and composer. */
export function AgentPanel() {
  const chatId = useAgentStore((s) => s.activeChatId)
  const hasItems = useAgentStore((s) => (s.activeChatId ? (s.chats[s.activeChatId]?.items.length ?? 0) > 0 : false))
  const historyLoading = useAgentStore((s) => (s.activeChatId ? !!s.chats[s.activeChatId]?.historyLoading : false))
  const maximized = useLayoutStore((s) => s.agentMaximized)
  const authStatus = useAuthStore((s) => s.status)
  const loggedOut = !!authStatus && !authStatus.loggedIn
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  useEffect(() => {
    if (chatId) void useAgentStore.getState().loadHistoryIfNeeded(chatId)
  }, [chatId])

  const onDragEnter = (e: DragEvent<HTMLElement>): void => {
    if (!chatId || loggedOut || !isAcceptableDrag(e.dataTransfer)) return
    dragDepth.current++
    setDragging(true)
  }
  const onDragOver = (e: DragEvent<HTMLElement>): void => {
    if (!chatId || loggedOut || !isAcceptableDrag(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (): void => {
    if (!dragging) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const onDrop = (e: DragEvent<HTMLElement>): void => {
    dragDepth.current = 0
    setDragging(false)
    if (!chatId || loggedOut || !isAcceptableDrag(e.dataTransfer)) return
    e.preventDefault()
    void handleDropData(e.dataTransfer, chatId)
  }

  let body: ReactNode
  if (loggedOut) body = <AuthGate />
  else if (!chatId) body = null
  else if (!hasItems && historyLoading) body = <HistoryLoading />
  else if (!hasItems) body = <EmptyChat chatId={chatId} />
  else body = <MessageList chatId={chatId} />

  // Maximized: transcript + composer share a centered max-w-3xl column. Otherwise the composer tracks the
  // transcript's own max content width so both stay aligned in very wide panels.
  const bodyColumn = maximized ? 'mx-auto w-full max-w-3xl' : 'w-full'
  const footerColumn = maximized ? 'mx-auto w-full max-w-3xl' : 'mx-auto w-full max-w-[880px]'

  return (
    <section
      data-agent-panel=""
      aria-label="ATOM agent"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="relative flex h-full min-h-0 w-full min-w-0 flex-col bg-panel"
    >
      <AgentHeader chatId={chatId} />
      {chatId && !loggedOut && <ChatBanner chatId={chatId} className={footerColumn} />}
      <div className="relative min-h-0 flex-1">
        <div className={cn('flex h-full min-h-0 flex-col', bodyColumn)}>
          <RenderBoundary resetKey={chatId} what="this chat" className="m-3">
            {body}
          </RenderBoundary>
        </div>
      </div>
      {chatId && !loggedOut && (
        <div className={cn('flex shrink-0 flex-col gap-1.5 px-2.5 pb-2.5 pt-1', footerColumn)}>
          <RenderBoundary key={chatId} what="the chat input">
            <TodoStrip chatId={chatId} />
            <Composer chatId={chatId} />
          </RenderBoundary>
        </div>
      )}
      {dragging && (
        <div className="pointer-events-none absolute inset-1.5 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent bg-accent-soft text-[12.5px] font-medium text-accent backdrop-blur-[1px] animate-fade-in">
          <ImagePlus size={22} />
          Drop to add as context
          <span className="text-[11px] font-normal text-muted">Images and files from the Explorer</span>
        </div>
      )}
    </section>
  )
}

function HistoryLoading() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-[12.5px] text-muted">
      <AtomLogo size={32} animated />
      <span className="animate-shimmer-text">Loading conversation…</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Error / usage banner
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'weekly',
  seven_day_opus: 'weekly Opus',
  seven_day_sonnet: 'weekly Sonnet',
  seven_day_overage_included: 'weekly',
  overage: 'extra usage'
}

function errorIcon(kind: ChatError['kind']): ReactNode {
  if (kind === 'auth') return <KeyRound size={13} />
  if (kind === 'usage-limit' || kind === 'rate-limit') return <Hourglass size={13} />
  return <TriangleAlert size={13} />
}

function ChatBanner({ chatId, className }: { chatId: string; className?: string }) {
  const error = useAgentStore((s) => s.chats[chatId]?.error ?? null)
  const rateLimit = useAgentStore((s) => s.chats[chatId]?.rateLimit ?? null)
  const [dismissedLimit, setDismissedLimit] = useState<string | null>(null)

  if (error) {
    const isLimit = error.kind === 'usage-limit' || error.kind === 'rate-limit'
    const resets = isLimit && rateLimit?.resetsAt && rateLimit.resetsAt > Date.now() ? ` · resets ${resetTime(rateLimit.resetsAt)}` : ''
    return (
      <Banner
        tone={isLimit ? 'warning' : 'danger'}
        icon={errorIcon(error.kind)}
        className={className}
        message={`${error.message}${resets}`}
        onDismiss={() => useAgentStore.getState().dismissError(chatId)}
        action={
          error.kind === 'auth' ? (
            <Button size="xs" variant="primary" onClick={() => useAuthStore.getState().openLogin('claudeai')}>
              Sign in
            </Button>
          ) : isLimit ? (
            <Button size="xs" variant="ghost" onClick={() => void atom.app.openExternal('https://claude.ai/settings/usage')}>
              View usage
            </Button>
          ) : error.kind === 'process' ? (
            <Button size="xs" variant="ghost" onClick={() => useLayoutStore.getState().openSettings('agent')}>
              Settings
            </Button>
          ) : null
        }
      />
    )
  }

  if (rateLimit && (rateLimit.status === 'allowed_warning' || rateLimit.status === 'rejected')) {
    const key = `${rateLimit.window ?? ''}:${rateLimit.resetsAt ?? ''}:${rateLimit.status}`
    if (key === dismissedLimit) return null
    const util = rateLimit.utilization !== undefined ? (rateLimit.utilization > 1 ? rateLimit.utilization : rateLimit.utilization * 100) : null
    const windowLabel = WINDOW_LABELS[rateLimit.window ?? ''] ?? 'usage'
    const resets = rateLimit.resetsAt && rateLimit.resetsAt > Date.now() ? ` · resets ${resetTime(rateLimit.resetsAt)}` : ''
    const message =
      rateLimit.status === 'rejected'
        ? `You've reached your ${windowLabel} limit${resets}`
        : `You've used ${util !== null ? `${Math.round(util)}%` : 'most'} of your ${windowLabel} limit${resets}`
    return (
      <Banner
        tone={rateLimit.status === 'rejected' ? 'danger' : 'warning'}
        icon={<Hourglass size={13} />}
        className={className}
        message={message}
        onDismiss={() => setDismissedLimit(key)}
        action={
          <Button size="xs" variant="ghost" onClick={() => void atom.app.openExternal('https://claude.ai/settings/usage')}>
            View usage
          </Button>
        }
      />
    )
  }
  return null
}

function Banner({
  tone,
  icon,
  message,
  action,
  onDismiss,
  className
}: {
  tone: 'danger' | 'warning'
  icon: ReactNode
  message: string
  action?: ReactNode
  onDismiss(): void
  className?: string
}) {
  return (
    <div className={cn('shrink-0 px-2.5 pt-2', className)}>
      <div
        role="alert"
        className={cn(
          'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] animate-fade-in',
          tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'
        )}
      >
        <span className="shrink-0">{icon}</span>
        <span className="line-clamp-2 min-w-0 flex-1 text-fg selectable" title={message}>
          {message}
        </span>
        {action}
        <button
          type="button"
          title="Dismiss"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
