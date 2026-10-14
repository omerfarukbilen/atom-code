import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Ban, Check, ChevronRight, Copy, ShieldAlert, Square, X, type LucideIcon } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { FileIcon } from '../../../lib/file-icons'
import { isToolActive } from '../../../lib/agent-reducer'
import type { ToolCall } from '../../../lib/agent-types'
import { useAgentStore } from '../../../stores/agent'
import { Spinner } from '../../ui'
import { useCopy, useDepth, useNow, useTranscript } from './context'
import { displayPath, lineRangeLabel, openPath } from './file-links'
import { countLines, formatDuration, formatElapsed, prettyJson, stripAnsi } from './format'

// ─────────────────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────────────────

/** True when a permission / plan / question prompt is waiting for this tool call. */
export function useAwaitingApproval(toolId: string): boolean {
  const { chatId } = useTranscript()
  return useAgentStore((s) => s.chats[chatId]?.pendingRequests.some((r) => r.toolUseId === toolId) ?? false)
}

export function StatusIcon({ tool, awaiting, size = 13 }: { tool: ToolCall; awaiting: boolean; size?: number }) {
  if (awaiting) return <ShieldAlert size={size} className="shrink-0 text-warning" aria-label="Awaiting approval" />
  if (isToolActive(tool)) return <Spinner size={size - 2} className="text-accent" />
  switch (tool.status) {
    case 'success':
      return <Check size={size} className="shrink-0 text-success" aria-label="Done" />
    case 'error':
      return <X size={size} className="shrink-0 text-danger" aria-label="Failed" />
    case 'denied':
      return <Ban size={size - 1} className="shrink-0 text-warning" aria-label="Denied" />
    case 'interrupted':
      return <Square size={size - 3} className="shrink-0 fill-current text-subtle" aria-label="Interrupted" />
    default:
      return <Spinner size={size - 2} className="text-accent" />
  }
}

