import { useMemo } from 'react'
import { ChevronDown, Settings2 } from 'lucide-react'
import { formatKeybinding } from '../../../lib/platform'
import { useAgentModes, useAgentStore } from '../../../stores/agent'
import { useLayoutStore } from '../../../stores/layout'
import { ModeIcon } from '../../settings/mode-icons'
import { Kbd, Menu, type MenuEntry } from '../../ui'
import { useAnchoredMenu, usePickerRequest } from './useAnchoredMenu'

/** Mode chip (icon + name in the mode color) with a menu of all modes. ⌘. opens it, Shift+Tab cycles. */
export function ModePicker({ chatId }: { chatId: string }) {
  const modeId = useAgentStore((s) => s.chats[chatId]?.modeId ?? '')
  const modes = useAgentModes()
  const mode = useMemo(() => modes.find((m) => m.id === modeId) ?? modes[0], [modes, modeId])
  const menu = useAnchoredMenu('top-start')
  usePickerRequest('mode', menu.openMenu)

  const entries: MenuEntry[] = [
    {
      type: 'header',
      id: 'h',
      label: (
        <span className="flex items-center justify-between gap-3">
          <span>Mode</span>
          <span className="flex items-center gap-1 font-normal normal-case tracking-normal">
            <Kbd keys="shift+tab" /> to cycle
          </span>
        </span>
      )
    },
    ...modes.map<MenuEntry>((m) => ({
      id: m.id,
      label: m.name,
      description: m.description,
      icon: <ModeIcon name={m.icon} size={14} style={{ color: m.color }} />,
      checked: m.id === mode.id,
      onSelect: () => useAgentStore.getState().setMode(m.id, chatId)
    })),
    { type: 'separator', id: 's' },
    { id: 'manage', label: 'Manage modes…', icon: <Settings2 size={13} />, onSelect: () => useLayoutStore.getState().openSettings('modes') }
  ]

  return (
    <>
      <button
        ref={menu.anchorRef}
        type="button"
        title={`${mode.name} mode — ${mode.description}\n${formatKeybinding('mod+.')} to choose · ${formatKeybinding('shift+tab')} to cycle`}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={menu.toggle}
        className="flex h-6 min-w-0 max-w-[140px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium transition-[filter] duration-100 hover:brightness-125"
        style={{ color: mode.color, background: `color-mix(in srgb, ${mode.color} ${menu.open ? 20 : 12}%, transparent)` }}
      >
        <ModeIcon name={mode.icon} size={13} className="shrink-0" />
        <span className="truncate">{mode.name}</span>
        <ChevronDown size={11} className="shrink-0 opacity-70" />
      </button>
      <Menu {...menu.props} entries={entries} minWidth={290} className="max-w-[340px]" />
    </>
  )
}
