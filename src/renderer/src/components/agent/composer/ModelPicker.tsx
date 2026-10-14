import { useMemo } from 'react'
import { ChevronDown, Settings2 } from 'lucide-react'
import type { ModelOption } from '@shared/types'
import { normalizeModelValue } from '@shared/modes'
import { cn } from '../../../lib/cn'
import { formatKeybinding } from '../../../lib/platform'
import { useAgentStore, useAvailableModels } from '../../../stores/agent'
import { useLayoutStore } from '../../../stores/layout'
import { Kbd, Menu, type MenuEntry } from '../../ui'
import { useAnchoredMenu, usePickerRequest } from './useAnchoredMenu'

/** The model option for a chat's model value (falls back to a synthetic entry for unknown ids). */
export function useCurrentModel(chatId: string): ModelOption {
  const model = useAgentStore((s) => s.chats[chatId]?.model ?? '')
  const models = useAvailableModels(chatId)
  return useMemo(
    () => models.find((m) => normalizeModelValue(m.value) === model) ?? (model ? { value: model, label: model } : (models[0] ?? { value: '', label: 'Default' })),
    [models, model]
  )
}

/** Model chip + menu (label and description per model). ⌘/ opens it. */
export function ModelPicker({ chatId }: { chatId: string }) {
  const models = useAvailableModels(chatId)
  const current = useCurrentModel(chatId)
  const menu = useAnchoredMenu('top-start')
  usePickerRequest('model', menu.openMenu)

  const entries: MenuEntry[] = [
    {
      type: 'header',
      id: 'h',
      label: (
        <span className="flex items-center justify-between gap-3">
          <span>Model</span>
          <span className="font-normal normal-case tracking-normal">
            <Kbd keys="mod+/" />
          </span>
        </span>
      )
    },
    ...models.map<MenuEntry>((m) => ({
      id: `model:${m.value}`,
      label: m.label,
      description: m.description,
      checked: normalizeModelValue(m.value) === normalizeModelValue(current.value),
      onSelect: () => useAgentStore.getState().setModel(m.value, chatId)
    })),
    { type: 'separator', id: 's' },
    { id: 'defaults', label: 'Default model for new chats…', icon: <Settings2 size={13} />, onSelect: () => useLayoutStore.getState().openSettings('agent') }
  ]

  return (
    <>
      <button
        ref={menu.anchorRef}
        type="button"
        title={`Model: ${current.label}${current.description ? ` — ${current.description}` : ''}\n${formatKeybinding('mod+/')} to switch`}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={menu.toggle}
        className={cn(
          'flex h-6 min-w-0 max-w-[130px] items-center gap-0.5 rounded-md px-1.5 text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-fg',
          menu.open && 'bg-active text-fg'
        )}
      >
        <span className="truncate">{current.label}</span>
        <ChevronDown size={11} className="shrink-0 opacity-70" />
      </button>
      <Menu {...menu.props} entries={entries} minWidth={260} className="max-w-[340px]" />
    </>
  )
}
