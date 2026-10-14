import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bot, ChevronRight, Copy, FileText, FolderGit2, FolderOpen, Plus, RefreshCw, Search, Slash, Sparkles, Trash2, User, X, Eye, EyeOff, ClipboardCopy } from 'lucide-react'
import type { LibraryKind, LibraryScope } from '@shared/types'
import { AtomLogo, Button, EmptyState, IconButton, Input, Menu, Spinner, confirmDialog, useMenu, type MenuEntry } from '../ui'
import { libraryKindOf, useLibraryStore, type LibraryItemInfo, type WritableScope } from '../../stores/library'
import { useSettingsStore } from '../../stores/settings'
import { useWorkspaceStore } from '../../stores/workspace'
import { useEditorStore } from '../../stores/editor'
import { errorMessage, toast } from '../../stores/toast'
import { atom } from '../../lib/api'
import { cn } from '../../lib/cn'
import { ViewHeader } from '../workbench/ViewHeader'
import { LibraryItem } from './LibraryItem'
import { NewSkillDialog } from './NewSkillDialog'
import { KIND_LABELS } from './templates'

const TABS: { kind: LibraryKind; label: string; icon: ReactNode }[] = [
  { kind: 'skill', label: 'Skills', icon: <Sparkles size={12} /> },
  { kind: 'agent', label: 'Agents', icon: <Bot size={12} /> },
  { kind: 'command', label: 'Commands', icon: <Slash size={12} /> }
]

const SCOPES: { scope: LibraryScope; label: string; icon: ReactNode }[] = [
  { scope: 'atom', label: 'ATOM built-in', icon: <AtomLogo size={12} /> },
  { scope: 'user', label: 'User', icon: <User size={12} /> },
  { scope: 'project', label: 'Project', icon: <FolderGit2 size={12} /> }
]

const EMPTY_COPY: Record<LibraryKind, { title: string; description: string }> = {
  skill: {
    title: 'No skills yet',
    description: 'Skills teach ATOM reusable workflows. ATOM loads a skill automatically when its description matches your task.'
  },
  agent: {
    title: 'No subagents yet',
    description: 'Subagents are specialists ATOM can delegate to — each with its own system prompt, tools and model, running in a separate context.'
  },
  command: {
    title: 'No slash commands yet',
    description: 'Slash commands are reusable prompts. Type / in the chat to run one; $ARGUMENTS is replaced with whatever you type after the command.'
  }
}

const COLLAPSE_KEY = 'atom.skills.collapsed.v1'
const TAB_KEY = 'atom.skills.tab.v1'

function loadCollapsed(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    // Keep only boolean flags: corrupt / foreign values must not break the panel.
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'))
  } catch {
    return {}
  }
}

function loadTab(): LibraryKind {
  try {
    const v = localStorage.getItem(TAB_KEY)
    return v === 'agent' || v === 'command' ? v : 'skill'
  } catch {
    return 'skill'
  }
}

let readOnlyHintShown = false

