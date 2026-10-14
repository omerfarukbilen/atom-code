import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { ArrowDown, CircleAlert, LogIn, TriangleAlert } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { isRunning } from '../../../lib/agent-reducer'
import type { AssistantItem, TranscriptItem } from '../../../lib/agent-types'
import { useAgentStore, useChat } from '../../../stores/agent'
import { useAuthStore } from '../../../stores/auth'
import { useWorkspaceStore } from '../../../stores/workspace'
import { Button, Spinner } from '../../ui'
import { BlockList } from './Blocks'
import { TranscriptContext, type TranscriptContextValue } from './context'
import { NoticeView } from './Notice'
import { PendingRequests } from './PendingCards'
import { ResultFooter } from './ResultFooter'
import { StreamingIndicator } from './StreamingIndicator'
import { UserMessage } from './UserMessage'
import { useStickToBottom } from './useStickToBottom'

const EMPTY_ITEMS: TranscriptItem[] = []

/** Off-screen turns skip layout/paint (the browser remembers their last rendered size). */
const DEFERRED_STYLE: CSSProperties = { contentVisibility: 'auto', containIntrinsicSize: 'auto 360px' }

// ─────────────────────────────────────────────────────────────────────────────
// Turn grouping
// ─────────────────────────────────────────────────────────────────────────────

interface TurnModel {
  key: string
  items: TranscriptItem[]
}

/** A turn = a user message and everything after it until the next user message. */
function groupTurns(items: TranscriptItem[]): TurnModel[] {
  const turns: TurnModel[] = []
  let cur: TranscriptItem[] = []
  for (const it of items) {
    if (it.kind === 'user' && cur.length) {
      turns.push({ key: cur[0].id, items: cur })
      cur = []
    }
    cur.push(it)
  }
  if (cur.length) turns.push({ key: cur[0].id, items: cur })
  return turns
}

type Segment = { kind: 'assistant'; key: string; items: AssistantItem[] } | { kind: 'item'; item: TranscriptItem }

/** Consecutive assistant messages (one per API call in a tool loop) render as one visual answer. */
function segmentTurn(items: TranscriptItem[]): Segment[] {
  const out: Segment[] = []
  for (const it of items) {
    if (it.kind === 'assistant') {
      const last = out[out.length - 1]
      if (last?.kind === 'assistant') last.items.push(it)
      else out.push({ kind: 'assistant', key: it.id, items: [it] })
    } else {
      out.push({ kind: 'item', item: it })
    }
  }
  return out
}

