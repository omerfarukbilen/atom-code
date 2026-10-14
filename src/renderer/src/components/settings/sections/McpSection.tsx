import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Globe, Pencil, Plug, Plus, RefreshCw, Server, Terminal, Trash2 } from 'lucide-react'
import type { McpServerSetting } from '@shared/types'
import type { McpServerStatusInfo } from '@shared/ipc'
import { Badge, Button, IconButton, Input, Modal, SegmentedControl, Textarea, Toggle, confirmDialog, type BadgeTone } from '../../ui'
import { useSettingsStore } from '../../../stores/settings'
import { useAgentStore } from '../../../stores/agent'
import { toast } from '../../../stores/toast'
import { atom } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { Searchable, SectionHeader, SettingGroup, matchesQuery, useFocusOnMount, useSettingsQuery } from '../controls'

// ── Text <-> structure helpers ──────────────────────────────────────────────

function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function parsePairs(text: string, sep: '=' | ':'): { value: Record<string, string>; error: string | null } {
  const value: Record<string, string> = {}
  for (const [i, line] of parseLines(text).entries()) {
    const idx = line.indexOf(sep)
    if (idx <= 0) return { value, error: `Line ${i + 1}: expected ${sep === '=' ? 'KEY=VALUE' : 'Header: value'}` }
    value[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return { value, error: null }
}

function formatPairs(obj: Record<string, string> | undefined, sep: '=' | ': '): string {
  return Object.entries(obj ?? {})
    .map(([k, v]) => `${k}${sep}${v}`)
    .join('\n')
}

function summary(s: McpServerSetting): string {
  if (s.type === 'stdio') return [s.command, ...(s.args ?? [])].filter(Boolean).join(' ')
  return s.url ?? ''
}

function statusTone(status: string | undefined): { tone: BadgeTone; dot: string; label: string } {
  switch (status) {
    case 'connected':
      return { tone: 'success', dot: 'bg-success', label: 'Connected' }
    case 'failed':
      return { tone: 'danger', dot: 'bg-danger', label: 'Failed' }
    case 'needs-auth':
      return { tone: 'warning', dot: 'bg-warning', label: 'Needs auth' }
    case 'pending':
      return { tone: 'info', dot: 'bg-info animate-atom-pulse', label: 'Connecting' }
    case 'disabled':
      return { tone: 'neutral', dot: 'bg-subtle', label: 'Disabled' }
    default:
      return { tone: 'neutral', dot: 'bg-subtle', label: status ?? 'Unknown' }
  }
}

/** Id of the active chat when its agent session has started (MCP status is only available then). */
function useLiveChatId(): string | null {
  return useAgentStore((s) => {
    const id = s.activeChatId
    if (!id) return null
    const chat: unknown = s.chats[id]
    return chat && typeof chat === 'object' && (chat as { started?: unknown }).started ? id : null
  })
}

// ── Section ─────────────────────────────────────────────────────────────────

export function McpSection() {
  const servers = useSettingsStore((s) => s.settings.mcpServers)
  const update = useSettingsStore((s) => s.update)
  const chatId = useLiveChatId()
  const query = useSettingsQuery()
  const [editing, setEditing] = useState<{ server: McpServerSetting; isNew: boolean } | null>(null)
  const [live, setLive] = useState<McpServerStatusInfo[] | null>(null)
  const [liveLoading, setLiveLoading] = useState(false)
  const closeEditor = useCallback(() => setEditing(null), [])

  const loadLive = useCallback(async () => {
    if (!chatId) {
      setLive(null)
      return
    }
    setLiveLoading(true)
    try {
      setLive(await atom.agent.mcpStatus(chatId))
    } catch {
      setLive(null)
    } finally {
      setLiveLoading(false)
    }
  }, [chatId])

  useEffect(() => {
    void loadLive()
  }, [loadLive])

  const save = (server: McpServerSetting, isNew: boolean, originalName?: string): void => {
    const next = isNew ? [...servers, server] : servers.map((s) => (s.name === originalName ? server : s))
    void update({ mcpServers: next })
    toast.success(isNew ? `Added MCP server “${server.name}”` : `Saved “${server.name}”`, 'Applies to new chats.')
    setEditing(null)
  }

  const remove = async (server: McpServerSetting): Promise<void> => {
    const ok = await confirmDialog({ title: `Remove MCP server “${server.name}”?`, message: 'Its tools will no longer be available to new chats.', confirmLabel: 'Remove', danger: true })
    if (!ok) return
    void update({ mcpServers: servers.filter((s) => s.name !== server.name) })
  }

  const toggle = (server: McpServerSetting, enabled: boolean): void => {
    void update({ mcpServers: servers.map((s) => (s.name === server.name ? { ...s, enabled } : s)) })
  }

  const liveByName = new Map((live ?? []).map((s) => [s.name, s]))
  const configured = new Set(servers.map((s) => s.name))
  const extraLive = (live ?? []).filter((s) => !configured.has(s.name))
  const visible = servers.filter((s) => matchesQuery(query, 'mcp servers', s.name, s.type, summary(s)))

  return (
    <div>
      <SectionHeader
        title="MCP Servers"
        description="Model Context Protocol servers give the agent extra tools (GitHub, databases, browsers…). Enabled servers are available in every new chat as mcp__<name>__* tools."
        actions={
          <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setEditing({ server: { name: '', enabled: true, type: 'stdio', args: [] }, isNew: true })}>
            Add server
          </Button>
        }
      />

      <SettingGroup
        title="Your servers"
        actions={
          chatId ? (
            <Button size="xs" variant="ghost" icon={<RefreshCw size={11} className={cn(liveLoading && 'animate-spin')} />} onClick={() => void loadLive()}>
              Live status
            </Button>
          ) : undefined
        }
        flush
      >
        {visible.length === 0 ? (
          <Searchable terms="mcp servers add server stdio http sse">
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-6 py-6 text-center">
              <Plug size={20} className="text-subtle" />
              <div className="text-[13px] font-medium text-fg">No MCP servers configured</div>
              <div className="max-w-[420px] text-[12px] leading-relaxed text-muted">
                Add a local (stdio) server such as <code className="font-mono text-[11px]">npx -y @modelcontextprotocol/server-filesystem</code> or a remote HTTP / SSE endpoint.
              </div>
            </div>
          </Searchable>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-elevated">
            {visible.map((s) => {
              const st = liveByName.get(s.name)
              const tone = st ? statusTone(st.status) : null
              return (
                <div key={s.name} data-setting-row="" className={cn('flex items-center gap-3 px-4 py-3', !s.enabled && 'opacity-60')}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-active text-muted">
                    {s.type === 'stdio' ? <Terminal size={15} /> : <Globe size={15} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-fg">{s.name}</span>
                      <Badge>{s.type}</Badge>
                      {tone && (
                        <Badge tone={tone.tone} title={st?.error}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
                          {tone.label}
                          {st?.tools && st.tools.length > 0 ? ` · ${st.tools.length} tools` : ''}
                        </Badge>
                      )}
                    </div>
                    <div className="selectable mt-0.5 truncate font-mono text-[11.5px] text-muted" title={summary(s)}>
                      {summary(s) || <span className="italic text-subtle">not configured</span>}
                    </div>
                    {st?.error && <div className="mt-0.5 truncate text-[11.5px] text-danger">{st.error}</div>}
                  </div>
                  <Toggle checked={s.enabled} onChange={(v) => toggle(s, v)} title={s.enabled ? 'Disable server' : 'Enable server'} />
                  <IconButton title="Edit server" icon={<Pencil size={13} />} onClick={() => setEditing({ server: s, isNew: false })} />
                  <IconButton title="Remove server" icon={<Trash2 size={13} />} className="hover:text-danger" onClick={() => void remove(s)} />
                </div>
              )
            })}
          </div>
        )}
      </SettingGroup>

      {chatId && extraLive.length > 0 && (
        <SettingGroup title="Also active in the current chat" description="Built-in, plugin and project (.mcp.json) servers reported by the running agent session." flush>
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-elevated">
            {extraLive
              .filter((s) => matchesQuery(query, 'mcp servers live', s.name, s.status))
              .map((s) => {
                const tone = statusTone(s.status)
                return (
                  <div key={s.name} data-setting-row="" className="flex items-center gap-3 px-4 py-2.5">
                    <Server size={14} className="shrink-0 text-subtle" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{s.name}</span>
                    {s.tools && s.tools.length > 0 && <span className="text-[11px] text-subtle">{s.tools.length} tools</span>}
                    <Badge tone={tone.tone} title={s.error}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
                      {tone.label}
                    </Badge>
                  </div>
                )
              })}
          </div>
        </SettingGroup>
      )}

      <SettingGroup flush>
        <Searchable terms="project .mcp.json servers trusted folder workspace trust">
          <div className="rounded-lg border border-line bg-panel px-4 py-3 text-[12px] leading-relaxed text-muted">
            Servers defined in a project’s <code className="font-mono text-[11px] text-fg">.mcp.json</code> load only in folders you trust (Workspace: Manage Trust…).
            ATOM always adds its built-in <code className="font-mono text-[11px] text-fg">atom-ide</code> server so the agent can see your open editors, selection, diagnostics and terminal.
            {!chatId && ' Start a chat to see live connection status here.'}
          </div>
        </Searchable>
      </SettingGroup>

      {editing && (
        <McpServerDialog
          server={editing.server}
          isNew={editing.isNew}
          takenNames={new Set(servers.filter((s) => s.name !== editing.server.name || editing.isNew).map((s) => s.name))}
          onCancel={closeEditor}
          onSave={(s) => save(s, editing.isNew, editing.server.name)}
        />
      )}
    </div>
  )
}

// ── Add / edit dialog ───────────────────────────────────────────────────────

function McpServerDialog({
  server,
  isNew,
  takenNames,
  onCancel,
  onSave
}: {
  server: McpServerSetting
  isNew: boolean
  takenNames: Set<string>
  onCancel(): void
  onSave(server: McpServerSetting): void
}) {
  const [name, setName] = useState(server.name)
  const nameRef = useFocusOnMount<HTMLInputElement>()
  const [type, setType] = useState<McpServerSetting['type']>(server.type)
  const [command, setCommand] = useState(server.command ?? '')
  const [args, setArgs] = useState((server.args ?? []).join('\n'))
  const [env, setEnv] = useState(formatPairs(server.env, '='))
  const [url, setUrl] = useState(server.url ?? '')
  const [headers, setHeaders] = useState(formatPairs(server.headers, ': '))

  const n = name.trim()
  const nameError = !n
    ? 'Required.'
    : !/^[A-Za-z0-9_-]+$/.test(n)
      ? 'Letters, digits, - and _ only.'
      : n === 'atom-ide'
        ? 'Reserved for ATOM’s built-in server.'
        : takenNames.has(n)
          ? 'A server with this name already exists.'
          : null
  const envParsed = parsePairs(env, '=')
  const headersParsed = parsePairs(headers, ':')
  const commandError = type === 'stdio' && !command.trim() ? 'Required.' : null
  const urlError = type !== 'stdio' && !/^https?:\/\/\S+$/.test(url.trim()) ? 'Enter an http(s):// URL.' : null
  const invalid = !!(nameError || commandError || urlError || (type === 'stdio' ? envParsed.error : headersParsed.error))

  const submit = (): void => {
    if (invalid) return
    const base: McpServerSetting = { name: n, enabled: server.enabled, type }
    if (type === 'stdio') {
      const e = envParsed.value
      onSave({ ...base, command: command.trim(), args: parseLines(args), ...(Object.keys(e).length ? { env: e } : {}) })
    } else {
      const h = headersParsed.value
      onSave({ ...base, url: url.trim(), ...(Object.keys(h).length ? { headers: h } : {}) })
    }
  }

  return (
    <Modal
      open
      onClose={onCancel}
      width="max-w-xl"
      title={isNew ? 'Add MCP server' : `Edit “${server.name}”`}
      description="Changes apply to chats started afterwards."
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={invalid} onClick={submit}>
            {isNew ? 'Add server' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
          <FormField label="Name" error={name ? nameError : null} hint={`Tools appear as mcp__${n || 'name'}__<tool>`}>
            <Input ref={nameRef} inputSize="sm" className="font-mono" placeholder="github" value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Transport">
            <SegmentedControl
              size="sm"
              value={type}
              options={[
                { value: 'stdio', label: 'stdio', icon: <Terminal size={12} /> },
                { value: 'http', label: 'HTTP', icon: <Globe size={12} /> },
                { value: 'sse', label: 'SSE', icon: <Globe size={12} /> }
              ]}
              onChange={setType}
            />
          </FormField>
        </div>

        {type === 'stdio' ? (
          <>
            <FormField label="Command" error={command ? null : commandError} hint="Executable to launch, e.g. npx, uvx, node or an absolute path.">
              <Input inputSize="sm" className="font-mono" placeholder="npx" value={command} onChange={(e) => setCommand(e.target.value)} />
            </FormField>
            <FormField label="Arguments" hint="One argument per line.">
              <Textarea rows={3} className="font-mono text-[12px]" placeholder={'-y\n@modelcontextprotocol/server-github'} value={args} onChange={(e) => setArgs(e.target.value)} />
            </FormField>
            <FormField label="Environment" error={envParsed.error} hint="KEY=VALUE, one per line. Stored in ATOM settings — avoid committing secrets elsewhere.">
              <Textarea rows={3} className="font-mono text-[12px]" placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=ghp_…" value={env} onChange={(e) => setEnv(e.target.value)} />
            </FormField>
          </>
        ) : (
          <>
            <FormField label="URL" error={url ? urlError : null}>
              <Input inputSize="sm" className="font-mono" placeholder="https://mcp.example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
            </FormField>
            <FormField label="Headers" error={headersParsed.error} hint="Header: value, one per line (e.g. Authorization: Bearer …).">
              <Textarea rows={3} className="font-mono text-[12px]" placeholder="Authorization: Bearer …" value={headers} onChange={(e) => setHeaders(e.target.value)} />
            </FormField>
          </>
        )}
      </div>
    </Modal>
  )
}

function FormField({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="text-[12px] font-medium text-fg">{label}</div>
      {children}
      {error ? <div className="text-[11px] text-danger">{error}</div> : hint && <div className="text-[11px] text-subtle">{hint}</div>}
    </div>
  )
}

