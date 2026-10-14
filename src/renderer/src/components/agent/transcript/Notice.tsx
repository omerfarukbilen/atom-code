import { memo, useState } from 'react'
import {
  Bot,
  Bug,
  ChevronRight,
  CircleAlert,
  CodeXml,
  ExternalLink,
  FlaskConical,
  Info,
  ListChecks,
  LogIn,
  MessageCircleQuestion,
  RefreshCw,
  ScanSearch,
  Scissors,
  ScrollText,
  Sparkles,
  Square,
  SquareTerminal,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { PERMISSION_POLICIES, findMode } from '@shared/modes'
import { atom } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import type { NoticeItem } from '../../../lib/agent-types'
import { useAgentStore } from '../../../stores/agent'
import { useAuthStore } from '../../../stores/auth'
import { useLayoutStore } from '../../../stores/layout'
import { useSettingsStore } from '../../../stores/settings'
import { Button } from '../../ui'
import { useTranscript } from './context'
import { clockTime, formatTokens, relativeFuture } from './format'
import { Markdown } from './Markdown'
import { OutputBlock } from './ToolShell'

/** Icons used by the built-in modes (+ a few common choices for custom modes); unknown names fall back to Sparkles. */
const MODE_ICONS: Record<string, LucideIcon> = {
  Bot,
  ListChecks,
  MessageCircleQuestion,
  Bug,
  ScanSearch,
  FlaskConical,
  Sparkles,
  Wrench,
  Zap,
  CodeXml
}

export function modeIcon(name: string | undefined): LucideIcon {
  return (name && MODE_ICONS[name]) || Sparkles
}

const USAGE_URL = 'https://claude.ai/settings/usage'

function CompactDivider({ item }: { item: NoticeItem }) {
  const [open, setOpen] = useState(false)
  const tokens = item.preTokens && item.postTokens ? ` · ${formatTokens(item.preTokens)} → ${formatTokens(item.postTokens)} tokens` : ''
  return (
    <div className="my-1">
      <div className="flex items-center gap-3 text-[11px] text-subtle">
        <div className="h-px flex-1 bg-line" />
        <span className="flex shrink-0 items-center gap-1.5">
          <Scissors size={12} />
          {item.compactTrigger === 'auto' ? 'Context auto-compacted' : 'Context compacted'}
          {tokens}
        </span>
        {item.detail && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="flex shrink-0 items-center gap-0.5 text-accent hover:underline">
            <ChevronRight size={11} className={cn('transition-transform', open && 'rotate-90')} />
            Summary
          </button>
        )}
        <div className="h-px flex-1 bg-line" />
      </div>
      {open && item.detail && (
        <div className="mt-2 max-h-[360px] overflow-y-auto rounded-lg border border-line bg-elevated px-3 py-2 animate-fade-in">
          <Markdown content={item.detail} className="!text-[12px] !text-muted" />
        </div>
      )}
    </div>
  )
}

