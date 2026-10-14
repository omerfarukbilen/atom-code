import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Ellipsis,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  GitBranchPlus,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  Undo2
} from 'lucide-react'
import type { GitCommitInfo, GitFileChange } from '@shared/types'
import { basename } from '@shared/paths'
import { atom } from '../../lib/api'
import { cn } from '../../lib/cn'
import { FileIcon } from '../../lib/file-icons'
import { formatKeybinding } from '../../lib/platform'
import { decorationFor, stagedDecorationFor, TONE_TEXT, useGitStore } from '../../stores/git'
import { toast } from '../../stores/toast'
import { useWorkspaceStore } from '../../stores/workspace'
import { Button, EmptyState, IconButton, Input, Menu, Modal, Spinner, useMenu, type MenuEntry } from '../ui'
import { ViewHeader } from '../workbench/ViewHeader'
import { discardChanges, openChangeDiff, openChangeFile } from './gitActions'

export function GitView() {
  const workspace = useWorkspaceStore((s) => s.workspace)
  const status = useGitStore((s) => s.status)
  const loading = useGitStore((s) => s.loading)
  const busy = useGitStore((s) => s.busy)

  if (!workspace) {
    return (
      <Shell>
        <EmptyState
          icon={<GitBranch size={26} strokeWidth={1.5} />}
          title="No folder opened"
          description="Open a folder that contains a Git repository to stage changes, commit and sync."
          action={
            <Button size="sm" variant="primary" onClick={() => void useWorkspaceStore.getState().openFolderDialog()}>
              Open Folder
            </Button>
          }
        />
      </Shell>
    )
  }
  if (!status) {
    return (
      <Shell>
        <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-muted">
          <Spinner size={12} /> Reading repository…
        </div>
      </Shell>
    )
  }
  if (!status.isRepo) {
    return (
      <Shell>
        <EmptyState
          icon={<GitBranch size={26} strokeWidth={1.5} />}
          title="No Git repository"
          description="This folder isn't tracked by Git yet. Initialize a repository to track changes, review diffs and let ATOM write your commit messages."
          action={
            <Button size="sm" variant="primary" loading={busy === 'init'} icon={<GitBranchPlus size={14} />} onClick={() => void useGitStore.getState().init()}>
              Initialize Repository
            </Button>
          }
        />
      </Shell>
    )
  }
  return <RepoView loading={loading} />
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader title="Source Control" />
      {children}
    </div>
  )
}

