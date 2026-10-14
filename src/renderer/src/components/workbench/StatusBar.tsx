import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, CircleX, GitBranch, LogIn, RefreshCw, TriangleAlert } from 'lucide-react'
import { FALLBACK_MODELS, findMode, getAllModes } from '@shared/modes'
import { cn } from '../../lib/cn'
import { useAgentStore } from '../../stores/agent'
import { planLabel, useAuthStore } from '../../stores/auth'
import { useEditorStore } from '../../stores/editor'
import { useGitStore } from '../../stores/git'
import { useLayoutStore } from '../../stores/layout'
import { useSettingsStore } from '../../stores/settings'
import { useWorkspaceStore } from '../../stores/workspace'
import { ModeIcon } from '../settings/mode-icons'
import { Menu, Spinner, useMenu, type MenuEntry } from '../ui'
import { revealSidebarView } from './commands'

/** 24 px status bar: repo + problems + agent activity on the left, editor + agent + account on the right. */
export function StatusBar() {
  return (
    <footer className="flex h-6 shrink-0 items-stretch justify-between gap-2 border-t border-line bg-titlebar px-1 text-[11.5px] text-muted">
      <div className="flex min-w-0 items-stretch">
        <BranchItem />
        <ProblemsItem />
        <AgentActivityItem />
      </div>
      <div className="flex min-w-0 items-stretch">
        <CursorItem />
        <LanguageItem />
        <ModeModelItem />
        <AccountItem />
      </div>
    </footer>
  )
}

function Item({ title, onClick, children, className }: { title: string; onClick?: (e: MouseEvent<HTMLElement>) => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn('flex min-w-0 items-center gap-1 whitespace-nowrap rounded-sm px-2 transition-colors hover:bg-hover hover:text-fg', className)}
    >
      {children}
    </button>
  )
}

function BranchItem() {
  const status = useGitStore((s) => s.status)
  const busy = useGitStore((s) => s.busy)
  const hasWorkspace = useWorkspaceStore((s) => !!s.workspace)
  if (!hasWorkspace || !status?.isRepo) return null
  const syncing = busy === 'push' || busy === 'pull'
  return (
    <Item
      title={`${status.branch ?? 'detached HEAD'}${status.tracking ? ` ⇄ ${status.tracking}` : ''} — Source Control`}
      onClick={() => revealSidebarView('git')}
    >
      <GitBranch size={13} className="shrink-0" />
      <span className="max-w-[160px] truncate">{status.branch ?? 'HEAD'}</span>
      {syncing ? (
        <RefreshCw size={11} className="animate-spin" />
      ) : (
        (status.ahead > 0 || status.behind > 0) && (
          <span className="flex items-center gap-0.5 tabular-nums">
            {status.behind > 0 && (
              <>
                <ArrowDown size={11} />
                {status.behind}
              </>
            )}
            {status.ahead > 0 && (
              <>
                <ArrowUp size={11} />
                {status.ahead}
              </>
            )}
          </span>
        )
      )}
    </Item>
  )
}

function ProblemsItem() {
  const counts = useEditorStore((s) => s.diagnosticCounts)
  return (
    <Item title="Problems — show the Problems panel" onClick={() => useLayoutStore.getState().showPanel('problems')}>
      <CircleX size={13} className={counts.errors ? 'text-danger' : undefined} />
      <span className="tabular-nums">{counts.errors}</span>
      <TriangleAlert size={13} className={cn('ml-1', counts.warnings ? 'text-warning' : undefined)} />
      <span className="tabular-nums">{counts.warnings}</span>
    </Item>
  )
}

function AgentActivityItem() {
  // Active chat first; otherwise surface any background chat that is working or waiting.
  const activity = useAgentStore((s) => {
    const active = s.activeChatId ? s.chats[s.activeChatId] : undefined
    if (active && (active.status === 'running' || active.status === 'awaiting-input' || active.status === 'starting')) return active.status
    const all = Object.values(s.chats)
    if (all.some((c) => c.status === 'awaiting-input')) return 'awaiting-input'
    if (all.some((c) => c.status === 'running')) return 'running'
    return null
  })
  if (!activity) return null
  const focusAgent = (): void => {
    const l = useLayoutStore.getState()
    l.setAgentVisible(true)
    useAgentStore.getState().focusComposer()
  }
  if (activity === 'awaiting-input') {
    return (
      <Item title="ATOM is waiting for your approval" onClick={focusAgent} className="text-warning hover:text-warning">
        <span className="h-1.5 w-1.5 rounded-full bg-warning animate-atom-pulse" />
        Waiting for approval
      </Item>
    )
  }
  return (
    <Item title="ATOM is working — show the agent" onClick={focusAgent}>
      <Spinner size={10} className="text-accent" />
      <span className="animate-shimmer-text">{activity === 'starting' ? 'Starting ATOM…' : 'ATOM is working…'}</span>
    </Item>
  )
}

