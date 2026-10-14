import { memo } from 'react'
import { Check, CircleAlert, Copy, Square } from 'lucide-react'
import type { ResultItem } from '../../../lib/agent-types'
import { useCopy } from './context'
import { formatCost, formatDuration, formatTokens, plural } from './format'

/** Subtle per-turn footer: "12.4s · 6 turns · ≈$0.08 · 14.2k tokens" (+ error text for failed turns). */
export const ResultFooter = memo(function ResultFooter({ item, copyText }: { item: ResultItem; copyText?: string }) {
  const [copied, copy] = useCopy()
  const tokens = item.inputTokens + item.outputTokens + item.cacheReadTokens + item.cacheCreationTokens
  const breakdown = [
    `Input ${formatTokens(item.inputTokens)}`,
    `Output ${formatTokens(item.outputTokens)}`,
    item.cacheReadTokens ? `Cache read ${formatTokens(item.cacheReadTokens)}` : '',
    item.cacheCreationTokens ? `Cache write ${formatTokens(item.cacheCreationTokens)}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
  const costTitle = `API-equivalent estimate for this turn (${formatCost(item.totalCostUsd).replace('≈', '')} for the session). With a Claude subscription this is covered by your plan’s usage limits, not billed.`

  return (
    <div className="flex flex-col gap-1">
      {item.errorText && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-1.5 text-[12px] text-danger">
          <CircleAlert size={13} className="mt-[2px] shrink-0" />
          <span className="selectable min-w-0 flex-1 whitespace-pre-wrap break-words">{item.errorText}</span>
        </div>
      )}
      <div className="group/result flex min-h-[20px] flex-wrap items-center gap-x-1.5 px-1.5 text-[11px] text-subtle">
        {item.interrupted ? (
          <span className="flex items-center gap-1">
            <Square size={8} className="fill-current" /> Interrupted ·
          </span>
        ) : item.isError ? (
          <CircleAlert size={11} className="text-danger" />
        ) : (
          <Check size={11} className="text-success/80" />
        )}
        <span title={item.durationApiMs ? `API time ${formatDuration(item.durationApiMs)}` : undefined}>{formatDuration(item.durationMs)}</span>
        {item.numTurns > 0 && (
          <>
            <span>·</span>
            <span>{plural(item.numTurns, 'turn')}</span>
          </>
        )}
        {item.costUsd > 0 && (
          <>
            <span>·</span>
            <span title={costTitle} className="cursor-help">
              {formatCost(item.costUsd)}
            </span>
          </>
        )}
        {tokens > 0 && (
          <>
            <span>·</span>
            <span title={breakdown} className="cursor-help">
              {formatTokens(tokens)} tokens
            </span>
          </>
        )}
        {item.permissionDenials > 0 && (
          <>
            <span>·</span>
            <span className="text-warning">{item.permissionDenials} denied</span>
          </>
        )}
        {copyText && (
          <button
            type="button"
            title={copied ? 'Copied' : 'Copy response'}
            onClick={() => copy(copyText)}
            className="ml-1 flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity hover:bg-hover hover:text-fg focus:opacity-100 group-hover/result:opacity-100"
          >
            {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
          </button>
        )}
      </div>
    </div>
  )
})
