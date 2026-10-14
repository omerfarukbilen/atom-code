import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Bot, Folder, FolderOpen, FilePlus, KeyRound, LogIn, Search, Settings, Sparkles, SquareTerminal, TriangleAlert } from 'lucide-react'
import type { AuthStatus } from '@shared/types'
import { atom } from '../../lib/api'
import { cn } from '../../lib/cn'
import { isMac } from '../../lib/platform'
import { useAgentStore } from '../../stores/agent'
import { useAuthStore } from '../../stores/auth'
import { useEditorStore } from '../../stores/editor'
import { useLayoutStore } from '../../stores/layout'
import { useSettingsStore } from '../../stores/settings'
import { useWorkspaceStore } from '../../stores/workspace'
import { AtomLogo, Badge, Button, Kbd, Spinner } from '../ui'
import { toggleTerminal } from './commands'

const terminalKey = isMac ? 'ctrl+`' : 'mod+`'

const SHORTCUTS: { label: string; keys: string }[] = [
  { label: 'Go to file', keys: 'mod+p' },
  { label: 'Command palette', keys: 'mod+shift+p' },
  { label: 'Toggle ATOM agent', keys: 'mod+alt+b' },
  { label: 'New chat', keys: 'mod+shift+l' },
  { label: 'Inline edit with ATOM', keys: 'mod+k' },
  { label: 'Add selection to chat', keys: 'mod+l' },
  { label: 'Toggle terminal', keys: terminalKey },
  { label: 'Show problems', keys: 'mod+shift+m' }
]

function shortenHome(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~')
}

function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(ts).toLocaleDateString()
}

function newChat(): void {
  useLayoutStore.getState().setAgentVisible(true)
  useAgentStore.getState().newChat()
  requestAnimationFrame(() => useAgentStore.getState().focusComposer())
}

function ActionRow({ icon, label, hint, keys, onClick, primary }: { icon: ReactNode; label: string; hint: string; keys?: string; onClick(): void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-100 hover:bg-hover"
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors',
          primary ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-elevated text-muted group-hover:text-fg'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-fg">{label}</span>
        <span className="block truncate text-[11.5px] text-subtle">{hint}</span>
      </span>
      {keys && <Kbd keys={keys} className="opacity-70 group-hover:opacity-100" />}
    </button>
  )
}

function planLabel(status: AuthStatus): string | null {
  const t = status.subscriptionType?.trim()
  if (!t) return null
  return t.charAt(0).toUpperCase() + t.slice(1)
}

const METHOD_LABEL: Record<AuthStatus['method'], string> = {
  'claude-subscription': 'Claude subscription',
  'oauth-token': 'Long-lived token',
  'api-key': 'Anthropic API key',
  console: 'Anthropic Console',
  'third-party': 'Cloud provider',
  none: 'Not signed in'
}

