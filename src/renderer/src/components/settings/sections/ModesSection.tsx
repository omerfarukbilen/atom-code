import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, Copy, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import type { AgentModeDefinition, EffortLevel } from '@shared/types'
import { BUILTIN_MODES, EFFORT_LEVELS, READ_ONLY_TOOLS } from '@shared/modes'
import { Badge, Button, IconButton, Input, Modal, SegmentedControl, Select, Textarea, Toggle, confirmDialog } from '../../ui'
import { useSettingsStore } from '../../../stores/settings'
import { useLibraryStore } from '../../../stores/library'
import { toast } from '../../../stores/toast'
import { cn } from '../../../lib/cn'
import { ChipsInput, Searchable, SectionHeader, SettingGroup, matchesQuery, useFocusOnMount, useSettingsQuery } from '../controls'
import { MODE_COLOR_PRESETS, MODE_ICONS, MODE_ICON_NAMES, ModeBadgeIcon } from '../mode-icons'
import { ModelSelect } from './AgentSection'

const TOOL_SUGGESTIONS = [
  'Read',
  'Write',
  'Edit',
  'NotebookEdit',
  'Bash',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
  'Agent',
  'Skill',
  'AskUserQuestion',
  ...READ_ONLY_TOOLS.filter((t) => t.startsWith('mcp__'))
]

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'mode'
  )
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

interface Draft {
  mode: AgentModeDefinition
  isNew: boolean
}

function blankMode(): AgentModeDefinition {
  return {
    id: '',
    name: '',
    description: '',
    icon: 'Sparkles',
    color: MODE_COLOR_PRESETS[0],
    forcedPermissionMode: null,
    readOnly: false,
    tools: [],
    disallowedTools: [],
    systemPrompt: '',
    model: '',
    skills: []
  }
}

