import { memo } from 'react'
import { Bot, Lock, MoreHorizontal, Paperclip, Slash, Sparkles } from 'lucide-react'
import type { LibraryKind, LibraryScope } from '@shared/types'
import { Badge, Menu, Toggle, useContextMenu, type BadgeTone, type MenuEntry } from '../ui'
import type { LibraryItemInfo } from '../../stores/library'
import { cn } from '../../lib/cn'

const KIND_ICONS: Record<LibraryKind, typeof Sparkles> = { skill: Sparkles, agent: Bot, command: Slash }

export const SCOPE_BADGE: Record<LibraryScope, { label: string; tone: BadgeTone }> = {
  atom: { label: 'ATOM', tone: 'accent' },
  user: { label: 'User', tone: 'info' },
  project: { label: 'Project', tone: 'success' }
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const i = text.toLowerCase().indexOf(query)
  if (i === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-accent-soft text-accent">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  )
}

export interface LibraryItemProps {
  item: LibraryItemInfo
  kind: LibraryKind
  /** Skills only: whether the agent may use it. */
  enabled?: boolean
  onToggle?(enabled: boolean): void
  onOpen(): void
  menuEntries: MenuEntry[]
  /** Lower-cased search query for highlighting. */
  query?: string
  showScope?: boolean
}

/** One skill / subagent / command row in the Skills sidebar. */
export const LibraryItem = memo(function LibraryItem({ item, kind, enabled = true, onToggle, onOpen, menuEntries, query = '', showScope = true }: LibraryItemProps) {
  const ctx = useContextMenu()
  const Icon = KIND_ICONS[kind]
  const scope = SCOPE_BADGE[item.scope]
  const displayName = kind === 'command' ? `/${item.qualifiedName}` : item.name
  const extraFiles = 'files' in item ? item.files.filter((f) => f.toUpperCase() !== 'SKILL.MD').length : 0
  const model = 'model' in item ? item.model : undefined
  const argumentHint = 'argumentHint' in item ? item.argumentHint : undefined

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        onContextMenu={ctx.onContextMenu}
        title={item.path}
        className={cn(
          'group relative mx-1.5 flex cursor-default items-start gap-2.5 rounded-md px-2 py-2 outline-none transition-colors duration-100 hover:bg-hover focus-visible:bg-active',
          ctx.open && 'bg-active'
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
            enabled ? (item.scope === 'atom' ? 'bg-accent-soft text-accent' : 'bg-active text-muted') : 'bg-hover text-subtle'
          )}
        >
          <Icon size={13} />
        </span>
        <div className={cn('min-w-0 flex-1', !enabled && 'opacity-55')}>
          <div className="flex items-center gap-1.5">
            <span className={cn('truncate text-[12.5px] font-medium', kind === 'command' ? 'font-mono text-[12px]' : '', 'text-fg')}>
              <HighlightText text={displayName} query={query} />
            </span>
            {argumentHint && <span className="truncate font-mono text-[11px] text-subtle">{argumentHint}</span>}
            {item.readOnly && <Lock size={10} className="shrink-0 text-subtle" aria-label="Read-only" />}
            {showScope && (
              <Badge tone={scope.tone} className="ml-auto shrink-0">
                {scope.label}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted">
            {item.description ? <HighlightText text={item.description} query={query} /> : <span className="italic text-subtle">No description</span>}
          </div>
          {(model || extraFiles > 0) && (
            <div className="mt-1 flex items-center gap-1">
              {model && <Badge>{model}</Badge>}
              {extraFiles > 0 && (
                <Badge title={`${extraFiles} bundled file${extraFiles === 1 ? '' : 's'}`}>
                  <Paperclip size={9} /> {extraFiles}
                </Badge>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            title="More actions"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              ctx.openAt(r.left, r.bottom + 2)
            }}
            className={cn('rounded p-0.5 text-subtle opacity-0 transition-opacity hover:bg-hover hover:text-fg group-hover:opacity-100', ctx.open && 'opacity-100')}
          >
            <MoreHorizontal size={14} />
          </button>
          {onToggle && <Toggle size="sm" checked={enabled} onChange={onToggle} title={enabled ? 'Enabled — click to hide from the agent' : 'Disabled — click to enable'} />}
        </div>
      </div>
      <Menu {...ctx.props} entries={menuEntries} minWidth={220} />
    </>
  )
})