/** Sidebar view: browse, toggle, create and edit skills, subagents and slash commands. */
export function SkillsPanel() {
  const index = useLibraryStore((s) => s.index)
  const loading = useLibraryStore((s) => s.loading)
  const error = useLibraryStore((s) => s.error)
  const indexedFor = useLibraryStore((s) => s.workspace)
  const refresh = useLibraryStore((s) => s.refresh)
  const disabledSkills = useSettingsStore((s) => s.settings.agent.disabledSkills)
  const workspace = useWorkspaceStore((s) => s.workspace)

  const [tab, setTab] = useState<LibraryKind>(loadTab)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed)
  const [newDialog, setNewDialog] = useState<{ kind: LibraryKind; scope: WritableScope } | null>(null)
  const folderMenu = useMenu('top-start')
  const closeNewDialog = useCallback(() => setNewDialog(null), [])

  const wsPath = workspace?.path ?? null
  useEffect(() => {
    if ((!index && !loading) || (index && indexedFor !== wsPath)) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsPath])

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab)
    } catch {
      /* ignore */
    }
  }, [tab])

  const toggleGroup = (key: string): void => {
    setCollapsed((c) => {
      const next = { ...c, [key]: !c[key] }
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const items: LibraryItemInfo[] = useMemo(() => {
    if (!index) return []
    return tab === 'skill' ? index.skills : tab === 'agent' ? index.agents : index.commands
  }, [index, tab])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? items.filter((i) => `${i.name} ${i.qualifiedName} ${i.description}`.toLowerCase().includes(q)) : items),
    [items, q]
  )

  const counts = {
    skill: index?.skills.length ?? 0,
    agent: index?.agents.length ?? 0,
    command: index?.commands.length ?? 0
  }

  const openItem = async (item: LibraryItemInfo): Promise<void> => {
    try {
      await useEditorStore.getState().openFile(item.path)
      if (item.readOnly && !readOnlyHintShown) {
        readOnlyHintShown = true
        toast.show({
          kind: 'info',
          message: 'Built-in items are read-only',
          detail: 'Duplicate it to your user scope to customise it — ATOM updates may overwrite edits to bundled files.',
          action: { label: 'Duplicate to user scope', run: () => void duplicate(item) }
        })
      }
    } catch (err) {
      toast.error('Could not open file', errorMessage(err))
    }
  }

  const duplicate = async (item: LibraryItemInfo): Promise<void> => {
    try {
      const path = await useLibraryStore.getState().duplicateToUser(item)
      toast.success(`Copied “${item.name}” to your user ${KIND_LABELS[libraryKindOf(item)].plural.toLowerCase()}`)
      await useEditorStore.getState().openFile(path)
    } catch (err) {
      toast.error('Could not duplicate', errorMessage(err))
    }
  }

  const remove = async (item: LibraryItemInfo): Promise<void> => {
    const kind = libraryKindOf(item)
    const ok = await confirmDialog({
      title: `Delete ${KIND_LABELS[kind].singular.toLowerCase()} “${item.name}”?`,
      message: kind === 'skill' ? 'The skill folder (including bundled files) is moved to the trash.' : 'The file is moved to the trash.',
      confirmLabel: 'Move to Trash',
      danger: true
    })
    if (!ok) return
    try {
      await useLibraryStore.getState().deleteItem(item.path)
      toast.success(`Deleted “${item.name}”`)
    } catch (err) {
      toast.error('Could not delete', errorMessage(err))
    }
  }

  const toggleSkill = (qualifiedName: string, enabled: boolean): void => {
    useLibraryStore
      .getState()
      .toggleSkill(qualifiedName, enabled)
      .catch((err: unknown) => toast.error('Could not update skill', errorMessage(err)))
  }

  const menuFor = (item: LibraryItemInfo, kind: LibraryKind, enabled: boolean): MenuEntry[] => {
    const entries: MenuEntry[] = [
      { id: 'open', label: 'Open', icon: <FileText size={13} />, onSelect: () => void openItem(item) },
      ...(item.readOnly ? [{ id: 'dup', label: 'Duplicate to user scope', icon: <Copy size={13} />, onSelect: () => void duplicate(item) }] : []),
      { id: 'reveal', label: 'Reveal in folder', icon: <FolderOpen size={13} />, onSelect: () => void atom.app.showItemInFolder(item.path) },
      {
        id: 'copy',
        label: kind === 'command' ? `Copy /${item.qualifiedName}` : `Copy “${item.qualifiedName}”`,
        icon: <ClipboardCopy size={13} />,
        onSelect: () => void navigator.clipboard.writeText(kind === 'command' ? `/${item.qualifiedName}` : item.qualifiedName)
      }
    ]
    if (kind === 'skill') {
      entries.push({ type: 'separator', id: 'sep1' })
      entries.push({
        id: 'toggle',
        label: enabled ? 'Disable for the agent' : 'Enable for the agent',
        icon: enabled ? <EyeOff size={13} /> : <Eye size={13} />,
        onSelect: () => toggleSkill(item.qualifiedName, !enabled)
      })
    }
    if (!item.readOnly) {
      entries.push({ type: 'separator', id: 'sep2' })
      entries.push({ id: 'delete', label: 'Delete…', icon: <Trash2 size={13} />, danger: true, onSelect: () => void remove(item) })
    }
    return entries
  }

  const openFolder = (scope: LibraryScope): void => {
    atom.library.openFolder(scope, wsPath).catch((err: unknown) => toast.error('Could not open folder', errorMessage(err)))
  }

  const folderEntries: MenuEntry[] = [
    { type: 'header', id: 'h', label: 'Open folder' },
    { id: 'user', label: 'User (~/.claude)', icon: <User size={13} />, onSelect: () => openFolder('user') },
    { id: 'project', label: 'Project (.claude)', icon: <FolderGit2 size={13} />, disabled: !wsPath, onSelect: () => openFolder('project') },
    { id: 'atom', label: 'ATOM built-in', icon: <AtomLogo size={13} />, onSelect: () => openFolder('atom') }
  ]

  const tabLabel = KIND_LABELS[tab]
  const noItemsAtAll = !!index && items.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      {/* Header */}
      <ViewHeader
        title="Skills Library"
        alwaysShowActions
        actions={
          <>
            <IconButton title={`New ${tabLabel.singular.toLowerCase()}`} icon={<Plus size={14} />} onClick={() => setNewDialog({ kind: tab, scope: 'user' })} />
            <IconButton title="Refresh" icon={<RefreshCw size={13} className={cn(loading && 'animate-spin')} />} onClick={() => void refresh()} disabled={loading} />
          </>
        }
      />

      {/* Tabs */}
      <div className="flex shrink-0 gap-0.5 px-2 pb-2">
        {TABS.map((t) => {
          const selected = t.kind === tab
          return (
            <button
              key={t.kind}
              type="button"
              onClick={() => setTab(t.kind)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] font-medium transition-colors',
                selected ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg'
              )}
            >
              {t.icon}
              <span className="truncate">{t.label}</span>
              <span className={cn('rounded px-1 text-[10.5px] tabular-nums', selected ? 'bg-accent-soft text-accent' : 'bg-hover text-subtle')}>{counts[t.kind]}</span>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="shrink-0 px-2 pb-2">
        <Input
          inputSize="sm"
          icon={<Search size={13} />}
          placeholder={`Search ${tabLabel.plural.toLowerCase()}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          right={
            query ? (
              <button type="button" title="Clear search" onClick={() => setQuery('')} className="text-subtle hover:text-fg">
                <X size={12} />
              </button>
            ) : undefined
          }
        />
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {error && (
          <div className="mx-2 mb-2 rounded-md border border-line bg-danger-soft px-2.5 py-2 text-[12px] text-danger">
            <div className="font-medium">Could not load the library</div>
            <div className="selectable mt-0.5 break-words opacity-90">{error}</div>
            <button type="button" className="mt-1 font-medium underline" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}

        {!index && loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted">
            <Spinner size={12} /> Loading library…
          </div>
        ) : noItemsAtAll && !q ? (
          <EmptyState
            icon={TABS.find((t) => t.kind === tab)?.icon}
            title={EMPTY_COPY[tab].title}
            description={EMPTY_COPY[tab].description}
            action={
              <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setNewDialog({ kind: tab, scope: 'user' })}>
                New {tabLabel.singular.toLowerCase()}
              </Button>
            }
          />
        ) : q && filtered.length === 0 ? (
          <EmptyState icon={<Search size={18} />} title="No matches" description={`No ${tabLabel.plural.toLowerCase()} match “${query.trim()}”.`} />
        ) : (
          SCOPES.map(({ scope, label, icon }) => {
            if (scope === 'project' && !workspace) return null
            const group = filtered.filter((i) => i.scope === scope)
            if (q && group.length === 0) return null
            const key = `${tab}:${scope}`
            const isCollapsed = !q && !!collapsed[key]
            const enabledCount = tab === 'skill' ? group.filter((i) => !disabledSkills.includes(i.qualifiedName)).length : null
            return (
              <div key={scope} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(key)}
                  className="group flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-subtle hover:text-muted"
                >
                  <ChevronRight size={12} className={cn('transition-transform duration-100', !isCollapsed && 'rotate-90')} />
                  <span className="flex items-center opacity-90">{icon}</span>
                  <span className="truncate">{label}</span>
                  <span className="ml-auto font-normal normal-case tabular-nums">
                    {enabledCount !== null && enabledCount !== group.length ? `${enabledCount}/${group.length}` : group.length}
                  </span>
                </button>
                {!isCollapsed &&
                  (group.length === 0 ? (
                    <ScopeHint scope={scope} kind={tab} onCreate={() => setNewDialog({ kind: tab, scope: scope === 'project' ? 'project' : 'user' })} />
                  ) : (
                    group.map((item) => {
                      const enabled = tab === 'skill' ? !disabledSkills.includes(item.qualifiedName) : true
                      return (
                        <LibraryItem
                          key={item.path}
                          item={item}
                          kind={tab}
                          enabled={enabled}
                          onToggle={tab === 'skill' ? (v) => toggleSkill(item.qualifiedName, v) : undefined}
                          onOpen={() => void openItem(item)}
                          menuEntries={menuFor(item, tab, enabled)}
                          query={q}
                        />
                      )
                    })
                  ))}
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center gap-1 border-t border-line px-2 py-1.5">
        <button
          type="button"
          onClick={folderMenu.openFromEvent}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <FolderOpen size={13} />
          <span className="truncate">Open {tabLabel.plural.toLowerCase()} folder</span>
        </button>
        <span className="pr-1 text-[10.5px] text-subtle" title="Skills are hidden from the agent when disabled">
          {tab === 'skill' && index ? `${index.skills.filter((s) => !disabledSkills.includes(s.qualifiedName)).length} active` : ''}
        </span>
      </div>
      <Menu {...folderMenu.props} entries={folderEntries} />

      <NewSkillDialog
        open={newDialog !== null}
        onClose={closeNewDialog}
        initialKind={newDialog?.kind ?? tab}
        initialScope={newDialog?.scope ?? 'user'}
      />
    </div>
  )
}

function ScopeHint({ scope, kind, onCreate }: { scope: LibraryScope; kind: LibraryKind; onCreate(): void }) {
  const label = KIND_LABELS[kind]
  if (scope === 'atom') return <div className="px-4 py-1.5 pl-8 text-[11.5px] text-subtle">No built-in {label.plural.toLowerCase()}.</div>
  const where = scope === 'user' ? `~/.claude/${label.folder}` : `.claude/${label.folder}`
  return (
    <div className="px-4 py-1.5 pl-8 text-[11.5px] leading-relaxed text-subtle">
      {scope === 'user' ? `Personal ${label.plural.toLowerCase()} in ${where} work in every project.` : `Project ${label.plural.toLowerCase()} live in ${where} — commit them to share.`}{' '}
      <button type="button" className="font-medium text-accent hover:underline" onClick={onCreate}>
        Create one
      </button>
    </div>
  )
}
