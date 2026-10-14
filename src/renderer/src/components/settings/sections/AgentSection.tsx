import { useState, type ReactNode } from 'react'
import { Box, FolderCog, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion, Zap } from 'lucide-react'
import type { AgentSettings, DeepPartial, PermissionPolicy } from '@shared/types'
import { EFFORT_LEVELS, FALLBACK_MODELS, PERMISSION_POLICIES, getAllModes } from '@shared/modes'
import { Badge, Button, SegmentedControl, Select, confirmDialog } from '../../ui'
import { useSettingsStore } from '../../../stores/settings'
import { useAuthStore } from '../../../stores/auth'
import { cn } from '../../../lib/cn'
import { NullableNumberField, OptionCard, SectionHeader, SettingGroup, SettingRow, TextField, ToggleRow } from '../controls'
import { ModeBadgeIcon } from '../mode-icons'

const CUSTOM = '__custom__'

const POLICY_ICONS: Record<PermissionPolicy, ReactNode> = {
  default: <ShieldCheck size={15} />,
  acceptEdits: <Zap size={15} />,
  auto: <ShieldQuestion size={15} />,
  bypassPermissions: <ShieldAlert size={15} />
}

/** Model select with the known aliases plus a free-form "Custom model id" option. */
export function ModelSelect({ value, onChange, defaultLabel }: { value: string; onChange(v: string): void; defaultLabel?: string }) {
  const known = FALLBACK_MODELS.some((m) => m.value === value)
  const [custom, setCustom] = useState(!known)
  const options = [
    ...FALLBACK_MODELS.map((m) => ({ value: m.value, label: m.value === '' && defaultLabel ? defaultLabel : `${m.label}${m.description ? ` — ${m.description}` : ''}` })),
    { value: CUSTOM, label: 'Custom model id…' }
  ]
  return (
    <div className="flex items-center gap-2">
      <Select
        selectSize="sm"
        className="w-[260px]"
        value={custom ? CUSTOM : value}
        options={options}
        onChange={(v) => {
          if (v === CUSTOM) {
            setCustom(true)
            return
          }
          setCustom(false)
          onChange(v)
        }}
      />
      {custom && <TextField className="w-[200px]" mono placeholder="e.g. claude-sonnet-4-5" value={known ? '' : value} onCommit={(v) => onChange(v.trim())} />}
    </div>
  )
}