function RepoView({ loading }: { loading: boolean }) {
  const status = useGitStore((s) => s.status)
  const busy = useGitStore((s) => s.busy)
  const more = useMenu('bottom-end')
  const files = useMemo(() => status?.files ?? [], [status])
  const staged = useMemo(() => files.filter((f) => f.staged), [files])
  const changes = useMemo(() => files.filter((f) => f.untracked || f.workingTree !== ' ' || f.conflicted), [files])
  const [branchModal, setBranchModal] = useState(false)

  const moreEntries: MenuEntry[] = [
    { id: 'pull', label: 'Pull', icon: <ArrowDown size={14} />, onSelect: () => void useGitStore.getState().pull() },
    { id: 'push', label: 'Push', icon: <ArrowUp size={14} />, onSelect: () => void useGitStore.getState().push() },
    { type: 'separator', id: 's1' },
    { id: 'commit-all', label: 'Commit All', icon: <Check size={14} />, onSelect: () => void useGitStore.getState().commit({ all: true }) },
    { id: 'amend', label: 'Commit (Amend)', icon: <Check size={14} />, onSelect: () => void useGitStore.getState().commit({ amend: true }) },
    { type: 'separator', id: 's2' },
    { id: 'stage-all', label: 'Stage All Changes', icon: <Plus size={14} />, disabled: changes.length === 0, onSelect: () => void useGitStore.getState().stageAll() },
    { id: 'unstage-all', label: 'Unstage All Changes', icon: <Minus size={14} />, disabled: staged.length === 0, onSelect: () => void useGitStore.getState().unstageAll() },
    { id: 'discard-all', label: 'Discard All Changes…', icon: <Undo2 size={14} />, danger: true, disabled: changes.length === 0, onSelect: () => void discardChanges(changes) },
    { type: 'separator', id: 's3' },
    { id: 'branch', label: 'Create Branch…', icon: <GitBranchPlus size={14} />, onSelect: () => setBranchModal(true) }
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader
        title="Source Control"
        alwaysShowActions
        actions={
          <>
            {loading && <Spinner size={11} className="mr-1 text-subtle" />}
            <IconButton title="Refresh" icon={<RefreshCw size={14} />} onClick={() => void useGitStore.getState().refresh()} />
            <IconButton title="More Actions…" icon={<Ellipsis size={15} />} active={more.open} onClick={more.openFromEvent} />
          </>
        }
      />
      <Menu {...more.props} entries={moreEntries} minWidth={220} />

      <BranchBar onCreateBranch={() => setBranchModal(true)} />
      <CommitBox stagedCount={staged.length} changeCount={files.length} />

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {files.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-6 text-center">
            <Check size={18} className="text-success" />
            <div className="text-[12.5px] text-fg">Working tree clean</div>
            <div className="text-[11.5px] text-subtle">No changes since the last commit.</div>
          </div>
        ) : (
          <>
            {staged.length > 0 && (
              <ChangeGroup
                id="staged"
                title="Staged Changes"
                count={staged.length}
                actions={<IconButton size="xs" title="Unstage All Changes" icon={<Minus size={13} />} onClick={() => void useGitStore.getState().unstageAll()} />}
              >
                {staged.map((c) => (
                  <ChangeRow key={`s:${c.path}`} change={c} staged />
                ))}
              </ChangeGroup>
            )}
            {changes.length > 0 && (
              <ChangeGroup
                id="changes"
                title="Changes"
                count={changes.length}
                actions={
                  <>
                    <IconButton size="xs" title="Discard All Changes" icon={<Undo2 size={13} />} disabled={busy === 'discard'} onClick={() => void discardChanges(changes)} />
                    <IconButton size="xs" title="Stage All Changes" icon={<Plus size={13} />} onClick={() => void useGitStore.getState().stageAll()} />
                  </>
                }
              >
                {changes.map((c) => (
                  <ChangeRow key={`w:${c.path}`} change={c} staged={false} />
                ))}
              </ChangeGroup>
            )}
          </>
        )}
        <CommitHistory />
      </div>

      <CreateBranchModal open={branchModal} onClose={() => setBranchModal(false)} />
    </div>
  )
}

// ── Branch bar ──────────────────────────────────────────────────────────────

