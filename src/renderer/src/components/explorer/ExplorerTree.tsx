import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import {
  AtSign,
  ChevronRight,
  ClipboardCopy,
  Copy,
  ExternalLink,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  SquareTerminal,
  Trash
} from 'lucide-react'
import type { FileEntry } from '@shared/types'
import { dirname, isInside, normalizeSlashes } from '@shared/paths'
import { cn } from '../../lib/cn'
import { FileIcon } from '../../lib/file-icons'
import { useEditorStore } from '../../stores/editor'
import { buildDecorationMap, TONE_TEXT, useGitStore, type GitDecoration } from '../../stores/git'
import { Menu, useContextMenu, type MenuEntry } from '../ui'
import {
  addToChat,
  copyPath,
  copyRelativePath,
  createEntry,
  deleteEntry,
  moveEntry,
  openInTerminal,
  renameEntry,
  revealInOs,
  revealLabel,
  startNewFile,
  validateName
} from './explorerActions'
import { useExplorerStore, type ExplorerEditing } from './explorerStore'
import { InlineNameInput } from './InlineNameInput'

const ROW_H = 22
const INDENT = 12
const VIRTUALIZE_THRESHOLD = 2000
const DRAG_MIME = 'application/x-atom-path'

/** Return keyboard focus to the tree after inline editing ends. */
function focusTree(): void {
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-explorer-tree]')?.focus())
}

type Row =
  | { type: 'entry'; key: string; entry: FileEntry; depth: number; expanded: boolean }
  | { type: 'input'; key: string; kind: 'new-file' | 'new-folder'; parent: string; depth: number }

function buildRows(root: string, children: Record<string, FileEntry[]>, expanded: Record<string, boolean>, editing: ExplorerEditing | null): Row[] {
  const rows: Row[] = []
  const walk = (dir: string, depth: number): void => {
    if (editing && editing.kind !== 'rename' && editing.parent === dir) {
      rows.push({ type: 'input', key: `__input:${dir}`, kind: editing.kind, parent: dir, depth })
    }
    const list = children[dir]
    if (!list) return
    for (const entry of list) {
      const isOpen = entry.isDirectory && !!expanded[entry.path]
      rows.push({ type: 'entry', key: entry.path, entry, depth, expanded: isOpen })
      if (isOpen) walk(entry.path, depth + 1)
    }
  }
  walk(root, 0)
  return rows
}

