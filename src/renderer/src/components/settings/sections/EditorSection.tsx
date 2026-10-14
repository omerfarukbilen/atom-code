import type { DeepPartial, EditorSettings, TerminalSettings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { SegmentedControl, Select } from '../../ui'
import { useSettingsStore } from '../../../stores/settings'
import { ListEditor, NumberField, SectionHeader, SettingGroup, SettingRow, TextField, ToggleRow } from '../controls'

function FontPreview({ fontFamily, fontSize }: { fontFamily: string; fontSize: number }) {
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-line bg-input px-3 py-2 text-fg" style={{ fontFamily, fontSize }}>
      <span className="text-accent">const</span> <span className="text-accent-2">atom</span> = <span className="text-success">'Hello, ATOM'</span>{' '}
      <span className="text-subtle">{'// 0O1lI {} => !== ->'}</span>
    </div>
  )
}

export function EditorSection() {
  const editor = useSettingsStore((s) => s.settings.editor)
  const filesExclude = useSettingsStore((s) => s.settings.filesExclude)
  const update = useSettingsStore((s) => s.update)
  const set = (patch: DeepPartial<EditorSettings>): void => void update({ editor: patch })

  return (
    <div>
      <SectionHeader title="Editor" description="Monaco editor preferences. Changes apply immediately to every open editor." />

      <SettingGroup title="Text">
        <SettingRow label="Font size" keywords="font size zoom text" description="Editor font size in pixels.">
          <NumberField value={editor.fontSize} min={8} max={40} suffix="px" onCommit={(v) => set({ fontSize: v })} />
        </SettingRow>
        <SettingRow label="Font family" keywords="font family typeface ligatures monospace" description="A CSS font stack. JetBrains Mono ships with ATOM." stacked>
          <TextField mono value={editor.fontFamily} placeholder={DEFAULT_SETTINGS.editor.fontFamily} onCommit={(v) => set({ fontFamily: v.trim() || DEFAULT_SETTINGS.editor.fontFamily })} />
          <FontPreview fontFamily={editor.fontFamily} fontSize={editor.fontSize} />
        </SettingRow>
        <ToggleRow label="Word wrap" keywords="wrap lines" description="Wrap long lines at the viewport width." checked={editor.wordWrap} onChange={(v) => set({ wordWrap: v })} />
        <ToggleRow label="Line numbers" keywords="gutter numbers" checked={editor.lineNumbers} onChange={(v) => set({ lineNumbers: v })} />
        <ToggleRow label="Minimap" keywords="minimap overview" description="Show a code overview on the right edge." checked={editor.minimap} onChange={(v) => set({ minimap: v })} />
        <ToggleRow
          label="Bracket pair colorization"
          keywords="brackets colors"
          checked={editor.bracketPairColorization}
          onChange={(v) => set({ bracketPairColorization: v })}
        />
        <ToggleRow
          label="Sticky scroll"
          keywords="sticky scroll scope header"
          description="Keep the enclosing function / class header visible while scrolling."
          checked={editor.stickyScroll}
          onChange={(v) => set({ stickyScroll: v })}
        />
      </SettingGroup>

      <SettingGroup title="Indentation">
        <SettingRow label="Tab size" keywords="tab size indent width spaces">
          <SegmentedControl
            size="sm"
            value={String(editor.tabSize)}
            options={['2', '4', '8'].map((v) => ({ value: v, label: v }))}
            onChange={(v) => set({ tabSize: Number(v) })}
          />
        </SettingRow>
        <ToggleRow label="Insert spaces" keywords="tabs spaces indent" description="Press Tab to insert spaces instead of a tab character." checked={editor.insertSpaces} onChange={(v) => set({ insertSpaces: v })} />
      </SettingGroup>

      <SettingGroup title="Saving">
        <SettingRow label="Auto save" keywords="autosave save automatically delay focus">
          <Select
            selectSize="sm"
            className="w-[200px]"
            value={editor.autoSave}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'afterDelay', label: 'After a delay' },
              { value: 'onFocusChange', label: 'When focus changes' }
            ]}
            onChange={(v) => set({ autoSave: v })}
          />
        </SettingRow>
        {editor.autoSave === 'afterDelay' && (
          <SettingRow label="Auto save delay" keywords="autosave delay milliseconds">
            <NumberField value={editor.autoSaveDelayMs} min={100} max={60000} step={100} suffix="ms" width="w-28" onCommit={(v) => set({ autoSaveDelayMs: v })} />
          </SettingRow>
        )}
        <ToggleRow label="Format on save" keywords="format prettier save" description="Run the language formatter when saving a file." checked={editor.formatOnSave} onChange={(v) => set({ formatOnSave: v })} />
      </SettingGroup>

      <SettingGroup title="Files">
        <SettingRow
          label="Excluded files"
          keywords="exclude hide files explorer quick open node_modules"
          description="Names hidden from the explorer and quick open. The agent can still read them."
          stacked
        >
          <ListEditor
            items={filesExclude}
            onChange={(items) => void update({ filesExclude: items })}
            placeholder="e.g. coverage"
            examples={[{ value: 'coverage' }, { value: '.turbo' }, { value: 'build' }].filter((e) => !filesExclude.includes(e.value))}
          />
        </SettingRow>
      </SettingGroup>
    </div>
  )
}

export function TerminalSection() {
  const terminal = useSettingsStore((s) => s.settings.terminal)
  const update = useSettingsStore((s) => s.update)
  const set = (patch: DeepPartial<TerminalSettings>): void => void update({ terminal: patch })

  return (
    <div>
      <SectionHeader title="Terminal" description="Integrated terminal preferences. Shell changes apply to new terminals." />
      <SettingGroup title="Terminal">
        <SettingRow label="Shell" keywords="shell bash zsh powershell fish executable" description="Leave empty to use your OS default shell ($SHELL / PowerShell).">
          <TextField className="w-[260px]" mono placeholder="OS default" value={terminal.shell} onCommit={(v) => set({ shell: v.trim() })} />
        </SettingRow>
        <SettingRow label="Font size" keywords="terminal font size">
          <NumberField value={terminal.fontSize} min={8} max={32} suffix="px" onCommit={(v) => set({ fontSize: v })} />
        </SettingRow>
        <SettingRow label="Font family" keywords="terminal font family monospace" stacked>
          <TextField mono value={terminal.fontFamily} placeholder={DEFAULT_SETTINGS.terminal.fontFamily} onCommit={(v) => set({ fontFamily: v.trim() || DEFAULT_SETTINGS.terminal.fontFamily })} />
          <FontPreview fontFamily={terminal.fontFamily} fontSize={terminal.fontSize} />
        </SettingRow>
        <ToggleRow label="Cursor blink" keywords="cursor blink caret" checked={terminal.cursorBlink} onChange={(v) => set({ cursorBlink: v })} />
      </SettingGroup>
    </div>
  )
}