function BranchBar({ onCreateBranch }: { onCreateBranch(): void }) {
  const status = useGitStore((s) => s.status)
  const branches = useGitStore((s) => s.branches)
  const busy = useGitStore((s) => s.busy)
  const menu = useMenu('bottom-start')

  const entries: MenuEntry[] = useMemo(() => {
    const local = branches.filter((b) => !b.remote)
    const remote = branches.filter((b) => b.remote && !/\/HEAD$/.test(b.name))
    const localNames = new Set(local.map((b) => b.name))
    const out: MenuEntry[] = [
      { id: 'create', label: 'Create new branch…', icon: <GitBranchPlus size={14} />, onSelect: onCreateBranch },
      { type: 'separator', id: 's0' }
    ]
    if (local.length) out.push({ type: 'header', id: 'h-local', label: 'Branches' })
    for (const b of local) {
      out.push({
        id: `l:${b.name}`,
        label: b.name,
        icon: <GitBranch size={13} />,
        checked: b.current,
        onSelect: () => !b.current && void useGitStore.getState().checkout(b.name)
      })
    }
    const remoteOnly = remote.filter((b) => !localNames.has(b.name.replace(/^remotes\//, '').replace(/^[^/]+\//, '')))
    if (remoteOnly.length) out.push({ type: 'header', id: 'h-remote', label: 'Remote branches' })
    for (const b of remoteOnly.slice(0, 40)) {
      const display = b.name.replace(/^remotes\//, '')
      out.push({
        id: `r:${b.name}`,
        label: display,
        icon: <Cloud size={13} />,
        onSelect: () => void useGitStore.getState().checkout(display.replace(/^[^/]+\//, ''))
      })
    }
    if (branches.length === 0) out.push({ id: 'loading', label: 'Loading branches…', disabled: true })
    return out
  }, [branches, onCreateBranch])

  if (!status) return null
  const syncing = busy === 'push' || busy === 'pull'
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 px-3">
      <button
        type="button"
        title="Switch branch"
        onClick={(e) => {
          void useGitStore.getState().loadBranches()
          menu.openFromEvent(e)
        }}
        className={cn('flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] text-fg hover:bg-hover', menu.open && 'bg-active')}
      >
        {busy === 'checkout' ? <Spinner size={12} /> : <GitBranch size={14} className="shrink-0 text-accent" />}
        <span className="truncate font-medium">{status.branch ?? 'detached HEAD'}</span>
        <ChevronDown size={12} className="shrink-0 text-subtle" />
      </button>
      <Menu {...menu.props} entries={entries} minWidth={240} className="max-h-[50vh]" />
      <div className="flex-1" />
      {status.tracking ? (
        <div className="flex items-center gap-0.5 text-[11.5px] text-muted">
          <SyncButton
            title={`Pull${status.behind ? ` (${status.behind} incoming)` : ''}`}
            icon={<ArrowDown size={13} />}
            count={status.behind}
            busy={busy === 'pull'}
            disabled={syncing}
            onClick={() => void useGitStore.getState().pull()}
          />
          <SyncButton
            title={`Push${status.ahead ? ` (${status.ahead} outgoing)` : ''}`}
            icon={<ArrowUp size={13} />}
            count={status.ahead}
            busy={busy === 'push'}
            disabled={syncing}
            onClick={() => void useGitStore.getState().push()}
          />
        </div>
      ) : (
        <Button
          size="xs"
          variant="ghost"
          icon={busy === 'push' ? <Spinner size={11} /> : <Cloud size={13} />}
          title="Publish this branch to the remote"
          disabled={syncing}
          onClick={() => void useGitStore.getState().push()}
        >
          Publish
        </Button>
      )}
    </div>
  )
}

function SyncButton({ title, icon, count, busy, disabled, onClick }: { title: string; icon: ReactNode; count: number; busy: boolean; disabled: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn('flex h-6 items-center gap-0.5 rounded-md px-1.5 hover:bg-hover hover:text-fg disabled:opacity-50', count > 0 && 'text-accent')}
    >
      {busy ? <Spinner size={11} /> : icon}
      {count > 0 && <span className="tabular-nums">{count}</span>}
    </button>
  )
}

// ── Commit box ──────────────────────────────────────────────────────────────

function CommitBox({ stagedCount, changeCount }: { stagedCount: number; changeCount: number }) {
  const message = useGitStore((s) => s.commitMessage)
  const setMessage = useGitStore((s) => s.setCommitMessage)
  const busy = useGitStore((s) => s.busy)
  const branch = useGitStore((s) => s.status?.branch)
  const menu = useMenu('bottom-end')
  const generating = busy === 'generate'
  const committing = busy === 'commit'
  const commitAll = stagedCount === 0
  const label = commitAll ? 'Commit All' : 'Commit'

  const entries: MenuEntry[] = [
    { id: 'commit', label: 'Commit Staged', disabled: stagedCount === 0, shortcut: 'mod+enter', onSelect: () => void useGitStore.getState().commit() },
    { id: 'all', label: 'Commit All', description: 'Stage every change, then commit', onSelect: () => void useGitStore.getState().commit({ all: true }) },
    { id: 'push', label: 'Commit & Push', onSelect: () => void useGitStore.getState().commit({ push: true }) },
    { type: 'separator', id: 's' },
    { id: 'amend', label: 'Amend Last Commit', description: 'Keeps the last message when the box is empty', onSelect: () => void useGitStore.getState().commit({ amend: true }) }
  ]

  return (
    <div className="shrink-0 space-y-1.5 px-3 pb-3">
      <div className="relative">
        <textarea
          value={message}
          spellCheck={false}
          placeholder={`Message (${formatKeybinding('mod+enter')} to commit on "${branch ?? 'HEAD'}")`}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              e.stopPropagation()
              void useGitStore.getState().commit()
            }
          }}
          disabled={generating}
          className={cn(
            'field-sizing-content block max-h-[220px] min-h-[60px] w-full resize-none rounded-md border border-line bg-input py-2 pl-2.5 pr-8 text-[12.5px] leading-relaxed text-fg outline-none transition-colors placeholder:text-subtle focus:border-accent',
            generating && 'opacity-60'
          )}
        />
        <button
          type="button"
          title="Generate commit message with ATOM"
          aria-label="Generate commit message with ATOM"
          disabled={generating || changeCount === 0}
          onClick={() => void useGitStore.getState().generateMessage()}
          className={cn(
            'absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-accent transition-colors hover:bg-accent-soft disabled:opacity-40',
            generating && 'opacity-100'
          )}
        >
          {generating ? <Spinner size={12} /> : <Sparkles size={14} />}
        </button>
      </div>
      <div className="flex">
        <Button
          variant="primary"
          size="sm"
          className="flex-1 rounded-r-none"
          loading={committing}
          disabled={changeCount === 0 && !message}
          icon={<Check size={14} />}
          title={commitAll ? 'No staged changes — stages everything and commits' : `Commit ${stagedCount} staged file(s)`}
          onClick={() => void useGitStore.getState().commit()}
        >
          {label}
        </Button>
        <button
          type="button"
          title="More commit actions"
          aria-label="More commit actions"
          onClick={menu.openFromEvent}
          className="flex h-7 w-7 items-center justify-center rounded-r-md border-l border-accent-fg/20 bg-accent text-accent-fg hover:bg-accent-hover"
        >
          <ChevronDown size={14} />
        </button>
        <Menu {...menu.props} entries={entries} minWidth={240} />
      </div>
    </div>
  )
}

// ── Change list ─────────────────────────────────────────────────────────────

const collapsedGroups: Record<string, boolean> = {}

function ChangeGroup({ id, title, count, actions, children }: { id: string; title: string; count: number; actions: ReactNode; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(!!collapsedGroups[id])
  useEffect(() => {
    collapsedGroups[id] = collapsed
  }, [id, collapsed])
  return (
    <div className="mb-1">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        className="group flex h-[22px] items-center gap-1 pl-1.5 pr-3 outline-none hover:bg-hover focus-visible:bg-active"
        onClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
          e.preventDefault()
          setCollapsed(!collapsed)
        }}
      >
        <ChevronRight size={14} className={cn('shrink-0 text-subtle transition-transform duration-100', !collapsed && 'rotate-90')} />
        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{title}</span>
        <span className="flex items-center gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
        <span className="ml-1 rounded-full bg-active px-1.5 text-[10.5px] font-medium leading-4 text-muted">{count}</span>
      </div>
      {!collapsed && children}
    </div>
  )
}