function CursorItem() {
  const cursor = useEditorStore((s) => s.cursor)
  const isText = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.kind === 'file')
  if (!cursor || !isText) return null
  return (
    <Item title="Go to Line/Column" onClick={() => useLayoutStore.getState().openCommandPalette(':')}>
      Ln {cursor.line}, Col {cursor.column}
      {cursor.selectionLength > 0 && (
        <span className="text-subtle">
          ({cursor.selectionLength} selected{cursor.selectionLines > 1 ? `, ${cursor.selectionLines} lines` : ''})
        </span>
      )}
    </Item>
  )
}

const LANGUAGE_NAMES: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  json: 'JSON',
  markdown: 'Markdown',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  html: 'HTML',
  xml: 'XML',
  yaml: 'YAML',
  ini: 'INI',
  python: 'Python',
  ruby: 'Ruby',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  kotlin: 'Kotlin',
  scala: 'Scala',
  swift: 'Swift',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  php: 'PHP',
  shell: 'Shell Script',
  powershell: 'PowerShell',
  sql: 'SQL',
  graphql: 'GraphQL',
  dart: 'Dart',
  lua: 'Lua',
  r: 'R',
  dockerfile: 'Dockerfile',
  protobuf: 'Protocol Buffers',
  hcl: 'HCL',
  elixir: 'Elixir',
  clojure: 'Clojure',
  haskell: 'Haskell',
  perl: 'Perl',
  plaintext: 'Plain Text',
  makefile: 'Makefile',
  ignore: 'Ignore'
}

function LanguageItem() {
  const tab = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  if (!tab || tab.kind === 'welcome') return null
  const lang = tab.kind === 'image' ? 'Image' : (LANGUAGE_NAMES[tab.language] ?? tab.language)
  return (
    <Item title={`Language: ${lang}`} className="cursor-default">
      {lang}
    </Item>
  )
}

function ModeModelItem() {
  const customModes = useSettingsStore((s) => s.settings.customModes)
  const defaults = useSettingsStore((s) => s.settings.agent)
  const chat = useAgentStore((s) => (s.activeChatId ? s.chats[s.activeChatId] : undefined))
  const menu = useMenu('top-end')
  const modeId = chat?.modeId ?? defaults.defaultModeId
  const mode = findMode(modeId, customModes)
  const modelValue = chat ? chat.model : defaults.defaultModel
  const modelLabel = FALLBACK_MODELS.find((m) => m.value === modelValue)?.label ?? (modelValue || 'Default')

  const entries: MenuEntry[] = useMemo(
    () => [
      { type: 'header', id: 'h', label: chat ? 'Mode for this chat' : 'Default mode' },
      ...getAllModes(customModes).map(
        (m): MenuEntry => ({
          id: m.id,
          label: m.name,
          description: m.description,
          checked: m.id === mode.id,
          icon: <ModeIcon name={m.icon} size={14} style={{ color: m.color }} />,
          onSelect: () => {
            if (chat) useAgentStore.getState().setMode(m.id)
            else void useSettingsStore.getState().update({ agent: { defaultModeId: m.id } })
          }
        })
      )
    ],
    [chat, customModes, mode.id]
  )

  return (
    <>
      <Item title={`Agent mode: ${mode.name} · Model: ${modelLabel} — change mode`} onClick={menu.openFromEvent}>
        <ModeIcon name={mode.icon} size={12} style={{ color: mode.color }} />
        <span>{mode.name}</span>
        <span className="text-subtle">·</span>
        <span className="max-w-[120px] truncate text-subtle">{modelLabel}</span>
      </Item>
      <Menu {...menu.props} entries={entries} minWidth={280} />
    </>
  )
}

function AccountItem() {
  const status = useAuthStore((s) => s.status)
  const loading = useAuthStore((s) => s.loading)
  if (!status) {
    return loading ? (
      <Item title="Checking Claude sign-in…">
        <Spinner size={10} />
      </Item>
    ) : null
  }
  if (!status.loggedIn) {
    return (
      <Item title="Sign in with your Claude subscription" onClick={() => useAuthStore.getState().openLogin()} className="font-medium text-accent hover:text-accent">
        <LogIn size={12} />
        Sign in
      </Item>
    )
  }
  const plan = planLabel(status)
  return (
    <Item title={`${status.email ?? 'Signed in'}${status.organization ? ` · ${status.organization}` : ''} — Account settings`} onClick={() => useLayoutStore.getState().openSettings('account')}>
      {status.email && <span className="max-w-[180px] truncate">{status.email}</span>}
      {plan && <span className="rounded bg-accent-soft px-1 text-[10px] font-semibold uppercase leading-[14px] tracking-wide text-accent">{plan}</span>}
    </Item>
  )
}