/** Main-thread assistant text of a turn (for "Copy response"). */
function turnText(items: TranscriptItem[]): string {
  const parts: string[] = []
  for (const it of items) {
    if (it.kind !== 'assistant') continue
    for (const b of it.blocks) if (b.kind === 'text' && b.text.trim()) parts.push(b.text.trim())
  }
  return parts.join('\n\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Assistant message
// ─────────────────────────────────────────────────────────────────────────────

const ASSISTANT_ERRORS: Record<string, string> = {
  authentication_failed: 'Authentication failed — sign in again to continue.',
  billing_error: 'There is a billing problem with this account.',
  rate_limit: 'Rate limited by the API.',
  invalid_request: 'The API rejected the request.',
  server_error: 'The Claude API returned a server error.',
  max_output_tokens: 'The response hit the output token limit.',
  unknown: 'The response failed.'
}

function InlineNote({ tone, icon, children, action }: { tone: 'warning' | 'danger'; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={cn('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]', tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger')}>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  )
}

const AssistantMessage = memo(function AssistantMessage({ item }: { item: AssistantItem }) {
  return (
    <>
      <BlockList blocks={item.blocks} />
      {item.stopReason === 'max_tokens' && (
        <InlineNote tone="warning" icon={<TriangleAlert size={13} />}>
          The response hit the output token limit and was cut off.
        </InlineNote>
      )}
      {item.stopReason === 'refusal' && (
        <InlineNote tone="warning" icon={<TriangleAlert size={13} />}>
          The model declined to continue this response.
        </InlineNote>
      )}
      {item.error && (
        <InlineNote
          tone="danger"
          icon={<CircleAlert size={13} />}
          action={
            item.error === 'authentication_failed' ? (
              <Button variant="primary" size="xs" icon={<LogIn size={12} />} onClick={() => useAuthStore.getState().openLogin()}>
                Sign in
              </Button>
            ) : undefined
          }
        >
          {ASSISTANT_ERRORS[item.error] ?? `The response failed (${item.error.replace(/_/g, ' ')}).`}
        </InlineNote>
      )}
    </>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Turn
// ─────────────────────────────────────────────────────────────────────────────

function sameItems(a: { items: TranscriptItem[]; deferred: boolean }, b: { items: TranscriptItem[]; deferred: boolean }): boolean {
  if (a.deferred !== b.deferred || a.items.length !== b.items.length) return false
  for (let i = 0; i < a.items.length; i++) if (a.items[i] !== b.items[i]) return false
  return true
}

const Turn = memo(function Turn({ items, deferred }: { items: TranscriptItem[]; deferred: boolean }) {
  const segments = useMemo(() => segmentTurn(items), [items])
  const hasResult = items.some((i) => i.kind === 'result')
  const copyText = useMemo(() => (hasResult ? turnText(items) : ''), [hasResult, items])
  return (
    <section className="flex min-w-0 flex-col gap-2" style={deferred ? DEFERRED_STYLE : undefined}>
      {segments.map((seg) => {
        if (seg.kind === 'assistant') {
          return (
            <div key={seg.key} className="flex min-w-0 flex-col gap-1.5">
              {seg.items.map((a) => (
                <AssistantMessage key={a.id} item={a} />
              ))}
            </div>
          )
        }
        const it = seg.item
        switch (it.kind) {
          case 'user':
            return <UserMessage key={it.id} item={it} />
          case 'notice':
            return <NoticeView key={it.id} item={it} />
          case 'result':
            return <ResultFooter key={it.id} item={it} copyText={copyText || undefined} />
          default:
            return null
        }
      })}
    </section>
  )
}, sameItems)

// ─────────────────────────────────────────────────────────────────────────────
// Message list
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The chat transcript: turns (user message → assistant blocks → result footer), notices, pending
 * permission / plan / question cards and the live activity indicator, with stick-to-bottom scrolling.
 */
export function MessageList({ chatId }: { chatId: string }) {
  const chat = useChat(chatId)
  const fallbackWorkspace = useWorkspaceStore((s) => s.workspace?.path ?? '')
  const workspace = chat?.workspace || fallbackWorkspace
  const items = chat?.items ?? EMPTY_ITEMS
  const running = chat ? isRunning(chat) : false
  const pendingCount = chat?.pendingRequests.length ?? 0
  const historyLoading = chat?.historyLoading ?? false
  const needsHistory = !!chat && !chat.historyLoaded && !chat.historyLoading

  const turns = useMemo(() => groupTurns(items), [items])
  const { scrollRef, contentRef, showJump, scrollToBottom, pinIfSticky, onScroll, onWheel } = useStickToBottom(chatId, running)

  // A new prompt from the user always brings the view back to the bottom.
  let lastUserId = ''
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === 'user') {
      lastUserId = items[i].id
      break
    }
  }
  const prevUser = useRef({ chatId, lastUserId })
  useLayoutEffect(() => {
    const prev = prevUser.current
    prevUser.current = { chatId, lastUserId }
    if (prev.chatId === chatId && prev.lastUserId !== lastUserId && lastUserId) scrollToBottom()
  }, [chatId, lastUserId, scrollToBottom])

  // New items (e.g. the turn footer) stay visible while pinned.
  useLayoutEffect(() => {
    pinIfSticky()
  }, [items.length, pinIfSticky])

  // A new permission / plan / question prompt blocks the agent: always bring it into view.
  const prevPending = useRef({ chatId, count: pendingCount })
  useLayoutEffect(() => {
    const prev = prevPending.current
    prevPending.current = { chatId, count: pendingCount }
    if (prev.chatId === chatId && pendingCount > prev.count) scrollToBottom()
    else pinIfSticky()
  }, [chatId, pendingCount, scrollToBottom, pinIfSticky])

  useEffect(() => {
    if (needsHistory) void useAgentStore.getState().loadHistoryIfNeeded(chatId)
  }, [needsHistory, chatId])

  const ctx = useMemo<TranscriptContextValue>(() => ({ chatId, workspace }), [chatId, workspace])

  return (
    <TranscriptContext.Provider value={ctx}>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={scrollRef} onScroll={onScroll} onWheel={onWheel} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div ref={contentRef} className="mx-auto flex w-full min-w-0 max-w-[880px] flex-col gap-5 px-4 pb-6 pt-4">
            {historyLoading && (
              <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-muted">
                <Spinner size={13} /> Loading conversation…
              </div>
            )}
            {turns.map((t, i) => (
              <Turn key={t.key} items={t.items} deferred={i < turns.length - 3} />
            ))}
            <PendingRequests chatId={chatId} />
            <StreamingIndicator chatId={chatId} />
          </div>
        </div>
        {showJump && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <button
              type="button"
              title="Scroll to the latest message"
              onClick={() => scrollToBottom('smooth')}
              className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-line bg-overlay px-3 py-1 text-[11.5px] font-medium text-fg shadow-pop transition-colors hover:bg-elevated animate-fade-in"
            >
              <ArrowDown size={12} />
              Jump to latest
              {running && <span className="h-1.5 w-1.5 rounded-full bg-accent animate-atom-pulse" aria-hidden />}
            </button>
          </div>
        )}
      </div>
    </TranscriptContext.Provider>
  )
}