const ChangeRow = memo(function ChangeRow({ change, staged }: { change: GitFileChange; staged: boolean }) {
  const deco = staged ? stagedDecorationFor(change) : decorationFor(change)
  const name = basename(change.relativePath)
  const dir = change.relativePath.slice(0, Math.max(0, change.relativePath.length - name.length - 1))
  const deleted = deco.letter === 'D'
  return (
    <div
      role="button"
      tabIndex={0}
      title={`${change.relativePath} • ${deco.label}${staged ? ' (staged)' : ''}`}
      onClick={() => void openChangeDiff(change)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          void openChangeDiff(change)
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const sibling = e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling
          if (sibling instanceof HTMLElement) sibling.focus()
        }
      }}
      className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-6 pr-3 text-[13px] outline-none hover:bg-hover focus-visible:bg-active"
    >
      <FileIcon name={name} size={15} />
      <span className={cn('shrink-0 truncate', deleted ? 'text-muted line-through' : 'text-fg')}>{name}</span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-subtle">{dir}</span>
      <span className="hidden shrink-0 items-center gap-0.5 group-focus-within:flex group-hover:flex" onClick={(e) => e.stopPropagation()}>
        {!deleted && <IconButton size="xs" title="Open File" icon={<FileText size={13} />} onClick={() => void openChangeFile(change)} />}
        {staged ? (
          <IconButton size="xs" title="Unstage Changes" icon={<Minus size={13} />} onClick={() => void useGitStore.getState().unstage([change.path])} />
        ) : (
          <>
            <IconButton size="xs" title={change.untracked ? 'Delete Untracked File' : 'Discard Changes'} icon={<Undo2 size={13} />} onClick={() => void discardChanges([change])} />
            <IconButton size="xs" title="Stage Changes" icon={<Plus size={13} />} onClick={() => void useGitStore.getState().stage([change.path])} />
          </>
        )}
      </span>
      <span className={cn('w-3 shrink-0 text-center text-[11px] font-semibold', TONE_TEXT[deco.tone])}>{deco.letter}</span>
    </div>
  )
})

