import { isToolActive, queuedMessageCount } from '../../../lib/agent-reducer'
import type { ChatState } from '../../../lib/agent-types'
import { useAgentStore } from '../../../stores/agent'
import { AtomLogo } from '../../ui'
import { useNow } from './context'
import { formatElapsed, plural } from './format'

type IndicatorState = 'starting' | 'compacting' | 'thinking' | 'working' | null

/** What the bottom-of-transcript activity row should say (null = hidden). */
export function indicatorState(chat: ChatState | undefined): IndicatorState {
  if (!chat) return null
  if (chat.compacting) return 'compacting'
  if (chat.status === 'starting') return 'starting'
  if (chat.status !== 'running' || chat.pendingRequests.length) return null
  const last = chat.items[chat.items.length - 1]
  if (last?.kind === 'assistant') {
    const b = last.blocks[last.blocks.length - 1]
    // Streaming text and live thinking rows already show activity.
    if (b?.kind === 'text' && b.streaming && b.text.trim()) return null
    if (b?.kind === 'thinking' && b.streaming) return null
    if (b?.kind === 'tool' && isToolActive(b)) return 'working'
  }
  return 'thinking'
}

const LABELS: Record<Exclude<IndicatorState, null>, string> = {
  starting: 'Starting ATOM…',
  compacting: 'Compacting conversation…',
  thinking: 'ATOM is thinking…',
  working: 'ATOM is working…'
}

/** "ATOM is thinking… 12s" with the animated ATOM mark while a turn runs and nothing else shows progress. */
export function StreamingIndicator({ chatId }: { chatId: string }) {
  const state = useAgentStore((s) => indicatorState(s.chats[chatId]))
  const startedAt = useAgentStore((s) => s.chats[chatId]?.turnStartedAt ?? null)
  const queued = useAgentStore((s) => {
    const c = s.chats[chatId]
    return c ? queuedMessageCount(c) : 0
  })
  const now = useNow(state !== null)
  if (!state) return null
  const secs = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  return (
    <div className="flex items-center gap-2 px-1 py-1 text-[12.5px] animate-fade-in" role="status" aria-live="polite">
      <AtomLogo size={18} animated />
      <span className="animate-shimmer-text font-medium">{LABELS[state]}</span>
      {secs > 0 && <span className="tabular-nums text-[11px] text-subtle">{formatElapsed(secs)}</span>}
      {queued > 0 && <span className="text-[11px] text-subtle">· {plural(queued, 'message')} queued</span>}
    </div>
  )
}
