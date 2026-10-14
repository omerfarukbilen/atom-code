import { Gauge } from 'lucide-react'
import type { EffortLevel } from '@shared/types'
import { EFFORT_LEVELS } from '@shared/modes'
import { cn } from '../../../lib/cn'
import { useAgentStore } from '../../../stores/agent'
import { Menu, type MenuEntry } from '../../ui'
import { useCurrentModel } from './ModelPicker'
import { useAnchoredMenu, usePickerRequest } from './useAnchoredMenu'

const EFFORT_HINTS: Record<EffortLevel | 'auto', string> = {
  auto: 'The model decides how much to think',
  low: 'Fastest — minimal reasoning',
  medium: 'Balanced speed and depth',
  high: 'Thorough reasoning for harder tasks',
  xhigh: 'Extra thorough — slower',
  max: 'Maximum reasoning — slowest, most tokens'
}

const SHORT_LABEL: Record<EffortLevel | 'auto', string> = { auto: 'Auto', low: 'Low', medium: 'Med', high: 'High', xhigh: 'XHigh', max: 'Max' }

/** Tiny 4-bar gauge showing the effort level next to the icon. */
function EffortBars({ effort }: { effort: EffortLevel | 'auto' }) {
  const level = { auto: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }[effort]
  return (
    <span className="flex h-3 items-end gap-[1.5px]" aria-hidden>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn('w-[2px] rounded-full', i <= level ? (effort === 'max' ? 'bg-warning' : 'bg-accent') : 'bg-line-strong')} style={{ height: 3 + i * 2 }} />
      ))}
    </span>
  )
}

/** Reasoning-effort picker — only rendered when the chat's model supports effort. */
export function EffortPicker({ chatId }: { chatId: string }) {
  const effort = useAgentStore((s) => s.chats[chatId]?.effort ?? 'auto')
  const model = useCurrentModel(chatId)
  const menu = useAnchoredMenu('top-start')
  const supported = !!model.supportsEffort
  usePickerRequest('effort', menu.openMenu, supported)

  if (!supported) return null
  const levels = EFFORT_LEVELS.filter((l) => l.id === 'auto' || !model.supportedEffortLevels?.length || model.supportedEffortLevels.includes(l.id))
  const label = EFFORT_LEVELS.find((l) => l.id === effort)?.label ?? 'Auto'

  const entries: MenuEntry[] = [
    { type: 'header', id: 'h', label: 'Reasoning effort' },
    ...levels.map<MenuEntry>((l) => ({
      id: l.id,
      label: l.label,
      description: EFFORT_HINTS[l.id],
      icon: <EffortBars effort={l.id} />,
      checked: l.id === effort,
      onSelect: () => useAgentStore.getState().setEffort(l.id, chatId)
    }))
  ]

  return (
    <>
      <button
        ref={menu.anchorRef}
        type="button"
        title={`Reasoning effort: ${label} — ${EFFORT_HINTS[effort]}`}
        aria-label={`Reasoning effort: ${label}`}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={menu.toggle}
        className={cn(
          'flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-muted transition-colors duration-100 hover:bg-hover hover:text-fg',
          menu.open && 'bg-active text-fg'
        )}
      >
        {effort === 'auto' ? <Gauge size={13} /> : <EffortBars effort={effort} />}
        <span className="hidden @md:inline">{SHORT_LABEL[effort]}</span>
      </button>
      <Menu {...menu.props} entries={entries} minWidth={250} />
    </>
  )
}
