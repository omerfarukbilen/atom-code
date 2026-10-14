import { useEffect, useMemo, type ReactNode } from 'react'
import { ArrowUpRight, FolderOpen, History, MessageSquare, Sparkles } from 'lucide-react'
import type { AgentModeDefinition } from '@shared/types'
import { BUILTIN_MODES, PERMISSION_POLICIES } from '@shared/modes'
import { basename, relativePath } from '@shared/paths'
import { cn } from '../../lib/cn'
import { formatKeybinding } from '../../lib/platform'
import { useAgentModes, useAgentStore } from '../../stores/agent'
import { useEditorStore } from '../../stores/editor'
import { useSettingsStore } from '../../stores/settings'
import { useWorkspaceStore } from '../../stores/workspace'
import { ModeBadgeIcon, ModeIcon } from '../settings/mode-icons'
import { AtomLogo, Button } from '../ui'
import { showHistoryView } from './header/AgentHeader'
import { useSessionHistory } from './header/session-history'
import { relativeTime } from './header/time'

const COPY: Record<string, { headline: string; sub: string }> = {
  agent: { headline: 'What should we build?', sub: 'ATOM explores your code, makes the changes and verifies them end-to-end.' },
  plan: { headline: 'What should we plan?', sub: 'ATOM researches read-only, then proposes a step-by-step plan for your approval.' },
  ask: { headline: 'What would you like to know?', sub: 'Answers grounded in your code, with file references — nothing gets changed.' },
  debug: { headline: 'What’s broken?', sub: 'Reproduce, isolate the root cause, fix it and prove it’s fixed.' },
  review: { headline: 'What should I review?', sub: 'Bugs, security and quality issues in your changes, ranked by severity.' },
  tdd: { headline: 'Which behaviour should we test first?', sub: 'Red → green → refactor: a failing test first, then the minimal code.' }
}

interface ExampleContext {
  project: string
  stack: string | null
  file: string | null
  isGit: boolean
}

/** Language / platform of the workspace from well-known root files. */
function detectStack(files: string[], root: string | undefined): string | null {
  if (!root) return null
  const names = new Set<string>()
  for (const f of files) {
    const rel = relativePath(root, f)
    if (!rel.includes('/')) names.add(rel.toLowerCase())
  }
  if (names.has('tsconfig.json')) return 'TypeScript'
  if (names.has('package.json')) return 'JavaScript'
  if (names.has('cargo.toml')) return 'Rust'
  if (names.has('go.mod')) return 'Go'
  if (names.has('pyproject.toml') || names.has('requirements.txt') || names.has('setup.py')) return 'Python'
  if (names.has('pubspec.yaml')) return 'Flutter'
  if (names.has('package.swift')) return 'Swift'
  if (names.has('build.gradle.kts')) return 'Kotlin'
  if (names.has('pom.xml') || names.has('build.gradle')) return 'Java'
  if (names.has('gemfile')) return 'Ruby'
  if (names.has('composer.json')) return 'PHP'
  if ([...names].some((n) => n.endsWith('.csproj') || n.endsWith('.sln'))) return '.NET'
  return null
}

function examplesFor(modeId: string, ctx: ExampleContext): string[] {
  const p = ctx.project || 'this project'
  const f = ctx.file
  const inStack = ctx.stack ? ` in this ${ctx.stack} project` : ''
  switch (modeId) {
    case 'plan':
      return [
        `Plan how to add user authentication to ${p}`,
        f ? `Plan a refactor of ${f} into smaller, testable pieces` : 'Plan a refactor of the largest module into smaller pieces',
        `Plan an automated test setup${inStack}`,
        'Plan performance improvements for the slowest part of the app'
      ]
    case 'ask':
      return [
        `Give me a tour of ${p}: the main modules and how they fit together`,
        f ? `What does ${f} do, and where is it used?` : 'Where is the entry point, and what happens on startup?',
        'How does data flow from user input to storage in this codebase?',
        'Which parts of the code are the most complex or fragile, and why?'
      ]
    case 'debug':
      return [
        'The build is failing — find the root cause and fix it',
        'Some tests are failing — reproduce them and fix the underlying bug',
        'Fix the errors and warnings in the Problems panel',
        f ? `Something in ${f} behaves incorrectly — help me track it down` : 'Find out why the app crashes on startup'
      ]
    case 'review':
      return [
        ctx.isGit ? 'Review my uncommitted changes' : 'Review the most recently changed files',
        ctx.isGit ? 'Review the last commit for bugs and security issues' : 'Audit the codebase for security issues',
        f ? `Review ${f} for edge cases and error handling` : 'Review error handling across the codebase',
        'Check my changes for missing or weak tests'
      ]
    case 'tdd':
      return [
        f ? `Write unit tests for ${f}, then fix anything they reveal` : 'Write unit tests for the core business logic',
        'Add a failing test for the next feature, then implement it',
        `Set up a test framework${inStack}`,
        'Reproduce a bug with a failing test first, then fix it'
      ]
    default:
      return [
        f ? `Explain ${f} and improve its error handling` : `Explain the architecture of ${p}`,
        'Find and fix the bug in the code I’m working on',
        `Add tests for the most important untested code${inStack}`,
        'Refactor the largest file into smaller, focused modules'
      ]
  }
}