export function AgentSection() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const status = useAuthStore((s) => s.status)
  const refreshAuth = useAuthStore((s) => s.refresh)
  const agent = settings.agent
  const modes = getAllModes(settings.customModes)
  const setAgent = (patch: DeepPartial<AgentSettings>): void => void update({ agent: patch })

  const choosePolicy = async (policy: PermissionPolicy): Promise<void> => {
    if (policy === agent.defaultPermission) return
    if (policy === 'bypassPermissions') {
      const ok = await confirmDialog({
        title: 'Enable Full auto (YOLO) by default?',
        message:
          'New chats will run every tool without asking — including shell commands that can delete files, push code or reach the network. Use this only in trusted, version-controlled projects. You can still switch individual chats back.',
        confirmLabel: 'Enable Full auto',
        danger: true
      })
      if (!ok) return
    }
    setAgent({ defaultPermission: policy })
  }

  return (
    <div>
      <SectionHeader title="Models & Agent" description="Defaults for new agent chats. Every chat can still change its model, effort, mode and permissions from the composer." />

      <SettingGroup title="Defaults for new chats">
        <SettingRow label="Default model" keywords="opus sonnet haiku fable model" description="'Default' lets Claude Code pick the recommended model for your plan.">
          <ModelSelect value={agent.defaultModel} onChange={(v) => setAgent({ defaultModel: v })} />
        </SettingRow>
        <SettingRow label="Default effort" keywords="thinking reasoning effort budget" description="How hard the model thinks before answering. Higher is slower but better on hard problems.">
          <SegmentedControl
            size="sm"
            value={agent.defaultEffort}
            options={EFFORT_LEVELS.map((e) => ({ value: e.id, label: e.label }))}
            onChange={(v) => setAgent({ defaultEffort: v })}
          />
        </SettingRow>
        <SettingRow label="Default mode" keywords="agent plan ask debug review tdd mode" description="The mode new chats start in. Cycle modes with Shift+Tab in the composer." stacked>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {modes.map((m) => {
              const selected = m.id === agent.defaultModeId
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAgent({ defaultModeId: m.id })}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                    selected ? 'border-accent bg-accent-soft' : 'border-line bg-panel hover:border-line-strong'
                  )}
                >
                  <ModeBadgeIcon icon={m.icon} color={m.color} size={26} />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-fg">{m.name}</span>
                    <span className="block truncate text-[11px] text-muted">{m.description}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </SettingRow>
        <SettingRow
          label="Default permission policy"
          keywords="permissions approve ask accept edits auto yolo bypass"
          description="How tool calls are approved. Plan mode always asks before executing."
          stacked
        >
          <div role="radiogroup" className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {PERMISSION_POLICIES.map((p) => (
              <OptionCard
                key={p.id}
                selected={agent.defaultPermission === p.id}
                onSelect={() => void choosePolicy(p.id)}
                title={p.label}
                description={p.description}
                icon={POLICY_ICONS[p.id]}
                danger={p.danger}
              />
            ))}
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Agent behaviour">
        <SettingRow label="Thinking display" keywords="thinking reasoning summary hidden omitted" description="Show summarized reasoning blocks in the chat, or hide them.">
          <SegmentedControl
            size="sm"
            value={agent.thinkingDisplay}
            options={[
              { value: 'summarized', label: 'Summarized' },
              { value: 'omitted', label: 'Hidden' }
            ]}
            onChange={(v) => setAgent({ thinkingDisplay: v })}
          />
        </SettingRow>
        <ToggleRow
          label="Auto-include active file"
          keywords="context editor cursor"
          description="Tell the agent which file and line you are looking at when you send a message."
          checked={agent.autoIncludeActiveFile}
          onChange={(v) => setAgent({ autoIncludeActiveFile: v })}
        />
        <ToggleRow
          label="File checkpoints"
          keywords="rewind restore undo checkpoint"
          description="Snapshot files before each message so you can rewind the agent's edits to any earlier point."
          checked={agent.enableCheckpoints}
          onChange={(v) => setAgent({ enableCheckpoints: v })}
        />
        <ToggleRow
          label="Prompt suggestions"
          keywords="next prompt suggestion predicted"
          description="Suggest a likely next prompt after each turn."
          checked={agent.promptSuggestions}
          onChange={(v) => setAgent({ promptSuggestions: v })}
        />
        <ToggleRow
          label="Sandbox"
          keywords="sandbox bash isolation security"
          description="Run Bash commands inside the Claude Code sandbox when your platform supports it."
          checked={agent.sandbox}
          onChange={(v) => setAgent({ sandbox: v })}
        />
        <SettingRow label="Max turns" keywords="limit turns iterations" description="Stop a request after this many agentic turns.">
          <NullableNumberField value={agent.maxTurns} defaultValue={50} min={1} onCommit={(v) => setAgent({ maxTurns: v })} />
        </SettingRow>
        <SettingRow label="Max budget" keywords="cost usd dollars limit budget" description="Per-chat spending limit (USD, estimated). The agent stops once a chat has spent this much, including across agent restarts.">
          <NullableNumberField value={agent.maxBudgetUsd} defaultValue={5} min={0.1} step={0.5} prefix="$" onCommit={(v) => setAgent({ maxBudgetUsd: v })} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Helper models">
        <SettingRow label="Inline edit model" keywords="cmd+k ctrl+k inline edit" description="Used for ⌘K / Ctrl+K inline edits in the editor.">
          <ModelSelect value={agent.inlineEditModel} onChange={(v) => setAgent({ inlineEditModel: v })} defaultLabel="Default (Sonnet)" />
        </SettingRow>
        <SettingRow label="Commit message model" keywords="git commit message generate" description="Used to generate commit messages in Source Control.">
          <ModelSelect value={agent.commitMessageModel} onChange={(v) => setAgent({ commitMessageModel: v })} defaultLabel="Default (Haiku)" />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Claude Code">
        <ToggleRow
          label="Load user settings (~/.claude)"
          keywords="claude.md user skills agents settings.json"
          description="Load your personal CLAUDE.md, skills, agents and settings from ~/.claude in every chat."
          checked={agent.loadUserSettings}
          onChange={(v) => setAgent({ loadUserSettings: v })}
        />
        <SettingRow
          label="Claude Code executable"
          keywords="binary path cli executable bundled custom"
          description="ATOM drives Claude Code under the hood. The bundled build always matches the Agent SDK version."
          stacked
        >
          <div className="flex flex-col gap-2">
            <div role="radiogroup" className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <OptionCard
                selected={agent.useBundledClaude}
                onSelect={() => setAgent({ useBundledClaude: true })}
                icon={<Box size={15} />}
                title={
                  <span className="flex items-center gap-2">
                    Bundled <Badge tone="accent">Recommended</Badge>
                  </span>
                }
                description="The Claude Code binary shipped with the Agent SDK."
              />
              <OptionCard
                selected={!agent.useBundledClaude}
                onSelect={() => setAgent({ useBundledClaude: false })}
                icon={<FolderCog size={15} />}
                title="Custom path"
                description="Use another Claude Code installation."
              />
            </div>
            {!agent.useBundledClaude && (
              <TextField
                mono
                placeholder="/usr/local/bin/claude"
                value={agent.claudeExecutablePath}
                onCommit={(v) => setAgent({ claudeExecutablePath: v.trim() })}
              />
            )}
            <div className="flex items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-2 text-[11.5px]">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', status?.claudeBinary ? 'bg-success' : status?.claudeBinary === null ? 'bg-danger' : 'bg-subtle')} />
              <span className="shrink-0 text-subtle">In use:</span>
              <code className="selectable min-w-0 flex-1 truncate font-mono text-muted" title={status?.claudeBinary ?? undefined}>
                {status?.claudeBinary === null ? 'Not found' : (status?.claudeBinary ?? 'Checking…')}
              </code>
              {status?.claudeVersion && <Badge>v{status.claudeVersion.replace(/^v/, '')}</Badge>}
              <Button size="xs" variant="ghost" icon={<RefreshCw size={11} />} onClick={() => void refreshAuth(true)}>
                Re-check
              </Button>
            </div>
          </div>
        </SettingRow>
      </SettingGroup>
    </div>
  )
}