/** Live elapsed time while active; final duration once done (hidden when under a second). */
export function ToolElapsed({ tool, awaiting }: { tool: ToolCall; awaiting: boolean }) {
  const active = isToolActive(tool) && !awaiting
  const now = useNow(active)
  let ms: number
  if (active) {
    const fromStart = now - tool.startedAt
    ms = tool.elapsedSeconds !== undefined ? Math.max(tool.elapsedSeconds * 1000, fromStart) : fromStart
  } else {
    ms = (tool.endedAt ?? tool.startedAt) - tool.startedAt
  }
  if (ms < 1000) return null
  return (
    <span className="shrink-0 tabular-nums text-[11px] text-subtle" title={active ? 'Running' : 'Duration'}>
      {active ? formatElapsed(ms / 1000) : formatDuration(ms)}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolShellProps {
  tool: ToolCall
  icon: LucideIcon
  /** One-line human summary. */
  title: ReactNode
  /** Extra info right of the title (counts, badges). */
  meta?: ReactNode
  /** `row` = light single line (Read, Grep…), `card` = bordered card (Edit, Bash, Agent…). */
  variant?: 'row' | 'card'
  /** Expandable details. When omitted the header is not expandable. */
  children?: ReactNode
  /** Initial expansion (follows changes until the user toggles). */
  defaultOpen?: boolean
  /** Header click runs this instead of toggling (e.g. Read opens the file). */
  onTitleClick?: () => void
  titleTooltip?: string
  /** Icon buttons shown in the header (cards) on hover. */
  actions?: ReactNode
  /** Always-visible content under a card header (e.g. the Bash command). */
  preview?: ReactNode
  /** The renderer shows the error itself. */
  hideError?: boolean
  iconClassName?: string
  className?: string
}

function ErrorText({ tool, inset }: { tool: ToolCall; inset?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const text = stripAnsi(tool.result?.text ?? '').trim()
  if (!text) return null
  const denied = tool.status === 'denied'
  const lines = text.split('\n')
  const long = lines.length > 4 || text.length > 400
  const shown = expanded || !long ? text : lines.slice(0, 4).join('\n').slice(0, 400) + '…'
  return (
    <div className={cn('selectable whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[17px]', denied ? 'text-warning' : 'text-danger', inset ? 'px-2.5 py-1.5' : 'pl-[22px] pt-0.5')}>
      {shown}
      {long && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="ml-2 font-sans text-[11px] text-muted hover:text-fg">
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

/** Shared tool call chrome: status, icon, summary, elapsed time, expand/collapse, error text. */
export function ToolShell({
  tool,
  icon: Icon,
  title,
  meta,
  variant = 'row',
  children,
  defaultOpen = false,
  onTitleClick,
  titleTooltip,
  actions,
  preview,
  hideError,
  iconClassName,
  className
}: ToolShellProps) {
  const depth = useDepth()
  const awaiting = useAwaitingApproval(tool.id)
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const expandable = children !== undefined && children !== null && children !== false
  const open = expandable && (userOpen ?? defaultOpen)
  const showError = !hideError && (tool.status === 'error' || tool.status === 'denied') && !!tool.result?.text
  const toggle = (): void => {
    if (expandable) setUserOpen(!open)
  }
  const onHeaderClick = onTitleClick ?? (expandable ? toggle : undefined)
  const headerA11y = onHeaderClick
    ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-expanded': expandable && !onTitleClick ? open : undefined,
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
          e.preventDefault()
          onHeaderClick()
        }
      }
    : {}
  const chevron = expandable ? (
    <button
      type="button"
      title={open ? 'Collapse' : 'Expand'}
      onClick={(e) => {
        e.stopPropagation()
        toggle()
      }}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-hover hover:text-fg"
    >
      <ChevronRight size={13} className={cn('transition-transform duration-150', open && 'rotate-90')} />
    </button>
  ) : null

  if (variant === 'row') {
    const active = isToolActive(tool) || awaiting
    const statusShown = active || tool.status === 'error' || tool.status === 'denied' || tool.status === 'interrupted'
    return (
      <div className={cn('min-w-0', className)}>
        <div
          title={titleTooltip}
          onClick={onHeaderClick}
          {...headerA11y}
          className={cn(
            'group flex min-h-[26px] min-w-0 items-center gap-2 rounded-md px-1.5 text-[12.5px] text-muted transition-colors',
            onHeaderClick && 'cursor-pointer hover:bg-hover hover:text-fg',
            depth > 0 && 'min-h-[22px] text-[12px]'
          )}
        >
          <Icon size={depth > 0 ? 13 : 14} className={cn('shrink-0 text-subtle group-hover:text-muted', iconClassName)} />
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">{title}</div>
          {meta}
          {statusShown && <StatusIcon tool={tool} awaiting={awaiting} size={12} />}
          <ToolElapsed tool={tool} awaiting={awaiting} />
          {chevron}
        </div>
        {showError && <ErrorText tool={tool} />}
        {open && <div className="mb-1 ml-[22px] mt-1 overflow-hidden rounded-md border border-line bg-elevated animate-fade-in">{children}</div>}
      </div>
    )
  }

  return (
    <div className={cn('min-w-0 overflow-hidden rounded-lg border bg-elevated', awaiting ? 'border-warning/50' : 'border-line', className)}>
      <div
        title={titleTooltip}
        onClick={onHeaderClick}
        {...headerA11y}
        className={cn(
          'group flex min-w-0 items-center gap-2 px-2.5 text-[12.5px] text-fg transition-colors',
          depth > 0 ? 'h-7 text-[12px]' : 'h-8',
          onHeaderClick && 'cursor-pointer hover:bg-hover'
        )}
      >
        <StatusIcon tool={tool} awaiting={awaiting} />
        <Icon size={14} className={cn('shrink-0 text-muted', iconClassName)} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">{title}</div>
        {meta}
        {actions && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
        {awaiting && <span className="shrink-0 text-[11px] text-warning">Awaiting approval</span>}
        <ToolElapsed tool={tool} awaiting={awaiting} />
        {chevron}
      </div>
      {preview}
      {showError && (
        <div className="border-t border-line">
          <ErrorText tool={tool} inset />
        </div>
      )}
      {open && <div className="border-t border-line animate-fade-in">{children}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Building blocks for tool details
// ─────────────────────────────────────────────────────────────────────────────

/** Clickable file chip: icon + name (+ line range). */
export function PathChip({ path, line, endLine, className, full }: { path: string; line?: number; endLine?: number; className?: string; full?: boolean }) {
  const { workspace } = useTranscript()
  if (!path) return null
  const label = displayPath(path, workspace)
  const name = full ? label : label.split('/').pop() || label
  const range = lineRangeLabel(line, endLine)
  return (
    <button
      type="button"
      title={`Open ${label}${range ? ` (${range})` : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        openPath(path, workspace, line, endLine)
      }}
      className={cn('inline-flex min-w-0 max-w-full items-center gap-1 rounded px-0.5 text-fg hover:bg-hover hover:underline', className)}
    >
      <FileIcon name={path} size={13} />
      <span className="truncate font-mono text-[12px]">{name}</span>
      {range && <span className="shrink-0 font-mono text-[11px] text-subtle">{range}</span>}
    </button>
  )
}

/** Small text button for tool actions ("Open file", "Open diff"). */
export function ToolAction({ icon: Icon, label, onClick, title }: { icon: LucideIcon; label: string; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title ?? label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] text-muted hover:bg-hover hover:text-fg"
    >
      <Icon size={12} />
      {label}
    </button>
  )
}

/** Monospace output with ANSI stripped, collapsed after `maxLines`, with a copy button. */
export function OutputBlock({
  text,
  maxLines = 20,
  tone = 'default',
  label,
  className
}: {
  text: string
  maxLines?: number
  tone?: 'default' | 'danger' | 'muted'
  label?: ReactNode
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [copied, copy] = useCopy()
  const clean = stripAnsi(text).replace(/\n+$/, '')
  if (!clean.trim()) return null
  const lines = clean.split('\n')
  const total = lines.length
  const collapsible = total > maxLines + 2
  const shown = collapsible && !expanded ? lines.slice(0, maxLines).join('\n') : clean
  return (
    <div className={cn('group/out relative', className)}>
      {label && <div className="px-2.5 pt-1.5 text-[10.5px] font-medium uppercase tracking-wide text-subtle">{label}</div>}
      <button
        type="button"
        title={copied ? 'Copied' : 'Copy output'}
        onClick={() => copy(clean)}
        className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded bg-elevated text-subtle opacity-0 hover:bg-hover hover:text-fg group-hover/out:opacity-100"
      >
        {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
      </button>
      <pre
        className={cn(
          'selectable max-h-[480px] overflow-auto whitespace-pre-wrap break-words px-2.5 py-1.5 font-mono text-[11.5px] leading-[17px]',
          tone === 'danger' ? 'text-danger' : tone === 'muted' ? 'text-muted' : 'text-fg'
        )}
      >
        {shown}
      </pre>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1 border-t border-line py-1 text-[11px] text-muted hover:bg-hover hover:text-fg"
        >
          {expanded ? 'Show less' : `Show all ${total} lines (${total - maxLines} more)`}
        </button>
      )}
    </div>
  )
}

/** Collapsible pretty-printed JSON section. */
export function JsonSection({ label, value, defaultOpen = false }: { label: string; value: unknown; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const text = prettyJson(value)
  if (!text || text === '{}' || text === '""') return null
  const lines = countLines(text)
  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-2.5 py-1 text-left text-[11px] font-medium text-muted hover:bg-hover hover:text-fg"
      >
        <ChevronRight size={12} className={cn('transition-transform', open && 'rotate-90')} />
        {label}
        <span className="font-normal text-subtle">· {lines === 1 ? `${text.length} chars` : `${lines} lines`}</span>
      </button>
      {open && <OutputBlock text={text} maxLines={40} />}
    </div>
  )
}

/** Labelled area inside tool details. */
export function DetailSection({ label, children, className }: { label?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('border-b border-line px-2.5 py-1.5 last:border-b-0', className)}>
      {label && <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-subtle">{label}</div>}
      {children}
    </div>
  )
}

/** Muted inline code-ish text inside summaries. */
export function Mono({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('truncate font-mono text-[11.5px] text-muted', className)}>
      {children}
    </span>
  )
}
