import { useEffect, useMemo, type RefObject } from 'react'
import { Check } from 'lucide-react'
import type { AgentModeDefinition, ModelOption, SlashCommandInfo } from '@shared/types'
import { normalizeModelValue } from '@shared/modes'
import { fuzzyScore, highlightSegments } from '../../../lib/fuzzy'
import { cn } from '../../../lib/cn'
import { useAgentModes, useAgentStore, useAvailableModels } from '../../../stores/agent'
import { useLibraryStore } from '../../../stores/library'
import { ModeIcon } from '../../settings/mode-icons'
import { PopupList, type PopupAnchor, type PopupMenuHandle, type PopupSelectVia } from './PopupList'
import type { ComposerPopup } from './utils'

export type LocalCommandName = 'new' | 'clear' | 'mode' | 'model' | 'help'

export type SlashItem =
  | { kind: 'local'; name: LocalCommandName; description: string; argumentHint?: string; positions: number[] }
  | { kind: 'command'; name: string; description: string; argumentHint?: string; atom: boolean; positions: number[] }
  | { kind: 'mode-arg'; mode: AgentModeDefinition; current: boolean; positions: number[] }
  | { kind: 'model-arg'; model: ModelOption; current: boolean; positions: number[] }

export const LOCAL_COMMANDS: { name: LocalCommandName; description: string; argumentHint?: string }[] = [
  { name: 'new', description: 'Start a new chat' },
  { name: 'clear', description: 'Clear the conversation (opens a fresh chat)' },
  { name: 'mode', description: 'Switch the agent mode', argumentHint: '<mode>' },
  { name: 'model', description: 'Switch the model for this chat', argumentHint: '<model>' },
  { name: 'help', description: 'Show keyboard shortcuts and commands' }
]

/** Shown until the CLI reports its commands (before the first message of a session). */
const BUILTIN_FALLBACK: SlashCommandInfo[] = [
  { name: 'compact', description: 'Summarize the conversation to free up context', argumentHint: '<instructions>', builtin: true },
  { name: 'init', description: 'Create a CLAUDE.md with documentation for this codebase', argumentHint: '', builtin: true }
]

function rank(item: SlashItem): number {
  if (item.kind === 'command') return item.atom ? 0 : 2
  return 1
}

interface SlashMenuProps {
  chatId: string
  popup: Extract<ComposerPopup, { kind: 'slash' | 'slash-arg' }>
  anchor: PopupAnchor
  handleRef: RefObject<PopupMenuHandle | null>
  onSelect(item: SlashItem, via: PopupSelectVia): void
  onClose(): void
}