// ── Commit history ──────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  const units: [number, string][] = [
    [60, 'min'],
    [3600, 'h'],
    [86400, 'd'],
    [604800, 'w'],
    [2592000, 'mo'],
    [31536000, 'y']
  ]
  let label = ''
  for (const [secs, unit] of units) if (s >= secs) label = `${Math.floor(s / secs)}${unit === 'min' ? ' min' : unit}`
  return `${label} ago`
}

/** Collapsible list of recent commits (loaded on demand, refreshed when the repo changes). */
function CommitHistory() {
  const [open, setOpen] = useState(false)
  const [commits, setCommits] = useState<GitCommitInfo[] | null>(null)
  const status = useGitStore((s) => s.status)
  const root = useWorkspaceStore((s) => s.workspace?.path ?? null)
  const head = `${status?.branch ?? ''}:${status?.ahead ?? 0}:${status?.behind ?? 0}:${status?.files.length ?? 0}`

  useEffect(() => {
    if (!open || !root) return
    let cancelled = false
    atom.git
      .log(root, 30)
      .then((list) => !cancelled && setCommits(list))
      .catch(() => !cancelled && setCommits([]))
    return () => {
      cancelled = true
    }
  }, [open, root, head])

  return (
    <div className="mt-1 border-t border-line pt-1">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        className="flex h-[22px] cursor-pointer items-center gap-1 pl-1.5 pr-3 outline-none hover:bg-hover focus-visible:bg-active"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          setOpen(!open)
        }}
      >
        <ChevronRight size={14} className={cn('shrink-0 text-subtle transition-transform duration-100', open && 'rotate-90')} />
        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Commits</span>
      </div>
      {open &&
        (commits === null ? (
          <div className="flex items-center gap-2 px-6 py-1.5 text-[12px] text-subtle">
            <Spinner size={10} /> Loading…
          </div>
        ) : commits.length === 0 ? (
          <div className="px-6 py-1.5 text-[12px] text-subtle">No commits yet.</div>
        ) : (
          commits.map((c, i) => (
            <div
              key={c.hash}
              role="button"
              tabIndex={-1}
              title={`${c.message}\n\n${c.author} · ${new Date(c.date).toLocaleString()}\n${c.hash} — click to copy`}
              onClick={() =>
                void navigator.clipboard.writeText(c.hash).then(
                  () => toast.success('Commit hash copied', c.shortHash),
                  () => undefined
                )
              }
              className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-6 pr-3 text-[12.5px] hover:bg-hover"
            >
              <GitCommitHorizontal size={13} className={cn('shrink-0', i === 0 ? 'text-accent' : 'text-subtle')} />
              <span className="min-w-0 flex-1 truncate text-fg">{c.message.split('\n')[0]}</span>
              <span className="shrink-0 text-[11px] text-subtle">{relativeTime(c.date)}</span>
            </div>
          ))
        ))}
    </div>
  )
}

// ── Create branch ───────────────────────────────────────────────────────────

function CreateBranchModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const [name, setName] = useState('')
  const valid = /^(?!\/|.*\/\/|.*\.\.|.*\/$|.*\.lock$|.*[\s~^:?*[\\])[^\0]{1,200}$/.test(name)
  useEffect(() => {
    if (open) setName('')
  }, [open])
  const submit = (): void => {
    if (!valid) return
    onClose()
    void useGitStore.getState().createBranch(name.trim())
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create branch"
      description="The new branch starts from the current HEAD and is checked out immediately."
      width="max-w-md"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!valid} onClick={submit}>
            Create Branch
          </Button>
        </>
      }
    >
      <div className="px-5 py-4">
        <Input
          autoFocus
          value={name}
          placeholder="feature/my-change"
          icon={<GitBranch size={14} />}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
        {name && !valid && <div className="mt-1.5 text-[11.5px] text-danger">Not a valid branch name.</div>}
      </div>
    </Modal>
  )
}