export function ModesSection() {
  const customModes = useSettingsStore((s) => s.settings.customModes)
  const update = useSettingsStore((s) => s.update)
  const [draft, setDraft] = useState<Draft | null>(null)
  const query = useSettingsQuery()
  // Stable identity: Modal re-runs its focus handling whenever onClose changes.
  const closeEditor = useCallback(() => setDraft(null), [])

  const save = (mode: AgentModeDefinition, isNew: boolean, originalId?: string): void => {
    const next = isNew ? [...customModes, mode] : customModes.map((m) => (m.id === originalId ? mode : m))
    void update({ customModes: next })
    toast.success(isNew ? `Mode “${mode.name}” created` : `Mode “${mode.name}” saved`)
    setDraft(null)
  }

  const remove = async (mode: AgentModeDefinition): Promise<void> => {
    const ok = await confirmDialog({
      title: `Delete mode “${mode.name}”?`,
      message: 'Chats using this mode fall back to Agent mode.',
      confirmLabel: 'Delete mode',
      danger: true
    })
    if (!ok) return
    void update({ customModes: customModes.filter((m) => m.id !== mode.id) })
  }

  const duplicate = (mode: AgentModeDefinition): void => {
    const copy: AgentModeDefinition = {
      ...mode,
      id: '',
      name: `${mode.name} (custom)`,
      builtin: false,
      order: undefined,
      tools: mode.tools ? [...mode.tools] : [],
      disallowedTools: mode.disallowedTools ? [...mode.disallowedTools] : [],
      skills: mode.skills ? [...mode.skills] : []
    }
    setDraft({ mode: copy, isNew: true })
  }

  const visibleBuiltins = BUILTIN_MODES.filter((m) => matchesQuery(query, 'modes', m.name, m.description, m.id))
  const visibleCustom = customModes.filter((m) => matchesQuery(query, 'modes custom', m.name, m.description, m.id))

  return (
    <div>
      <SectionHeader
        title="Modes"
        description="A mode bundles a permission behaviour, a tool surface and extra instructions. Switch modes from the composer (Shift+Tab cycles)."
        actions={
          <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setDraft({ mode: blankMode(), isNew: true })}>
            New mode
          </Button>
        }
      />

      <SettingGroup title="Custom modes" flush>
        {visibleCustom.length === 0 ? (
          <Searchable terms="custom modes new mode create">
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-6 py-6 text-center">
              <div className="text-[13px] font-medium text-fg">No custom modes yet</div>
              <div className="max-w-[420px] text-[12px] leading-relaxed text-muted">
                Create a mode for a workflow you repeat — e.g. “Docs writer” with its own prompt, or a read-only “Explainer”. You can also duplicate a built-in mode below.
              </div>
              <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setDraft({ mode: blankMode(), isNew: true })}>
                Create a mode
              </Button>
            </div>
          </Searchable>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {visibleCustom.map((m) => (
              <div key={m.id} data-setting-row="">
                <ModeCard
                  mode={m}
                  actions={
                    <>
                      <IconButton title="Edit mode" icon={<Pencil size={13} />} onClick={() => setDraft({ mode: { ...m }, isNew: false })} />
                      <IconButton title="Duplicate mode" icon={<Copy size={13} />} onClick={() => duplicate(m)} />
                      <IconButton title="Delete mode" icon={<Trash2 size={13} />} className="hover:text-danger" onClick={() => void remove(m)} />
                    </>
                  }
                />
              </div>
            ))}
          </div>
        )}
      </SettingGroup>

      <SettingGroup title="Built-in modes" description="Read-only. Duplicate one to customise its prompt or tools." flush>
        <div className="grid grid-cols-1 gap-2">
          {visibleBuiltins.map((m) => (
            <div key={m.id} data-setting-row="">
              <ModeCard
                mode={m}
                actions={
                  <Button size="xs" variant="ghost" icon={<Copy size={12} />} onClick={() => duplicate(m)}>
                    Duplicate
                  </Button>
                }
              />
            </div>
          ))}
        </div>
      </SettingGroup>

      {draft && (
        <ModeEditorDialog
          draft={draft}
          existingIds={new Set([...BUILTIN_MODES.map((m) => m.id), ...customModes.map((m) => m.id)])}
          onCancel={closeEditor}
          onSave={save}
        />
      )}
    </div>
  )
}