function ErrorNotice({ item }: { item: NoticeItem }) {
  const { chatId } = useTranscript()
  const rateLimit = useAgentStore((s) => s.chats[chatId]?.rateLimit ?? null)
  const [showDetail, setShowDetail] = useState(false)
  const kind = item.errorKind ?? 'unknown'
  const resetsAt = rateLimit?.resetsAt
  return (
    <div className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 animate-fade-in">
      <div className="flex items-start gap-2 text-[12.5px] text-danger">
        <CircleAlert size={14} className="mt-[2px] shrink-0" />
        <div className="selectable min-w-0 flex-1 whitespace-pre-wrap break-words">{item.text}</div>
      </div>
      {kind === 'usage-limit' && (
        <div className="mt-1 pl-[22px] text-[12px] text-muted">
          {resetsAt ? (
            <>
              Your plan’s usage limit resets at <span className="font-medium text-fg">{clockTime(resetsAt)}</span> ({relativeFuture(resetsAt)}).
            </>
          ) : (
            'You have reached your plan’s usage limit for now.'
          )}
        </div>
      )}
      {item.detail && (
        <div className="mt-1 pl-[22px]">
          <button type="button" onClick={() => setShowDetail((v) => !v)} className="flex items-center gap-0.5 text-[11px] text-muted hover:text-fg">
            <ChevronRight size={11} className={cn('transition-transform', showDetail && 'rotate-90')} />
            Details
          </button>
          {showDetail && <OutputBlock text={item.detail} maxLines={16} tone="muted" className="-mx-2.5" />}
        </div>
      )}
      {(kind === 'auth' || kind === 'usage-limit' || kind === 'process') && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-[22px]">
          {kind === 'auth' && (
            <Button variant="primary" size="xs" icon={<LogIn size={12} />} onClick={() => useAuthStore.getState().openLogin()}>
              Sign in
            </Button>
          )}
          {kind === 'usage-limit' && (
            <Button variant="secondary" size="xs" icon={<ExternalLink size={12} />} onClick={() => void atom.app.openExternal(USAGE_URL)}>
              View usage
            </Button>
          )}
          {kind === 'process' && (
            <Button variant="secondary" size="xs" icon={<ScrollText size={12} />} onClick={() => useLayoutStore.getState().showPanel('output')}>
              Show logs
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function ModeNotice({ item }: { item: NoticeItem }) {
  const custom = useSettingsStore((s) => s.settings.customModes)
  const mode = findMode(item.modeId ?? '', custom)
  const Icon = modeIcon(mode.icon)
  const permission =
    item.permission === 'plan' ? 'read-only planning' : PERMISSION_POLICIES.find((p) => p.id === item.permission)?.label.toLowerCase()
  return (
    <div className="flex justify-center py-0.5">
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-elevated px-2.5 py-0.5 text-[11px] text-muted">
        <Icon size={12} style={{ color: mode.color }} className="shrink-0" />
        <span className="truncate">
          Switched to{' '}
          <span className="font-medium" style={{ color: mode.color }}>
            {mode.name}
          </span>{' '}
          mode{permission ? ` · ${permission}` : ''}
        </span>
      </span>
    </div>
  )
}

function CommandOutput({ item }: { item: NoticeItem }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-elevated">
      <div className="flex h-7 items-center gap-1.5 border-b border-line px-2.5 text-[11.5px] text-muted">
        <SquareTerminal size={13} className="text-subtle" />
        {item.text || 'Command output'}
      </div>
      {item.detail ? <OutputBlock text={item.detail} maxLines={24} /> : null}
    </div>
  )
}

/** System notices between messages: compaction, retries, errors, interruptions, mode switches, command output. */
export const NoticeView = memo(function NoticeView({ item }: { item: NoticeItem }) {
  switch (item.variant) {
    case 'compact':
      return <CompactDivider item={item} />
    case 'retry':
      return (
        <div className="flex items-center gap-2 rounded-md bg-warning-soft px-3 py-1.5 text-[12px] text-warning animate-fade-in">
          <RefreshCw size={13} className="shrink-0 animate-spin [animation-duration:2s]" />
          <span className="min-w-0 flex-1">{item.text}</span>
        </div>
      )
    case 'error':
      return <ErrorNotice item={item} />
    case 'interrupted':
      return (
        <div className="flex items-center gap-1.5 px-1.5 text-[12px] text-subtle">
          <Square size={10} className="fill-current" />
          <span>{item.text || 'Interrupted by user'}</span>
          <span className="text-subtle/70">· tell ATOM what to do instead</span>
        </div>
      )
    case 'mode':
      return <ModeNotice item={item} />
    case 'command-output':
      return <CommandOutput item={item} />
    default:
      return (
        <div className="flex items-start gap-1.5 px-1.5 text-[12px] text-muted">
          <Info size={13} className="mt-[2px] shrink-0 text-info" />
          <div className="min-w-0 flex-1">
            <div className="selectable break-words">{item.text}</div>
            {item.detail &&
              (item.detailMarkdown ? (
                <Markdown content={item.detail} className="mt-1 !text-[12px]" />
              ) : (
                <div className="selectable mt-0.5 whitespace-pre-wrap break-words text-[11.5px] text-subtle">{item.detail}</div>
              ))}
          </div>
        </div>
      )
  }
})
