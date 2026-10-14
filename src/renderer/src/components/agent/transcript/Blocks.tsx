import { memo, useMemo, useState } from 'react'
import { Brain, ChevronRight, Telescope } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { isToolActive } from '../../../lib/agent-reducer'
import type { AssistantBlock, TextBlock, ThinkingBlock, ToolCall } from '../../../lib/agent-types'
import { useDepth, useNow } from './context'
import { plural, str } from './format'
import { Markdown } from './Markdown'
import { ToolCard, isExploreTool } from './ToolCard'

// ─────────────────────────────────────────────────────────────────────────────
// Text & thinking
// ─────────────────────────────────────────────────────────────────────────────

export const TextBlockView = memo(function TextBlockView({ block }: { block: TextBlock }) {
  const depth = useDepth()
  if (!block.text.trim()) return null
  return <Markdown content={block.text} className={cn(depth > 0 ? '!text-[12px] !text-muted' : 'py-0.5')} />
})

export const ThinkingBlockView = memo(function ThinkingBlockView({ block }: { block: ThinkingBlock }) {
  const [open, setOpen] = useState(false)
  const now = useNow(block.streaming)
  const hasText = block.text.trim().length > 0
  const secs = Math.round(((block.endedAt ?? now) - block.startedAt) / 1000)
  const label = block.streaming
    ? 'Thinking…'
    : block.redacted
      ? 'Thinking (redacted)'
      : secs >= 1
        ? `Thought for ${secs}s`
        : 'Thought briefly'
  return (
    <div className="min-w-0">
      <button
        type="button"
        disabled={!hasText}
        onClick={() => setOpen((v) => !v)}
        title={hasText ? (open ? 'Hide thinking' : 'Show thinking') : undefined}
        className="group flex min-h-[24px] items-center gap-1.5 rounded-md px-1.5 text-[12.5px] text-subtle enabled:hover:bg-hover enabled:hover:text-muted"
      >
        <Brain size={13} className={cn('shrink-0', block.streaming && 'animate-atom-pulse text-accent')} />
        <span className={cn(block.streaming && 'animate-shimmer-text')}>{label}</span>
        {block.streaming && secs >= 2 && <span className="tabular-nums text-[11px] text-subtle">{secs}s</span>}
        {hasText && <ChevronRight size={12} className={cn('transition-transform duration-150', open && 'rotate-90')} />}
      </button>
      {open && hasText && (
        <div className="mb-1 ml-[13px] mt-0.5 border-l-2 border-line pl-3 animate-fade-in">
          <Markdown content={block.text} className="!text-[12px] italic !text-subtle" />
        </div>
      )}
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// "Explored …" groups of read-only tool rows
// ─────────────────────────────────────────────────────────────────────────────

type BlockGroup = { kind: 'block'; block: AssistantBlock } | { kind: 'explore'; key: string; blocks: AssistantBlock[] }

function isDone(b: AssistantBlock): boolean {
  if (b.kind === 'tool') return !isToolActive(b)
  if (b.kind === 'thinking') return !b.streaming
  return true
}

function groupBlocks(blocks: AssistantBlock[]): BlockGroup[] {
  const out: BlockGroup[] = []
  let run: AssistantBlock[] = []
  const flush = (): void => {
    if (!run.length) return
    // Fold the finished prefix of the run (ending with a tool) when it holds at least 3 tool calls.
    let end = 0
    while (end < run.length && isDone(run[end])) end++
    while (end > 0 && run[end - 1].kind !== 'tool') end--
    const prefix = run.slice(0, end)
    const tools = prefix.filter((b) => b.kind === 'tool').length
    if (tools >= 3) {
      out.push({ kind: 'explore', key: prefix[0].id, blocks: prefix })
      for (const b of run.slice(end)) out.push({ kind: 'block', block: b })
    } else {
      for (const b of run) out.push({ kind: 'block', block: b })
    }
    run = []
  }
  for (const b of blocks) {
    if ((b.kind === 'tool' && isExploreTool(b)) || (b.kind === 'thinking' && run.length > 0)) {
      run.push(b)
      continue
    }
    flush()
    out.push({ kind: 'block', block: b })
  }
  flush()
  return out
}

function exploreSummary(tools: ToolCall[]): { text: string; failed: number } {
  const files = new Set<string>()
  let searches = 0
  let web = 0
  let other = 0
  let failed = 0
  for (const t of tools) {
    if (t.status === 'error' || t.status === 'denied') failed++
    if (t.name === 'Read') files.add(str(t.input.file_path) ?? t.id)
    else if (t.name === 'Grep' || t.name === 'Glob' || t.name === 'LS') searches++
    else if (/^(WebSearch|WebFetch|web_search|web_fetch)$/.test(t.name)) web++
    else other++
  }
  const parts: string[] = []
  if (files.size) parts.push(plural(files.size, 'file'))
  if (searches) parts.push(plural(searches, 'search', 'searches'))
  if (web) parts.push(`${web} web ${web === 1 ? 'lookup' : 'lookups'}`)
  if (other) parts.push(plural(other, 'IDE check'))
  return { text: parts.join(', '), failed }
}

const ExploreGroup = memo(function ExploreGroup({ blocks }: { blocks: AssistantBlock[] }) {
  const depth = useDepth()
  const [open, setOpen] = useState(false)
  const tools = blocks.filter((b): b is ToolCall => b.kind === 'tool')
  const { text, failed } = exploreSummary(tools)
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Collapse' : 'Show each step'}
        className={cn(
          'group flex min-h-[26px] w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-[12.5px] text-muted hover:bg-hover hover:text-fg',
          depth > 0 && 'min-h-[22px] text-[12px]'
        )}
      >
        <Telescope size={14} className="shrink-0 text-subtle group-hover:text-muted" />
        <span className="shrink-0">Explored</span>
        <span className="truncate text-subtle">{text}</span>
        {failed > 0 && <span className="shrink-0 text-[11px] text-danger">{failed} failed</span>}
        <span className="flex-1" />
        <ChevronRight size={13} className={cn('shrink-0 text-subtle transition-transform duration-150', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="ml-[13px] mt-0.5 border-l border-line pl-2 animate-fade-in">
          <BlockList blocks={blocks} group={false} />
        </div>
      )}
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Block list
// ─────────────────────────────────────────────────────────────────────────────

export const BlockView = memo(function BlockView({ block }: { block: AssistantBlock }) {
  if (block.kind === 'text') return <TextBlockView block={block} />
  if (block.kind === 'thinking') return <ThinkingBlockView block={block} />
  return <ToolCard tool={block} />
})

/** Ordered assistant blocks (text, thinking, tool calls); runs of finished read-only tools fold into a group. */
export function BlockList({ blocks, group = true }: { blocks: AssistantBlock[]; group?: boolean }) {
  const depth = useDepth()
  const groups = useMemo<BlockGroup[]>(() => (group ? groupBlocks(blocks) : blocks.map((block) => ({ kind: 'block', block }))), [blocks, group])
  return (
    <div className={cn('flex min-w-0 flex-col', depth > 0 ? 'gap-0.5' : 'gap-1.5')}>
      {groups.map((g) => (g.kind === 'explore' ? <ExploreGroup key={`g:${g.key}`} blocks={g.blocks} /> : <BlockView key={g.block.id} block={g.block} />))}
    </div>
  )
}
