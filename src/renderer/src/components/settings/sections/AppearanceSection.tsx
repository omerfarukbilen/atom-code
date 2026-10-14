import { Check } from 'lucide-react'
import type { ThemeId } from '@shared/types'
import { SegmentedControl } from '../../ui'
import { useSettingsStore } from '../../../stores/settings'
import { cn } from '../../../lib/cn'
import { SectionHeader, SettingGroup, SettingRow, Searchable } from '../controls'

const THEMES: { id: ThemeId; name: string; description: string }[] = [
  { id: 'atom-dark', name: 'ATOM Dark', description: 'Calm graphite with an indigo accent' },
  { id: 'atom-midnight', name: 'Midnight', description: 'Deep navy with a teal accent' },
  { id: 'atom-light', name: 'Light', description: 'Bright and crisp for daylight' }
]

/** Miniature workbench rendered with the theme's own tokens (data-theme scopes the CSS variables). */
function ThemePreview({ id }: { id: ThemeId }) {
  return (
    <div data-theme={id} className="flex h-[118px] flex-col overflow-hidden rounded-md border border-line bg-app text-fg">
      <div className="flex h-3.5 shrink-0 items-center gap-1 border-b border-line bg-titlebar px-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />
        <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />
        <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />
        <span className="mx-auto h-1.5 w-12 rounded-full bg-input" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-4 shrink-0 flex-col items-center gap-1.5 border-r border-line bg-sidebar pt-1.5">
          <span className="h-1.5 w-1.5 rounded-sm bg-accent" />
          <span className="h-1.5 w-1.5 rounded-sm bg-subtle" />
          <span className="h-1.5 w-1.5 rounded-sm bg-subtle" />
        </div>
        <div className="w-14 shrink-0 space-y-1 border-r border-line bg-sidebar p-1.5">
          <div className="h-1 w-8 rounded-full bg-subtle" />
          <div className="h-1.5 w-full rounded-sm bg-active" />
          <div className="h-1 w-9 rounded-full bg-muted/50" />
          <div className="h-1 w-7 rounded-full bg-muted/50" />
          <div className="h-1 w-10 rounded-full bg-muted/50" />
        </div>
        <div className="min-w-0 flex-1 space-y-1 bg-app p-2">
          <div className="flex gap-1">
            <span className="h-1 w-4 rounded-full bg-accent" />
            <span className="h-1 w-6 rounded-full bg-accent-2" />
            <span className="h-1 w-3 rounded-full bg-fg/60" />
          </div>
          <div className="flex gap-1 pl-2">
            <span className="h-1 w-5 rounded-full bg-fg/60" />
            <span className="h-1 w-8 rounded-full bg-success" />
          </div>
          <div className="flex gap-1 pl-2">
            <span className="h-1 w-3 rounded-full bg-warning" />
            <span className="h-1 w-6 rounded-full bg-fg/60" />
          </div>
          <div className="rounded-sm bg-diff-add py-0.5 pl-2">
            <span className="block h-1 w-9 rounded-full bg-success/70" />
          </div>
          <div className="flex gap-1">
            <span className="h-1 w-2 rounded-full bg-subtle" />
            <span className="h-1 w-10 rounded-full bg-subtle" />
          </div>
        </div>
        <div className="flex w-[70px] shrink-0 flex-col gap-1 border-l border-line bg-panel p-1.5">
          <div className="ml-auto h-3 w-11 rounded bg-accent-soft" />
          <div className="h-1 w-12 rounded-full bg-muted/50" />
          <div className="h-1 w-9 rounded-full bg-muted/50" />
          <div className="rounded border border-line bg-elevated p-1">
            <div className="h-1 w-7 rounded-full bg-success" />
          </div>
          <div className="mt-auto flex h-3.5 items-center justify-end rounded border border-line bg-input px-0.5">
            <span className="h-2 w-2 rounded-sm bg-accent" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function AppearanceSection() {
  const theme = useSettingsStore((s) => s.settings.theme)
  const uiFontSize = useSettingsStore((s) => s.settings.uiFontSize)
  const language = useSettingsStore((s) => s.settings.language)
  const update = useSettingsStore((s) => s.update)

  return (
    <div>
      <SectionHeader title="Appearance" description="Themes apply to the whole workbench — editor, terminal and agent panel." />

      <SettingGroup title="Theme" flush>
        <Searchable terms="theme color scheme dark light midnight appearance">
          <div role="radiogroup" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {THEMES.map((t) => {
              const selected = t.id === theme
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => void update({ theme: t.id })}
                  className={cn(
                    'group flex flex-col gap-2 rounded-lg border p-2 text-left transition-all duration-150',
                    selected ? 'border-accent bg-accent-soft shadow-glow' : 'border-line bg-elevated hover:border-line-strong'
                  )}
                >
                  <ThemePreview id={t.id} />
                  <div className="flex items-center gap-2 px-0.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium text-fg">{t.name}</div>
                      <div className="truncate text-[11px] text-muted">{t.description}</div>
                    </div>
                    {selected && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-fg">
                        <Check size={10} strokeWidth={3} />
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </Searchable>
      </SettingGroup>

      <SettingGroup title="Interface">
        <SettingRow label="UI font size" keywords="font size zoom scale interface text" description="Base size for menus, panels and the agent chat.">
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-subtle">A</span>
            <input
              type="range"
              min={11}
              max={16}
              step={1}
              value={uiFontSize}
              onChange={(e) => void update({ uiFontSize: Number(e.target.value) })}
              className="w-44 accent-accent"
              title={`${uiFontSize}px`}
            />
            <span className="text-[15px] text-subtle">A</span>
            <span className="w-10 text-right font-mono text-[12px] text-fg">{uiFontSize}px</span>
          </div>
        </SettingRow>
        <SettingRow label="Language" keywords="language locale english turkish türkçe translation" description="Interface translations are coming soon — your choice is saved for when they land.">
          <SegmentedControl
            size="sm"
            value={language}
            options={[
              { value: 'en', label: 'English' },
              { value: 'tr', label: 'Türkçe' }
            ]}
            onChange={(v) => void update({ language: v })}
          />
        </SettingRow>
      </SettingGroup>
    </div>
  )
}
