import { isRunning } from '../../../lib/agent-reducer'
import { cn } from '../../../lib/cn'
import { useAgentStore } from '../../../stores/agent'
import { formatTokens } from './utils'

const SIZE = 18
const STROKE = 2.25
const R = (SIZE - STROKE) / 2
const C = 2 * Math.PI * R

/** Context-window usage ring. Click compacts the conversation once it is more than half full. */
export function ContextRing({ chatId }: { chatId: string }) {
  const usage = useAgentStore((s) => s.chats[chatId]?.contextUsage ?? null)
  const compacting = useAgentStore((s) => !!s.chats[chatId]?.compacting)
  const running = useAgentStore((s) => {
    const c = s.chats[chatId]
    return !!c && isRunning(c)
  })

  if (!usage && !compacting) return null
  const pct = Math.max(0, Math.min(100, usage ? (usage.percentage > 0 ? usage.percentage : usage.maxTokens ? (usage.totalTokens / usage.maxTokens) * 100 : 0) : 0))
  const canCompact = pct > 50 && !running && !compacting
  const tone = pct >= 95 ? 'text-danger' : pct > 80 ? 'text-warning' : pct > 50 ? 'text-accent' : 'text-subtle'

  const title = compacting
    ? 'Compacting the conversation…'
    : `Context: ${formatTokens(usage?.totalTokens ?? 0)} / ${formatTokens(usage?.maxTokens ?? 0)} tokens (${Math.round(pct)}%)` +
      (canCompact ? '\nClick to compact the conversation and free up space' : pct > 50 && running ? '\nYou can compact once ATOM finishes this turn' : '')

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={() => {
        if (canCompact) void useAgentStore.getState().send('/compact', { chatId })
        else void useAgentStore.getState().refreshContextUsage(chatId)
      }}
      className={cn('flex h-6 shrink-0 items-center gap-1 rounded-md px-1 transition-colors duration-100 hover:bg-hover', tone)}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className={cn('-rotate-90', compacting && 'animate-orbit')} aria-hidden>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--line-strong)" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={compacting ? C * 0.7 : C * (1 - pct / 100)}
          style={{ transition: 'stroke-dashoffset 300ms ease' }}
        />
      </svg>
      {pct > 80 && !compacting && <span className="hidden text-[10.5px] tabular-nums @sm:inline">{Math.round(pct)}%</span>}
    </button>
  )
}