/** "/" menu: ATOM bundled commands & skills, local commands, SDK commands; argument completion for /mode and /model. */
export function SlashMenu({ chatId, popup, anchor, handleRef, onSelect, onClose }: SlashMenuProps) {
  const sdkCommands = useAgentStore((s) => s.chats[chatId]?.capabilities?.commands)
  const modeId = useAgentStore((s) => s.chats[chatId]?.modeId ?? '')
  const model = useAgentStore((s) => s.chats[chatId]?.model ?? '')
  const modes = useAgentModes()
  const models = useAvailableModels(chatId)
  const library = useLibraryStore((s) => s.index)
  const libraryLoading = useLibraryStore((s) => s.loading)
  const needsFallback = !sdkCommands?.length

  useEffect(() => {
    if (needsFallback && !library && !libraryLoading) void useLibraryStore.getState().refresh()
  }, [needsFallback, library, libraryLoading])

  const commands = useMemo<SlashCommandInfo[]>(() => {
    if (sdkCommands?.length) return sdkCommands
    const out: SlashCommandInfo[] = [...BUILTIN_FALLBACK]
    for (const c of library?.commands ?? []) out.push({ name: c.qualifiedName, description: c.description, argumentHint: c.argumentHint ?? '' })
    for (const s of library?.skills ?? []) if (s.enabled) out.push({ name: s.qualifiedName, description: s.description, argumentHint: '' })
    return out
  }, [sdkCommands, library])

  const items = useMemo<SlashItem[]>(() => {
    const q = popup.query.trim()
    if (popup.kind === 'slash-arg') {
      const out: { item: SlashItem; score: number }[] = []
      const match = (...texts: string[]): { score: number; positions: number[] } | null => {
        if (!q) return { score: 0, positions: [] }
        const [display, ...aliases] = texts
        const shown = fuzzyScore(q, display)
        const best = [shown, ...aliases.map((t) => fuzzyScore(q, t))].reduce<number | null>((acc, r) => (r && (acc === null || r.score > acc) ? r.score : acc), null)
        return best === null ? null : { score: best, positions: shown?.positions ?? [] }
      }
      if (popup.command === 'mode') {
        for (const m of modes) {
          const r = match(m.name, m.id)
          if (r) out.push({ score: r.score, item: { kind: 'mode-arg', mode: m, current: m.id === modeId, positions: r.positions } })
        }
      } else {
        for (const m of models) {
          const r = match(m.label, m.value || 'default')
          if (r) out.push({ score: r.score, item: { kind: 'model-arg', model: m, current: normalizeModelValue(m.value) === model, positions: r.positions } })
        }
      }
      return q ? out.sort((a, b) => b.score - a.score).map((x) => x.item) : out.map((x) => x.item)
    }

    const seen = new Set<string>()
    const all: SlashItem[] = []
    for (const c of commands) {
      if (seen.has(c.name)) continue
      seen.add(c.name)
      all.push({ kind: 'command', name: c.name, description: c.description, argumentHint: c.argumentHint || undefined, atom: c.name.startsWith('atom:'), positions: [] })
    }
    for (const l of LOCAL_COMMANDS) {
      if (seen.has(l.name)) continue
      all.push({ kind: 'local', ...l, positions: [] })
    }

    if (!q) return all.map((item, i) => ({ item, i })).sort((a, b) => rank(a.item) - rank(b.item) || a.i - b.i).map((x) => x.item)

    const scored: { item: SlashItem; score: number }[] = []
    for (const item of all) {
      if (item.kind !== 'local' && item.kind !== 'command') continue
      const byName = fuzzyScore(q, item.name)
      if (byName) {
        scored.push({ item: { ...item, positions: byName.positions }, score: byName.score + (item.name.startsWith(q) ? 40 : 0) + (rank(item) === 0 ? 2 : 0) })
      } else if (q.length >= 3 && item.description.toLowerCase().includes(q.toLowerCase())) {
        scored.push({ item, score: -50 })
      }
    }
    return scored.sort((a, b) => b.score - a.score).map((x) => x.item)
  }, [popup, commands, modes, models, modeId, model])

  const sectionOf = (item: SlashItem): string | undefined => {
    if (popup.kind === 'slash-arg') return popup.command === 'mode' ? 'Modes' : 'Models'
    if (popup.query.trim()) return undefined
    if (item.kind === 'local') return 'ATOM Code'
    if (item.kind === 'command') return item.atom ? 'ATOM skills & commands' : 'Commands & skills'
    return undefined
  }

  return (
    <PopupList
      ariaLabel="Commands"
      anchor={anchor}
      items={items}
      handleRef={handleRef}
      onClose={onClose}
      onSelect={onSelect}
      sectionOf={sectionOf}
      getKey={(item) =>
        item.kind === 'mode-arg' ? `mode:${item.mode.id}` : item.kind === 'model-arg' ? `model:${item.model.value}` : `${item.kind}:${item.name}`
      }
      renderItem={(item) => {
        if (item.kind === 'mode-arg') {
          return (
            <>
              <ModeIcon name={item.mode.icon} size={14} style={{ color: item.mode.color }} className="shrink-0" />
              <Name text={item.mode.name} positions={item.positions} />
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-subtle">{item.mode.description}</span>
              {item.current && <Check size={13} className="shrink-0 text-accent" />}
            </>
          )
        }
        if (item.kind === 'model-arg') {
          return (
            <>
              <Name text={item.model.label} positions={item.positions} />
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-subtle">{item.model.description}</span>
              {item.current && <Check size={13} className="shrink-0 text-accent" />}
            </>
          )
        }
        return (
          <>
            <span className="shrink-0 font-mono text-[12px]">
              <span className="text-subtle">/</span>
              <Name text={item.name} positions={item.positions} className={cn(item.kind === 'command' && item.atom && 'text-accent-2')} />
            </span>
            {item.argumentHint && <span className="max-w-[30%] shrink-0 truncate font-mono text-[11px] text-subtle">{item.argumentHint}</span>}
            <span className="min-w-0 flex-1 truncate text-right text-[11.5px] text-subtle">{item.description}</span>
          </>
        )
      }}
      empty={<div className="px-2.5 py-3 text-[12px] text-muted">{popup.kind === 'slash-arg' ? `No ${popup.command === 'mode' ? 'mode' : 'model'} matches “${popup.query}”` : 'No matching commands — press ↩ to send as a message'}</div>}
      footer={
        <>
          <span>↩ {popup.kind === 'slash-arg' ? 'select' : 'run'}</span>
          <span>⇥ complete</span>
          <span>Esc close</span>
        </>
      }
    />
  )
}

function Name({ text, positions, className }: { text: string; positions: number[]; className?: string }) {
  return (
    <span className={cn('shrink-0', className)}>
      {highlightSegments(text, positions).map((seg, i) => (
        <span key={i} className={cn(seg.match && 'font-semibold text-accent')}>
          {seg.text}
        </span>
      ))}
    </span>
  )
}