function AccountCard() {
  const status = useAuthStore((s) => s.status)
  const loading = useAuthStore((s) => s.loading)

  useEffect(() => {
    if (!useAuthStore.getState().status) void useAuthStore.getState().refresh()
  }, [])

  let body: ReactNode
  if (!status && loading) {
    body = (
      <div className="flex items-center gap-2 py-2 text-[12.5px] text-muted">
        <Spinner size={13} /> Checking sign-in…
      </div>
    )
  } else if (status?.loggedIn) {
    const plan = planLabel(status)
    const name = status.email ?? status.organization ?? METHOD_LABEL[status.method]
    body = (
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[14px] font-semibold uppercase text-accent">
          {(status.email ?? 'A').charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-fg">{name}</span>
            {plan && <Badge tone="accent">{plan}</Badge>}
          </div>
          <div className="truncate text-[11.5px] text-subtle">
            {METHOD_LABEL[status.method]}
            {status.claudeVersion ? ` · Claude Code ${status.claudeVersion}` : ''}
          </div>
        </div>
        <Button size="xs" variant="ghost" onClick={() => useLayoutStore.getState().openSettings('account')}>
          Manage
        </Button>
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <div>
          <div className="text-[13px] font-medium text-fg">Sign in to start building with ATOM</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-muted">Use your Claude Pro or Max subscription through the official Claude Code login — no API key needed.</div>
        </div>
        {status?.claudeBinary === null && (
          <div className="flex items-start gap-2 rounded-md bg-warning-soft px-2.5 py-2 text-[11.5px] text-warning">
            <TriangleAlert size={13} className="mt-px shrink-0" />
            The Claude Code executable was not found. Check Settings → Models &amp; Agent.
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" icon={<LogIn size={14} />} onClick={() => useAuthStore.getState().openLogin('claudeai')}>
            Sign in with Claude
          </Button>
          <Button size="sm" variant="ghost" icon={<KeyRound size={13} />} onClick={() => useLayoutStore.getState().openSettings('account')}>
            Use an API key
          </Button>
        </div>
      </div>
    )
  }

  return (
    <section className="rounded-xl border border-line bg-elevated/70 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Account</div>
      {body}
    </section>
  )
}

/** Shown in the editor area when no editor is open. */
export function WelcomePage() {
  const recent = useSettingsStore((s) => s.settings.recentWorkspaces)
  const workspace = useWorkspaceStore((s) => s.workspace)
  const opening = useWorkspaceStore((s) => s.opening)
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void atom.app
      .getVersion()
      .then((v) => alive && setVersion(v))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const recentList = recent.slice(0, 7)

  return (
    <div className="relative h-full overflow-auto bg-app">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        style={{ background: 'radial-gradient(640px 300px at 50% -40px, var(--accent-soft), transparent 70%)' }}
      />
      <div className="relative mx-auto flex min-h-full max-w-[920px] flex-col px-10 pb-10 pt-16">
        <header className="flex flex-col items-center text-center animate-fade-in">
          <div className="relative mb-5">
            <div className="absolute inset-[-18px] rounded-full bg-accent-soft blur-2xl" />
            <AtomLogo size={76} className="relative drop-shadow-[0_0_18px_var(--accent-soft)]" />
          </div>
          <h1 className="atom-gradient-text text-[34px] font-semibold leading-tight tracking-tight">ATOM Code</h1>
          <p className="mt-2 max-w-[460px] text-[14px] leading-relaxed text-muted">
            The AI-native code editor. Plan, edit and ship with an agent powered by Claude — right next to your code.
          </p>
          {workspace && (
            <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-line bg-elevated px-3 py-1 text-[12px] text-muted">
              <Folder size={13} className="text-accent" />
              <span className="font-medium text-fg">{workspace.name}</span>
              <span className="text-subtle">{shortenHome(workspace.path)}</span>
            </div>
          )}
        </header>

        <div className="mt-12 grid gap-10 md:grid-cols-[1.15fr_1fr]">
          <div className="flex min-w-0 flex-col gap-8">
            <section>
              <h2 className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Start</h2>
              <div className="flex flex-col gap-0.5">
                <ActionRow
                  primary
                  icon={<Bot size={16} />}
                  label="New chat with ATOM"
                  hint="Ask, plan or let the agent implement a change"
                  keys="mod+shift+l"
                  onClick={newChat}
                />
                <ActionRow
                  icon={<FolderOpen size={16} />}
                  label={workspace ? 'Open another folder…' : 'Open folder…'}
                  hint="Work on a project on your computer"
                  keys="mod+o"
                  onClick={() => void useWorkspaceStore.getState().openFolderDialog()}
                />
                {workspace ? (
                  <>
                    <ActionRow
                      icon={<Search size={16} />}
                      label="Go to file…"
                      hint="Fuzzy-find any file in the workspace"
                      keys="mod+p"
                      onClick={() => useLayoutStore.getState().openCommandPalette('')}
                    />
                    <ActionRow icon={<FilePlus size={16} />} label="New file…" hint="Create a file in this workspace" keys="mod+n" onClick={() => useEditorStore.getState().openNewFileDialog()} />
                    <ActionRow icon={<SquareTerminal size={16} />} label="Open terminal" hint="A shell in the workspace folder" keys={terminalKey} onClick={() => void toggleTerminal()} />
                  </>
                ) : null}
                <ActionRow icon={<Settings size={16} />} label="Settings" hint="Models, modes, rules, MCP servers, appearance" keys="mod+," onClick={() => useLayoutStore.getState().openSettings()} />
              </div>
            </section>

            <section>
              <h2 className="mb-2 flex items-center px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">
                Recent
                {opening && <Spinner size={11} className="ml-2 text-subtle" />}
              </h2>
              {recentList.length === 0 ? (
                <div className="px-2.5 text-[12.5px] text-subtle">Folders you open will appear here.</div>
              ) : (
                <div className="flex flex-col gap-px">
                  {recentList.map((r) => {
                    const current = workspace?.path === r.path
                    return (
                      <button
                        key={r.path}
                        type="button"
                        disabled={current}
                        onClick={() => void useWorkspaceStore.getState().openWorkspace(r.path)}
                        className="group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-hover disabled:hover:bg-transparent"
                        title={r.path}
                      >
                        <Folder size={14} className={cn('shrink-0', current ? 'text-accent' : 'text-subtle group-hover:text-muted')} />
                        <span className="shrink-0 text-[13px] text-fg">{r.name}</span>
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-subtle">{shortenHome(r.path)}</span>
                        <span className="shrink-0 text-[11px] text-subtle">{current ? 'open' : timeAgo(r.openedAt)}</span>
                        {!current && <ArrowRight size={12} className="shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <AccountCard />
            <section className="rounded-xl border border-line bg-elevated/70 p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">
                <Sparkles size={12} className="text-accent" /> Shortcuts
              </div>
              <ul className="flex flex-col gap-2">
                {SHORTCUTS.map((s) => (
                  <li key={s.label} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="text-muted">{s.label}</span>
                    <Kbd keys={s.keys} />
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>

        <footer className="mt-auto pt-12 text-center text-[11px] text-subtle">
          ATOM Code{version ? ` ${version}` : ''} · Agent harness by the Claude Agent SDK
        </footer>
      </div>
    </div>
  )
}
