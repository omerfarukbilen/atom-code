import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, CornerDownLeft, FileSearch, FolderOpen, Hash, SquareChevronRight, TextCursorInput } from 'lucide-react'
import { basename, relativePath } from '@shared/paths'
import { cn } from '../../lib/cn'
import { FileIcon } from '../../lib/file-icons'
import { fuzzyFilter } from '../../lib/fuzzy'
import { executeCommand, listCommands, type Command } from '../../stores/commands'
import { useEditorStore } from '../../stores/editor'
import { useLayoutStore } from '../../stores/layout'
import { useWorkspaceStore } from '../../stores/workspace'
import { Kbd, Spinner } from '../ui'
import { COMMAND_ICONS } from './command-icons'
import { Highlight } from './Highlight'

/**
 * Command palette / quick open (one overlay, mode chosen by the first character):
 *   (none) files · `>` commands · `:` go to line · `?` help
 */
type Mode = 'files' | 'commands' | 'line' | 'help'

interface PaletteItem {
  id: string
  section?: string
  icon: ReactNode
  label: string
  labelPositions?: number[]
  /** Characters of the label rendered muted (command category prefix). */
  labelMutedUntil?: number
  detail?: string
  detailPositions?: number[]
  keybinding?: string
  /** Keep the palette open after running (help items switch the prefix). */
  keepOpen?: boolean
  run(): void
}

const RECENT_COMMANDS_KEY = 'atom.palette.recentCommands'
const RECENT_FILES_KEY = 'atom.palette.recentFiles:'

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function pushRecent(key: string, value: string, max: number): void {
  try {
    const list = [value, ...readList(key).filter((v) => v !== value)].slice(0, max)
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    /* storage unavailable */
  }
}

/** Remember a file opened through quick open (shown first next time). */
export function rememberRecentFile(root: string, path: string): void {
  pushRecent(RECENT_FILES_KEY + root, path, 30)
}

function modeOf(value: string): Mode {
  if (value.startsWith('>')) return 'commands'
  if (value.startsWith(':')) return 'line'
  if (value.startsWith('?')) return 'help'
  return 'files'
}

const PLACEHOLDERS: Record<Mode, string> = {
  files: 'Search files by name (append :line to jump, type > for commands)',
  commands: 'Type the name of a command to run',
  line: 'Type a line number, optionally :column',
  help: 'Choose what to do'
}

export function CommandPalette() {
  const open = useLayoutStore((s) => s.commandPaletteOpen)
  const prefix = useLayoutStore((s) => s.commandPalettePrefix)
  if (!open) return null
  return createPortal(<PaletteInner key={prefix} initial={prefix} />, document.body)
}

function commandIcon(cmd: Command): ReactNode {
  const Icon = cmd.icon ? COMMAND_ICONS[cmd.icon] : undefined
  return Icon ? <Icon size={15} strokeWidth={1.75} className="text-muted" /> : <SquareChevronRight size={15} strokeWidth={1.75} className="text-subtle" />
}