export function ExplorerTree({ root }: { root: string }) {
  const children = useExplorerStore((s) => s.children)
  const expanded = useExplorerStore((s) => s.expanded)
  const editing = useExplorerStore((s) => s.editing)
  const selected = useExplorerStore((s) => s.selected)
  const loading = useExplorerStore((s) => s.loading)
  const dropTarget = useExplorerStore((s) => s.dropTarget)
  const revealNonce = useExplorerStore((s) => s.revealNonce)
  const gitStatus = useGitStore((s) => s.status)
  const activePath = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    return tab && tab.kind !== 'welcome' ? tab.path : null
  })

  const rows = useMemo(() => buildRows(root, children, expanded, editing), [root, children, expanded, editing])
  const decorations = useMemo(() => buildDecorationMap(gitStatus, root), [gitStatus, root])

  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ top: 0, height: 600 })
  const [focused, setFocused] = useState(false)
  const ctx = useContextMenu()
  const [ctxEntry, setCtxEntry] = useState<FileEntry | null>(null)
  const hoverExpandTimer = useRef<{ path: string; timer: ReturnType<typeof setTimeout> } | null>(null)

  const virtual = rows.length > VIRTUALIZE_THRESHOLD

  // Track viewport for windowing.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = (): void => setViewport({ top: el.scrollTop, height: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const indexOf = useCallback((path: string | null) => (path ? rows.findIndex((r) => r.type === 'entry' && r.entry.path === path) : -1), [rows])

  const scrollToIndex = useCallback((index: number) => {
    const el = scrollRef.current
    if (!el || index < 0) return
    const top = index * ROW_H
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight
  }, [])

  // Scroll the selection into view when asked (reveal active file, keyboard navigation, create/rename).
  useEffect(() => {
    if (revealNonce === 0) return
    const i = indexOf(useExplorerStore.getState().selected)
    if (i >= 0) {
      const el = scrollRef.current
      // Center the row when it is far away (like VS Code's reveal).
      if (el && (i * ROW_H < el.scrollTop || i * ROW_H > el.scrollTop + el.clientHeight - ROW_H)) {
        el.scrollTop = Math.max(0, i * ROW_H - el.clientHeight / 2)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealNonce])

  // Keep the inline input visible.
  useEffect(() => {
    if (!editing) return
    const i = rows.findIndex((r) => (r.type === 'input' ? true : editing.kind === 'rename' && r.entry.path === editing.path))
    if (i >= 0) scrollToIndex(i)
  }, [editing, rows, scrollToIndex])

  // ── Opening & selection ────────────────────────────────────────────────────

  const openEntry = useCallback((entry: FileEntry, preview: boolean, focus = true) => {
    void useEditorStore.getState().openFile(entry.path, { preview, focus })
  }, [])

  const onRowClick = useCallback(
    (entry: FileEntry, e: MouseEvent) => {
      const store = useExplorerStore.getState()
      store.select(entry.path)
      if (entry.isDirectory) {
        store.toggle(entry.path)
      } else if (e.detail <= 1) {
        openEntry(entry, true, false)
      }
    },
    [openEntry]
  )

  const onRowDoubleClick = useCallback(
    (entry: FileEntry) => {
      if (!entry.isDirectory) openEntry(entry, false, true)
    },
    [openEntry]
  )

  // `useContextMenu` returns a fresh object each render; read it through a ref so rows stay memoized.
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const onRowContextMenu = useCallback((entry: FileEntry | null, e: MouseEvent) => {
    if (entry) useExplorerStore.getState().select(entry.path)
    setCtxEntry(entry)
    ctxRef.current.onContextMenu(e)
  }, [])

  // ── Keyboard navigation ───────────────────────────────────────────────────

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return
    const store = useExplorerStore.getState()
    const entryRows = rows.filter((r): r is Extract<Row, { type: 'entry' }> => r.type === 'entry')
    if (entryRows.length === 0) return
    const cur = entryRows.findIndex((r) => r.entry.path === store.selected)
    const row = cur >= 0 ? entryRows[cur] : null
    const selectAt = (i: number): void => {
      const target = entryRows[Math.max(0, Math.min(entryRows.length - 1, i))]
      store.select(target.entry.path)
      scrollToIndex(indexOf(target.entry.path))
    }
    const mod = e.metaKey || e.ctrlKey
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        selectAt(cur + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        selectAt(cur < 0 ? 0 : cur - 1)
        break
      case 'Home':
        e.preventDefault()
        selectAt(0)
        break
      case 'End':
        e.preventDefault()
        selectAt(entryRows.length - 1)
        break
      case 'PageDown':
        e.preventDefault()
        selectAt(cur + Math.floor(viewport.height / ROW_H))
        break
      case 'PageUp':
        e.preventDefault()
        selectAt(cur - Math.floor(viewport.height / ROW_H))
        break
      case 'ArrowRight':
        e.preventDefault()
        if (!row) return selectAt(0)
        if (row.entry.isDirectory) {
          if (!row.expanded) void store.expand(row.entry.path)
          else if (entryRows[cur + 1] && entryRows[cur + 1].depth > row.depth) selectAt(cur + 1)
        }
        break
      case 'ArrowLeft': {
        e.preventDefault()
        if (!row) return selectAt(0)
        if (row.entry.isDirectory && row.expanded) store.collapse(row.entry.path)
        else {
          const parent = dirname(row.entry.path)
          const pi = entryRows.findIndex((r) => r.entry.path === parent)
          if (pi >= 0) selectAt(pi)
        }
        break
      }
      case 'Enter':
        e.preventDefault()
        if (!row) return
        if (row.entry.isDirectory) store.toggle(row.entry.path)
        else openEntry(row.entry, false, true)
        break
      case ' ':
        e.preventDefault()
        if (!row) return
        if (row.entry.isDirectory) store.toggle(row.entry.path)
        else openEntry(row.entry, true, false)
        break
      case 'F2':
        e.preventDefault()
        if (row) store.startEdit({ kind: 'rename', path: row.entry.path })
        break
      case 'Delete':
        e.preventDefault()
        if (row) void deleteEntry(row.entry)
        break
      case 'Backspace':
        if (mod && row) {
          e.preventDefault()
          void deleteEntry(row.entry)
        }
        break
      case 'Escape':
        store.select(null)
        break
      default:
        // Type-to-select: jump to the next entry starting with the typed character.
        if (e.key.length === 1 && !mod && !e.altKey && /\S/.test(e.key)) {
          const ch = e.key.toLowerCase()
          for (let k = 1; k <= entryRows.length; k++) {
            const r = entryRows[(Math.max(cur, 0) + k) % entryRows.length]
            if (r.entry.name.toLowerCase().startsWith(ch)) {
              selectAt(entryRows.indexOf(r))
              break
            }
          }
        }
    }
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────

  const clearHoverExpand = (): void => {
    if (hoverExpandTimer.current) clearTimeout(hoverExpandTimer.current.timer)
    hoverExpandTimer.current = null
  }

  const onDragStart = useCallback((entry: FileEntry, e: DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, entry.path)
    e.dataTransfer.setData('text/plain', entry.path)
    e.dataTransfer.effectAllowed = 'copyMove'
  }, [])

  const onDragOverTarget = useCallback((dir: string, e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const store = useExplorerStore.getState()
    store.setDropTarget(dir)
    // Hovering a collapsed folder for a moment expands it (VS Code behaviour).
    if (dir !== root && !store.expanded[dir]) {
      if (hoverExpandTimer.current?.path !== dir) {
        clearHoverExpand()
        hoverExpandTimer.current = { path: dir, timer: setTimeout(() => void useExplorerStore.getState().expand(dir), 650) }
      }
    } else clearHoverExpand()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  const onDropTarget = useCallback((dir: string, e: DragEvent) => {
    const source = e.dataTransfer.getData(DRAG_MIME)
    useExplorerStore.getState().setDropTarget(null)
    clearHoverExpand()
    if (!source) return
    e.preventDefault()
    e.stopPropagation()
    void moveEntry(source, dir)
  }, [])

  // ── Context menu ──────────────────────────────────────────────────────────

  const ctxEntries: MenuEntry[] = useMemo(() => {
    const entry = ctxEntry
    const folder = entry ? (entry.isDirectory ? entry.path : dirname(entry.path)) : root
    const base: MenuEntry[] = [
      { id: 'new-file', label: 'New File…', icon: <FilePlus size={14} />, onSelect: () => startNewFile('new-file', folder) },
      { id: 'new-folder', label: 'New Folder…', icon: <FolderPlus size={14} />, onSelect: () => startNewFile('new-folder', folder) }
    ]
    if (!entry) {
      return [
        ...base,
        { type: 'separator', id: 's1' },
        { id: 'refresh', label: 'Refresh', icon: <RefreshCw size={14} />, onSelect: () => void useExplorerStore.getState().refreshAll() },
        { id: 'reveal', label: revealLabel, icon: <FolderOpen size={14} />, onSelect: () => revealInOs(root) },
        { id: 'chat', label: 'Add Folder to ATOM Chat', icon: <AtSign size={14} />, onSelect: () => addToChat({ path: root, isDirectory: true }) }
      ]
    }
    return [
      ...(entry.isDirectory
        ? base
        : [
            { id: 'open', label: 'Open', icon: <ExternalLink size={14} />, onSelect: () => openEntry(entry, false, true) } satisfies MenuEntry,
            { type: 'separator', id: 's0' } satisfies MenuEntry,
            ...base
          ]),
      { type: 'separator', id: 's1' },
      { id: 'chat', label: 'Add to ATOM Chat', icon: <AtSign size={14} />, shortcut: undefined, onSelect: () => addToChat(entry) },
      { id: 'terminal', label: 'Open in Integrated Terminal', icon: <SquareTerminal size={14} />, onSelect: () => void openInTerminal(entry) },
      { id: 'reveal', label: revealLabel, icon: <FolderOpen size={14} />, onSelect: () => revealInOs(entry.path) },
      { type: 'separator', id: 's2' },
      { id: 'copy-path', label: 'Copy Path', icon: <Copy size={14} />, onSelect: () => void copyPath(entry.path) },
      { id: 'copy-rel', label: 'Copy Relative Path', icon: <ClipboardCopy size={14} />, onSelect: () => void copyRelativePath(entry.path) },
      { type: 'separator', id: 's3' },
      {
        id: 'rename',
        label: 'Rename…',
        icon: <Pencil size={14} />,
        shortcut: 'f2',
        onSelect: () => useExplorerStore.getState().startEdit({ kind: 'rename', path: entry.path })
      },
      { id: 'delete', label: 'Delete', icon: <Trash size={14} />, danger: true, shortcut: 'delete', onSelect: () => void deleteEntry(entry) }
    ]
  }, [ctxEntry, root, openEntry])

  // ── Render ────────────────────────────────────────────────────────────────

  const total = rows.length * ROW_H
  let start = 0
  let end = rows.length
  if (virtual) {
    start = Math.max(0, Math.floor(viewport.top / ROW_H) - 20)
    end = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / ROW_H) + 20)
  }
  const visible = rows.slice(start, end)
  const activeNorm = activePath ? normalizeSlashes(activePath) : null

  return (
    <>
      <div
        ref={scrollRef}
        tabIndex={0}
        data-explorer-tree
        role="tree"
        aria-label="Files"
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onScroll={(e) => virtual && setViewport({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
        onContextMenu={(e) => onRowContextMenu(null, e)}
        onDragOver={(e) => onDragOverTarget(root, e)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            useExplorerStore.getState().setDropTarget(null)
            clearHoverExpand()
          }
        }}
        onDrop={(e) => onDropTarget(root, e)}
        className={cn(
          'group/tree relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-6 outline-none',
          dropTarget === root && 'bg-accent-soft/40 ring-1 ring-inset ring-accent/50'
        )}
      >
        <div style={{ height: virtual ? total : undefined, position: 'relative' }}>
          <div style={virtual ? { position: 'absolute', top: start * ROW_H, left: 0, right: 0 } : undefined}>
            {visible.map((row) =>
              row.type === 'input' ? (
                <InputRow key={row.key} row={row} />
              ) : (
                <TreeRow
                  key={row.key}
                  entry={row.entry}
                  depth={row.depth}
                  expanded={row.expanded}
                  loading={!!loading[row.entry.path]}
                  selected={selected === row.entry.path}
                  focused={focused}
                  active={activeNorm === normalizeSlashes(row.entry.path)}
                  renaming={editing?.kind === 'rename' && editing.path === row.entry.path}
                  dropTarget={dropTarget !== null && dropTarget !== root && row.entry.isDirectory && dropTarget === row.entry.path}
                  inDropTarget={dropTarget !== null && dropTarget !== root && isInside(dropTarget, row.entry.path) && dropTarget !== row.entry.path}
                  decoration={
                    row.entry.isDirectory ? decorations.folders.get(normalizeSlashes(row.entry.path)) : decorations.files.get(normalizeSlashes(row.entry.path))
                  }
                  onClick={onRowClick}
                  onDoubleClick={onRowDoubleClick}
                  onContextMenu={onRowContextMenu}
                  onDragStart={onDragStart}
                  onDragOver={onDragOverTarget}
                  onDrop={onDropTarget}
                />
              )
            )}
          </div>
        </div>
      </div>
      <Menu {...ctx.props} entries={ctxEntries} minWidth={230} />
    </>
  )
}

function InputRow({ row }: { row: Extract<Row, { type: 'input' }> }) {
  return (
    <div className="flex h-[22px] items-center gap-1 pr-2" style={{ paddingLeft: 8 + row.depth * INDENT + 16 }}>
      <FileIcon name={row.kind === 'new-folder' ? 'folder' : 'untitled'} isDirectory={row.kind === 'new-folder'} size={15} />
      <InlineNameInput
        validate={(v) => validateName(v, row.parent)}
        onCommit={(name) => {
          useExplorerStore.getState().startEdit(null)
          void createEntry(row.kind, row.parent, name)
        }}
        onCancel={(viaKeyboard) => {
          useExplorerStore.getState().startEdit(null)
          if (viaKeyboard) focusTree()
        }}
      />
    </div>
  )
}

interface TreeRowProps {
  entry: FileEntry
  depth: number
  expanded: boolean
  loading: boolean
  selected: boolean
  focused: boolean
  active: boolean
  renaming: boolean
  dropTarget: boolean
  inDropTarget: boolean
  decoration: GitDecoration | undefined
  onClick(entry: FileEntry, e: MouseEvent): void
  onDoubleClick(entry: FileEntry): void
  onContextMenu(entry: FileEntry, e: MouseEvent): void
  onDragStart(entry: FileEntry, e: DragEvent): void
  onDragOver(dir: string, e: DragEvent): void
  onDrop(dir: string, e: DragEvent): void
}

const TreeRow = memo(function TreeRow({
  entry,
  depth,
  expanded,
  loading,
  selected,
  focused,
  active,
  renaming,
  dropTarget,
  inDropTarget,
  decoration,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop
}: TreeRowProps) {
  const dropDir = entry.isDirectory ? entry.path : dirname(entry.path)
  const tone = decoration ? TONE_TEXT[decoration.tone] : null
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={entry.isDirectory ? expanded : undefined}
      draggable={!renaming}
      title={entry.path}
      onClick={(e) => onClick(entry, e)}
      onDoubleClick={() => onDoubleClick(entry)}
      onContextMenu={(e) => onContextMenu(entry, e)}
      onDragStart={(e) => onDragStart(entry, e)}
      onDragOver={(e) => onDragOver(dropDir, e)}
      onDrop={(e) => onDrop(dropDir, e)}
      className={cn(
        'relative flex h-[22px] cursor-pointer items-center gap-1 pr-2 text-[13px] leading-[22px]',
        selected ? (focused ? 'bg-accent-soft outline outline-1 -outline-offset-1 outline-accent/60' : 'bg-active') : 'hover:bg-hover',
        dropTarget && 'bg-accent-soft outline outline-1 -outline-offset-1 outline-accent/70',
        inDropTarget && 'bg-accent-soft/50'
      )}
      style={{ paddingLeft: 8 + depth * INDENT }}
    >
      {/* Indent guides */}
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute bottom-0 top-0 w-px bg-line opacity-0 transition-opacity duration-150 group-hover/tree:opacity-100"
          style={{ left: 8 + i * INDENT + 7 }}
        />
      ))}
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-subtle">
        {entry.isDirectory &&
          (loading ? (
            <span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
          ) : (
            <ChevronRight size={14} className={cn('transition-transform duration-100', expanded && 'rotate-90')} />
          ))}
      </span>
      <FileIcon name={entry.name} isDirectory={entry.isDirectory} open={expanded} size={15} />
      {renaming ? (
        <InlineNameInput
          initial={entry.name}
          validate={(v) => validateName(v, dirname(entry.path), entry.name)}
          onCommit={(name, viaKeyboard) => {
            useExplorerStore.getState().startEdit(null)
            void renameEntry(entry.path, name).then(() => viaKeyboard && focusTree())
          }}
          onCancel={(viaKeyboard) => {
            useExplorerStore.getState().startEdit(null)
            if (viaKeyboard) focusTree()
          }}
        />
      ) : (
        <>
          <span className={cn('min-w-0 flex-1 truncate', tone ?? (active ? 'text-fg' : 'text-fg/90'), entry.isSymlink && 'italic')}>{entry.name}</span>
          {decoration &&
            (entry.isDirectory ? (
              <span className={cn('mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80', tone)} title="Contains changes" />
            ) : (
              <span className={cn('w-3 shrink-0 text-center text-[11px] font-semibold', tone)} title={decoration.label}>
                {decoration.letter}
              </span>
            ))}
        </>
      )}
    </div>
  )
})