function ModeCard({ mode, actions }: { mode: AgentModeDefinition; actions: ReactNode }) {
  const [open, setOpen] = useState(false)
  const toolsLabel = mode.tools && mode.tools.length > 0 ? `${mode.tools.length} tools` : mode.readOnly ? 'Read-only tools' : 'All tools'
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-elevated">
      <div className="flex items-start gap-3 px-3.5 py-3">
        <ModeBadgeIcon icon={mode.icon} color={mode.color} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13.5px] font-semibold text-fg">{mode.name}</span>
            <code className="font-mono text-[10.5px] text-subtle">{mode.id}</code>
            {mode.builtin && (
              <Badge>
                <Lock size={9} /> Built-in
              </Badge>
            )}
          </div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{mode.description || <span className="italic text-subtle">No description</span>}</div>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge tone={mode.forcedPermissionMode === 'plan' ? 'info' : 'neutral'}>{mode.forcedPermissionMode === 'plan' ? 'Plan permissions' : 'Inherits permissions'}</Badge>
            <Badge tone={mode.readOnly ? 'warning' : 'neutral'}>{toolsLabel}</Badge>
            {mode.disallowedTools && mode.disallowedTools.length > 0 && <Badge tone="danger">No {mode.disallowedTools.join(', ')}</Badge>}
            {mode.model && <Badge tone="accent">{mode.model}</Badge>}
            {mode.effort && <Badge tone="accent">effort: {mode.effort}</Badge>}
            {mode.skills?.map((s) => (
              <Badge key={s} tone="success">
                {s}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
      </div>
      {mode.systemPrompt && (
        <>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex w-full items-center gap-1.5 border-t border-line bg-panel px-3.5 py-1.5 text-left text-[11.5px] text-muted hover:text-fg"
          >
            <ChevronDown size={12} className={cn('transition-transform', !open && '-rotate-90')} />
            {open ? 'Hide instructions' : 'Show instructions'}
          </button>
          {open && (
            <pre className="selectable max-h-[240px] overflow-auto whitespace-pre-wrap border-t border-line bg-input px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed text-muted">
              {mode.systemPrompt}
            </pre>
          )}
        </>
      )}
    </div>
  )
}

function ModeEditorDialog({
  draft,
  existingIds,
  onCancel,
  onSave
}: {
  draft: Draft
  existingIds: Set<string>
  onCancel(): void
  onSave(mode: AgentModeDefinition, isNew: boolean, originalId?: string): void
}) {
  const [mode, setMode] = useState<AgentModeDefinition>(draft.mode)
  const nameRef = useFocusOnMount<HTMLInputElement>()
  const libraryIndex = useLibraryStore((s) => s.index)
  const refreshLibrary = useLibraryStore((s) => s.refresh)

  useEffect(() => {
    if (!libraryIndex) void refreshLibrary()
  }, [libraryIndex, refreshLibrary])

  const set = (patch: Partial<AgentModeDefinition>): void => setMode((m) => ({ ...m, ...patch }))
  const taken = useMemo(() => {
    const ids = new Set(existingIds)
    if (!draft.isNew) ids.delete(draft.mode.id)
    return ids
  }, [existingIds, draft])
  const id = draft.isNew ? uniqueId(slugify(mode.name), taken) : draft.mode.id
  const nameError = !mode.name.trim() ? 'Give the mode a name.' : null
  const skillSuggestions = (libraryIndex?.skills ?? []).map((s) => s.qualifiedName)

  const submit = (): void => {
    if (nameError) return
    const clean: AgentModeDefinition = {
      ...mode,
      id,
      name: mode.name.trim(),
      description: mode.description.trim(),
      builtin: false,
      tools: mode.tools && mode.tools.length > 0 ? mode.tools : undefined,
      disallowedTools: mode.disallowedTools && mode.disallowedTools.length > 0 ? mode.disallowedTools : undefined,
      skills: mode.skills && mode.skills.length > 0 ? mode.skills : undefined,
      model: mode.model || undefined,
      effort: mode.effort || undefined,
      forcedPermissionMode: mode.forcedPermissionMode ?? null
    }
    onSave(clean, draft.isNew, draft.mode.id)
  }

  return (
    <Modal
      open
      onClose={onCancel}
      width="max-w-2xl"
      title={draft.isNew ? 'New mode' : `Edit “${draft.mode.name}”`}
      description="Modes apply to chats when selected in the composer. Changes take effect for the next message."
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!!nameError} onClick={submit}>
            {draft.isNew ? 'Create mode' : 'Save mode'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 px-5 py-4">
        {/* Live preview */}
        <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5">
          <ModeBadgeIcon icon={mode.icon} color={mode.color} size={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold text-fg">{mode.name.trim() || 'Untitled mode'}</div>
            <div className="truncate text-[12px] text-muted">{mode.description.trim() || 'One-line description shown in the mode picker'}</div>
          </div>
          <code className="font-mono text-[11px] text-subtle">id: {id}</code>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Name">
            <Input ref={nameRef} inputSize="sm" placeholder="e.g. Docs writer" value={mode.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Input inputSize="sm" placeholder="What this mode is for" value={mode.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </div>

        <Field label="Icon">
          <div className="grid grid-cols-8 gap-1 sm:grid-cols-[repeat(16,minmax(0,1fr))]">
            {MODE_ICON_NAMES.map((name) => {
              const Icon = MODE_ICONS[name]
              const selected = mode.icon === name
              return (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => set({ icon: name })}
                  className={cn(
                    'flex aspect-square items-center justify-center rounded-md border transition-colors',
                    selected ? 'border-transparent' : 'border-transparent text-muted hover:bg-hover hover:text-fg'
                  )}
                  style={selected ? { color: mode.color, background: `color-mix(in srgb, ${mode.color} 18%, transparent)`, borderColor: mode.color } : undefined}
                >
                  <Icon size={15} />
                </button>
              )
            })}
          </div>
        </Field>

        <Field label="Color">
          <div className="flex flex-wrap items-center gap-1.5">
            {MODE_COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => set({ color: c })}
                className={cn('h-6 w-6 rounded-full border-2 transition-transform hover:scale-110', mode.color === c ? 'border-fg' : 'border-transparent')}
                style={{ background: c }}
              />
            ))}
            <label title="Custom color" className="relative ml-1 flex h-6 items-center gap-1.5 rounded-md border border-line bg-input px-1.5 text-[11px] text-muted">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(mode.color) ? mode.color : MODE_COLOR_PRESETS[0]} onChange={(e) => set({ color: e.target.value })} className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0" />
              Custom
            </label>
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Permissions" hint="Plan forces plan mode: the agent researches read-only and asks you to approve a plan.">
            <SegmentedControl
              size="sm"
              value={mode.forcedPermissionMode === 'plan' ? 'plan' : 'inherit'}
              options={[
                { value: 'inherit', label: 'Inherit chat policy' },
                { value: 'plan', label: 'Plan' }
              ]}
              onChange={(v) => set({ forcedPermissionMode: v === 'plan' ? 'plan' : null })}
            />
          </Field>
          <Field label="Read-only" hint="Only non-mutating tools (Read, Grep, Glob, Web…) unless a tool allowlist is set.">
            <Toggle checked={!!mode.readOnly} onChange={(v) => set({ readOnly: v })} title="Read-only" />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Tools allowlist" hint="Empty = all tools. Overrides read-only when set.">
            <ChipsInput values={mode.tools ?? []} onChange={(v) => set({ tools: v })} suggestions={TOOL_SUGGESTIONS} placeholder="Read, Grep, Bash…" tone="accent" />
          </Field>
          <Field label="Disallowed tools" hint="Never available in this mode.">
            <ChipsInput values={mode.disallowedTools ?? []} onChange={(v) => set({ disallowedTools: v })} suggestions={TOOL_SUGGESTIONS} placeholder="Edit, Write…" tone="danger" />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Model">
            <ModelSelect value={mode.model ?? ''} onChange={(v) => set({ model: v })} defaultLabel="Keep the chat's model" />
          </Field>
          <Field label="Effort">
            <Select
              selectSize="sm"
              className="w-[200px]"
              value={mode.effort ?? ''}
              options={[{ value: '', label: "Keep the chat's effort" }, ...EFFORT_LEVELS.filter((e) => e.id !== 'auto').map((e) => ({ value: e.id, label: e.label }))]}
              onChange={(v) => set({ effort: v ? (v as EffortLevel) : undefined })}
            />
          </Field>
        </div>

        <Field label="Recommended skills" hint="Mentioned to the agent as hints while this mode is active.">
          <ChipsInput values={mode.skills ?? []} onChange={(v) => set({ skills: v })} suggestions={skillSuggestions} placeholder="atom:code-review…" />
        </Field>

        <Field label="Instructions" hint="Appended to ATOM's system prompt while this mode is active. Be specific about the process and the output format.">
          <Textarea
            rows={10}
            className="font-mono text-[12px] leading-relaxed"
            value={mode.systemPrompt}
            onChange={(e) => set({ systemPrompt: e.target.value })}
            placeholder={'You are in DOCS mode.\n1. Read the code you are documenting first.\n2. …'}
          />
        </Field>
      </div>
    </Modal>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="text-[12px] font-medium text-fg">{label}</div>
      {children}
      {hint && <div className="text-[11px] leading-relaxed text-subtle">{hint}</div>}
    </div>
  )
}