function PaletteInner({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null)
  const mouseMoved = useRef(false)
  const close = useLayoutStore((s) => s.closeCommandPalette)

  const workspace = useWorkspaceStore((s) => s.workspace)
  const files = useWorkspaceStore((s) => s.files)
  const filesLoading = useWorkspaceStore((s) => s.filesLoading)
  const mode = modeOf(value)
  const query = mode === 'files' ? value : value.slice(1)

  useEffect(() => {
    inputRef.current?.focus()
    // Place the caret after the prefix.
    const len = inputRef.current?.value.length ?? 0
    inputRef.current?.setSelectionRange(len, len)
  }, [])

  const fileEntries = useMemo(() => (workspace ? files.map((abs) => ({ abs, rel: relativePath(workspace.path, abs) })) : []), [files, workspace])

  const dismiss = (restore: boolean): void => {
    close()
    if (restore) requestAnimationFrame(() => restoreFocus.current?.focus?.())
  }

  const items: PaletteItem[] = useMemo(() => {
    if (mode === 'help') {
      const go = (p: string) => () => {
        setValue(p)
        setActive(0)
        inputRef.current?.focus()
      }
      return [
        { id: 'h-files', icon: <FileSearch size={15} className="text-muted" />, label: 'Go to File', detail: 'type a file name', keybinding: 'mod+p', keepOpen: true, run: go('') },
        { id: 'h-cmd', icon: <ChevronRight size={15} className="text-muted" />, label: '>  Show and Run Commands', keybinding: 'mod+shift+p', keepOpen: true, run: go('>') },
        { id: 'h-line', icon: <Hash size={15} className="text-muted" />, label: ':  Go to Line', keepOpen: true, run: go(':') }
      ]
    }

    if (mode === 'commands') {
      const commands = listCommands()
      const recentIds = readList(RECENT_COMMANDS_KEY)
      const recentRank = new Map(recentIds.map((id, i) => [id, i]))
      const toItem = (c: Command, section: string | undefined, positions?: number[]): PaletteItem => {
        const label = c.category ? `${c.category}: ${c.title}` : c.title
        return {
          id: `cmd:${c.id}`,
          section,
          icon: commandIcon(c),
          label,
          labelPositions: positions,
          labelMutedUntil: c.category ? c.category.length + 1 : 0,
          keybinding: c.keybinding,
          run: () => {
            pushRecent(RECENT_COMMANDS_KEY, c.id, 12)
            void executeCommand(c.id)
          }
        }
      }
      if (!query.trim()) {
        const recent = commands.filter((c) => recentRank.has(c.id)).sort((a, b) => (recentRank.get(a.id) ?? 0) - (recentRank.get(b.id) ?? 0))
        const rest = commands.filter((c) => !recentRank.has(c.id))
        return [...recent.map((c) => toItem(c, 'recently used')), ...rest.map((c) => toItem(c, recent.length ? 'other commands' : 'all commands'))]
      }
      const matches = fuzzyFilter(commands, query, (c) => (c.category ? `${c.category}: ${c.title}` : c.title))
      // Small boost for recently used commands.
      matches.sort((a, b) => b.score + (recentRank.has(b.item.id) ? 12 : 0) - (a.score + (recentRank.has(a.item.id) ? 12 : 0)))
      return matches.slice(0, 80).map((m) => toItem(m.item, undefined, m.positions))
    }

    if (mode === 'line') {
      const info = useEditorStore.getState().getActiveEditorInfo()
      if (!info) return [{ id: 'line-none', icon: <Hash size={15} className="text-subtle" />, label: 'Open a text editor first to go to a line.', keepOpen: true, run: () => undefined }]
      const m = /^\s*(\d+)(?:\s*[:,]\s*(\d+))?\s*$/.exec(query)
      if (!m) {
        return [
          {
            id: 'line-hint',
            icon: <Hash size={15} className="text-subtle" />,
            label: `Current line: ${info.line}, column ${info.column}. Type a line number to navigate to.`,
            detail: basename(info.path),
            keepOpen: true,
            run: () => undefined
          }
        ]
      }
      const line = Math.max(1, Number(m[1]))
      const column = m[2] ? Math.max(1, Number(m[2])) : undefined
      return [
        {
          id: 'line-go',
          icon: <TextCursorInput size={15} className="text-accent" />,
          label: column ? `Go to line ${line}, column ${column}` : `Go to line ${line}`,
          detail: basename(info.path),
          run: () => void useEditorStore.getState().openFile(info.path, { line, column, focus: true })
        }
      ]
    }

    // Files (quick open)
    if (!workspace) {
      return [
        {
          id: 'open-folder',
          icon: <FolderOpen size={15} className="text-accent" />,
          label: 'Open Folder…',
          detail: 'Quick open searches the files of the open folder',
          keybinding: 'mod+o',
          run: () => void useWorkspaceStore.getState().openFolderDialog()
        }
      ]
    }
    const root = workspace.path
    const lineMatch = /^(.*?):(\d+)(?::(\d+))?$/.exec(query.trim())
    const fileQuery = lineMatch ? lineMatch[1] : query.trim()
    const line = lineMatch ? Number(lineMatch[2]) : undefined
    const column = lineMatch?.[3] ? Number(lineMatch[3]) : undefined
    const openPath = (abs: string, pinned = true) => () => {
      rememberRecentFile(root, abs)
      void useEditorStore.getState().openFile(abs, { line, column, preview: !pinned, focus: true })
    }
    const fileItem = (abs: string, rel: string, positions: number[] | undefined, section?: string): PaletteItem => {
      const name = basename(rel)
      const dirLen = rel.length - name.length
      const dir = rel.slice(0, Math.max(0, dirLen - 1))
      return {
        id: `file:${abs}`,
        section,
        icon: <FileIcon name={name} size={16} />,
        label: name,
        labelPositions: positions?.filter((p) => p >= dirLen).map((p) => p - dirLen),
        detail: dir,
        detailPositions: positions?.filter((p) => p < dirLen - 1),
        run: openPath(abs)
      }
    }

    if (!fileQuery) {
      const { tabs, activeTabId } = useEditorStore.getState()
      const openTabs = tabs.filter((t) => t.kind === 'file' && t.id !== activeTabId).map((t) => t.path)
      const recent = readList(RECENT_FILES_KEY + root)
      const seen = new Set<string>()
      const list: string[] = []
      for (const p of [...openTabs, ...recent]) {
        if (seen.has(p) || list.length >= 15) continue
        seen.add(p)
        list.push(p)
      }
      return list.map((abs) => fileItem(abs, relativePath(root, abs), undefined, 'recently opened'))
    }

    const matches = fuzzyFilter(fileEntries, fileQuery, (e) => e.rel, { path: true, limit: 60 })
    return matches.map((m) => fileItem(m.item.abs, m.item.rel, m.positions, undefined))
  }, [mode, query, workspace, fileEntries])

  // Reset selection when results change.
  useEffect(() => setActive(0), [mode, query])

  // Keep the active row visible.
  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const runItem = (item: PaletteItem | undefined): void => {
    if (!item) return
    if (item.keepOpen) {
      item.run()
      return
    }
    dismiss(false)
    // Let the overlay unmount before the action moves focus.
    setTimeout(() => item.run(), 0)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    const n = items.length
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      mouseMoved.current = false
      setActive((a) => (n ? (a + 1) % n : 0))
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey && !e.metaKey)) {
      e.preventDefault()
      mouseMoved.current = false
      setActive((a) => (n ? (a - 1 + n) % n : 0))
    } else if (e.key === 'PageDown') {
      e.preventDefault()
      setActive((a) => Math.min(n - 1, a + 10))
    } else if (e.key === 'PageUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 10))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      runItem(items[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      dismiss(true)
    }
  }

  const showIndexing = mode === 'files' && !!workspace && filesLoading && files.length === 0
  const empty = items.length === 0

  return (
    <div className="fixed inset-0 z-[150] flex justify-center px-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && dismiss(true)}>
      <div role="dialog" aria-label="Command palette" className="flex max-h-[min(560px,72vh)] w-full max-w-[620px] flex-col overflow-hidden rounded-xl border border-line-strong bg-overlay shadow-pop animate-fade-in">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
          <ModeChip mode={mode} />
          <input
            ref={inputRef}
            value={value}
            spellCheck={false}
            autoComplete="off"
            placeholder={PLACEHOLDERS[mode]}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={(e) => {
              // Clicking outside the palette closes it (but not clicks inside the list).
              if (!e.relatedTarget || !(e.currentTarget.closest('[role="dialog"]')?.contains(e.relatedTarget as Node) ?? false)) {
                requestAnimationFrame(() => {
                  if (document.activeElement !== inputRef.current && useLayoutStore.getState().commandPaletteOpen) dismiss(false)
                })
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-subtle"
          />
          {showIndexing && <Spinner size={12} className="text-subtle" />}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5" onMouseMove={() => (mouseMoved.current = true)}>
          {showIndexing ? (
            <div className="px-3 py-6 text-center text-[12.5px] text-muted">Indexing files…</div>
          ) : empty ? (
            <div className="px-3 py-6 text-center text-[12.5px] text-muted">
              {mode === 'files' && !query.trim() ? 'Type to search files in this folder.' : 'No matching results'}
            </div>
          ) : (
            items.map((item, i) => {
              const header = item.section && item.section !== items[i - 1]?.section ? item.section : null
              return (
                <div key={item.id}>
                  {header && <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle first:pt-1">{header}</div>}
                  <button
                    type="button"
                    data-index={i}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => mouseMoved.current && active !== i && setActive(i)}
                    onClick={() => runItem(item)}
                    className={cn(
                      'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left',
                      i === active ? 'bg-accent-soft text-fg' : 'text-fg hover:bg-hover'
                    )}
                  >
                    <span className="flex w-4 shrink-0 items-center justify-center">{item.icon}</span>
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <Highlight text={item.label} positions={item.labelPositions} mutedUntil={item.labelMutedUntil} className="shrink-0 truncate text-[13px]" />
                      {item.detail && <Highlight text={item.detail} positions={item.detailPositions} className="min-w-0 truncate text-[11.5px] text-subtle" />}
                    </span>
                    {item.keybinding && <Kbd keys={item.keybinding} className="shrink-0" />}
                    {i === active && !item.keybinding && <CornerDownLeft size={13} className="shrink-0 text-subtle" />}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-[11px] text-subtle">
          <span className="flex items-center gap-1">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">↵</kbd> {mode === 'files' ? 'open' : 'run'}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">esc</kbd> close
          </span>
          <span className="ml-auto">
            {mode === 'files' ? (
              <>
                <span className="text-muted">&gt;</span> commands · <span className="text-muted">:</span> line · <span className="text-muted">?</span> help
              </>
            ) : (
              <>delete the prefix to search files</>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

function ModeChip({ mode }: { mode: Mode }) {
  const map: Record<Mode, { icon: ReactNode; label: string }> = {
    files: { icon: <FileSearch size={13} />, label: 'Files' },
    commands: { icon: <ChevronRight size={13} />, label: 'Commands' },
    line: { icon: <Hash size={13} />, label: 'Line' },
    help: { icon: <ChevronRight size={13} />, label: 'Help' }
  }
  const m = map[mode]
  return (
    <span className="flex h-[22px] shrink-0 items-center gap-1 rounded-md bg-accent-soft px-1.5 text-[11px] font-medium text-accent">
      {m.icon}
      {m.label}
    </span>
  )
}