function fillComposer(chatId: string, text: string): void {
  const store = useAgentStore.getState()
  store.setComposerText(text, chatId)
  store.focusComposer()
}

/** Welcome state of an empty chat: logo, mode switcher, mode card, example prompts, recent chats and hints. */
export function EmptyChat({ chatId }: { chatId: string }) {
  const modeId = useAgentStore((s) => s.chats[chatId]?.modeId ?? '')
  const permission = useAgentStore((s) => s.chats[chatId]?.permission ?? 'default')
  const modes = useAgentModes()
  const mode = useMemo(() => modes.find((m) => m.id === modeId) ?? modes[0], [modes, modeId])
  const workspace = useWorkspaceStore((s) => s.workspace)
  const files = useWorkspaceStore((s) => s.files)
  const activeFile = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    return tab && tab.kind === 'file' ? tab.path : null
  })

  const stack = useMemo(() => detectStack(files, workspace?.path), [files, workspace?.path])
  const examples = useMemo(
    () => examplesFor(mode.id, { project: workspace?.name ?? '', stack, file: activeFile ? basename(activeFile) : null, isGit: !!workspace?.isGitRepo }),
    [mode.id, workspace?.name, workspace?.isGitRepo, stack, activeFile]
  )
  const copy = COPY[mode.id] ?? { headline: 'What should we build?', sub: mode.description }

  return (
    <div className="@container flex h-full w-full overflow-y-auto">
      <div className="m-auto flex w-full max-w-[540px] flex-col items-center px-4 py-8 animate-fade-in">
        <div className="relative mb-4">
          <div className="absolute -inset-4 rounded-full bg-accent-soft blur-2xl" />
          <AtomLogo size={52} className="relative" />
        </div>
        <h2 className="text-center text-[18px] font-semibold tracking-tight text-fg">{copy.headline}</h2>
        <p className="mt-1 max-w-[400px] text-center text-[12.5px] leading-relaxed text-muted">{copy.sub}</p>

        {!workspace && <OpenFolderCard />}

        <div className="mt-5 flex flex-wrap justify-center gap-1.5" role="radiogroup" aria-label="Agent mode">
          {BUILTIN_MODES.map((m) => (
            <ModeChip key={m.id} mode={m} active={m.id === mode.id} onClick={() => useAgentStore.getState().setMode(m.id, chatId)} />
          ))}
        </div>

        <ModeCard key={mode.id} mode={mode} permissionLabel={PERMISSION_POLICIES.find((p) => p.id === permission)?.label ?? ''} />

        <div className="mt-3 grid w-full grid-cols-1 gap-1.5 @lg:grid-cols-2">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => fillComposer(chatId, ex)}
              className="group flex items-start gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-left text-[12.5px] leading-snug text-muted transition-colors duration-100 hover:border-line-strong hover:bg-hover hover:text-fg"
            >
              <span className="min-w-0 flex-1">{ex}</span>
              <ArrowUpRight size={13} className="mt-0.5 shrink-0 text-subtle transition-colors group-hover:text-accent" />
            </button>
          ))}
        </div>

        {workspace && <RecentChats chatId={chatId} />}

        <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[11px] text-subtle">
          <Hint keys={<kbd className="kbd">@</kbd>}>add context</Hint>
          <Hint keys={<kbd className="kbd">/</kbd>}>commands</Hint>
          <Hint keys={<kbd className="kbd">{formatKeybinding('shift+tab')}</kbd>}>switch mode</Hint>
          <Hint keys={<kbd className="kbd">{formatKeybinding('mod+k')}</kbd>}>inline edit in the editor</Hint>
        </div>
      </div>
    </div>
  )
}

function Hint({ keys, children }: { keys: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {keys}
      {children}
    </span>
  )
}

function ModeChip({ mode, active, onClick }: { mode: AgentModeDefinition; active: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      title={mode.description}
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-100',
        active ? 'text-fg' : 'border-line text-muted hover:bg-hover hover:text-fg'
      )}
      style={
        active
          ? { borderColor: `color-mix(in srgb, ${mode.color} 55%, transparent)`, background: `color-mix(in srgb, ${mode.color} 14%, transparent)` }
          : undefined
      }
    >
      <ModeIcon name={mode.icon} size={13} style={{ color: mode.color }} />
      {mode.name}
    </button>
  )
}

function ModeCard({ mode, permissionLabel }: { mode: AgentModeDefinition; permissionLabel: string }) {
  const behaviour = mode.forcedPermissionMode === 'plan' ? 'Read-only · plan for approval' : mode.readOnly ? 'Read-only' : permissionLabel
  return (
    <div
      className="mt-3 flex w-full items-start gap-3 rounded-xl border bg-elevated p-3 text-left animate-fade-in"
      style={{ borderColor: `color-mix(in srgb, ${mode.color} 35%, var(--line))` }}
    >
      <ModeBadgeIcon icon={mode.icon} color={mode.color} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold text-fg">{mode.name} mode</span>
          {behaviour && <span className="text-[11px] text-subtle">{behaviour}</span>}
        </div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{mode.description}</div>
        {!!mode.skills?.length && (
          <div className="mt-2 flex flex-wrap gap-1">
            {mode.skills.map((s) => (
              <span key={s} className="inline-flex h-[18px] items-center gap-1 rounded bg-accent-soft px-1.5 font-mono text-[10.5px] text-accent" title="Skill this mode uses">
                <Sparkles size={10} />
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function OpenFolderCard() {
  const recent = useSettingsStore((s) => s.settings.recentWorkspaces)
  return (
    <div className="mt-5 w-full rounded-xl border border-line bg-elevated p-4 text-center">
      <div className="text-[13px] font-medium text-fg">Open a project to get started</div>
      <div className="mx-auto mt-1 max-w-[360px] text-[12px] leading-relaxed text-muted">
        ATOM works inside a folder: it reads your code, edits files and runs commands there.
      </div>
      <Button variant="primary" size="sm" icon={<FolderOpen size={13} />} className="mt-3" onClick={() => void useWorkspaceStore.getState().openFolderDialog()}>
        Open Folder…
      </Button>
      {recent.length > 0 && (
        <div className="mt-3 flex flex-col gap-0.5">
          {recent.slice(0, 3).map((r) => (
            <button
              key={r.path}
              type="button"
              title={r.path}
              onClick={() => void useWorkspaceStore.getState().openWorkspace(r.path)}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] text-muted hover:bg-hover hover:text-fg"
            >
              <FolderOpen size={13} className="shrink-0 text-subtle" />
              <span className="shrink-0 text-fg">{r.name}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-subtle">{r.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function RecentChats({ chatId }: { chatId: string }) {
  const sessions = useSessionHistory((s) => s.sessions)
  const current = useAgentStore((s) => s.chats[chatId]?.sessionId ?? s.chats[chatId]?.resumeSessionId ?? null)

  useEffect(() => {
    void useSessionHistory.getState().refresh()
  }, [])

  const recent = sessions.filter((s) => s.sessionId !== current).slice(0, 3)
  if (!recent.length) return null
  const now = Date.now()
  return (
    <div className="mt-5 w-full">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-subtle">Recent chats</span>
        <button type="button" onClick={showHistoryView} className="flex items-center gap-1 text-[11px] text-muted hover:text-fg">
          <History size={11} /> View all
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        {recent.map((s) => (
          <button
            key={s.sessionId}
            type="button"
            title={s.firstPrompt ?? s.title}
            onClick={() => useAgentStore.getState().resumeSession(s.sessionId, s.title)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <MessageSquare size={12} className="shrink-0 text-subtle" />
            <span className="min-w-0 flex-1 truncate text-fg">{s.title || 'Untitled chat'}</span>
            <span className="shrink-0 text-[11px] text-subtle">{relativeTime(s.lastModified, now)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
