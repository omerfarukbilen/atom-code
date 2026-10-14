import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Copy,
  FolderSearch,
  GitCompare,
  Home,
  MessageSquarePlus,
  MoreHorizontal,
  Pin,
  Sparkles,
  X,
  XSquare
} from 'lucide-react'
import { dirname, normalizeSlashes } from '@shared/paths'
import type { EditorTab } from '../../stores/contracts'
import { atom } from '../../lib/api'
import { cn } from '../../lib/cn'
import { FileIcon } from '../../lib/file-icons'
import { formatKeybinding, isMac, isWindows } from '../../lib/platform'
import { useEditorStore } from '../../stores/editor'
import { useSettingsStore } from '../../stores/settings'
import { IconButton, Menu, useContextMenu, useMenu, type MenuEntry } from '../ui'
import { addToChat, copyPath, revealInExplorer, startInlineEdit } from './commands'

const TAB_MIME = 'application/x-atom-tab'
const revealOsLabel = isMac ? 'Reveal in Finder' : isWindows ? 'Reveal in File Explorer' : 'Open Containing Folder'

/** Parent folder labels for tabs that share a file name ("index.ts  src/app" vs "index.ts  src/lib"). */
function disambiguate(tabs: EditorTab[]): Record<string, string> {
  const byName = new Map<string, EditorTab[]>()
  for (const t of tabs) {
    if (t.kind !== 'file' && t.kind !== 'image') continue
    const list = byName.get(t.title) ?? []
    list.push(t)
    byName.set(t.title, list)
  }
  const out: Record<string, string> = {}
  for (const list of byName.values()) {
    if (list.length < 2) continue
    const segs = list.map((t) => normalizeSlashes(dirname(t.path)).split('/').filter(Boolean))
    for (let i = 0; i < list.length; i++) {
      // Use the shortest suffix of parent folders that is unique among the duplicates.
      let depth = 1
      while (depth < segs[i].length) {
        const mine = segs[i].slice(-depth).join('/')
        if (segs.every((s, j) => j === i || s.slice(-depth).join('/') !== mine)) break
        depth++
      }
      out[list[i].id] = (segs[i].length > depth ? '…/' : '') + segs[i].slice(-depth).join('/')
    }
  }
  return out
}

function TabIcon({ tab }: { tab: EditorTab }) {
  if (tab.kind === 'welcome') return <Home size={14} className="shrink-0 text-accent" />
  if (tab.kind === 'diff') return <GitCompare size={14} className="shrink-0 text-warning" />
  return <FileIcon name={tab.path} size={14} />
}

export function EditorTabs() {
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const deleted = useEditorStore((s) => s.deleted)
  const wordWrap = useSettingsStore((s) => s.settings.editor.wordWrap)
  const minimap = useSettingsStore((s) => s.settings.editor.minimap)
  const scrollRef = useRef<HTMLDivElement>(null)
  const ctx = useContextMenu()
  const more = useMenu('bottom-end')
  const [menuTabId, setMenuTabId] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; over: string | null; side: 'before' | 'after' } | null>(null)
  const descriptions = useMemo(() => disambiguate(tabs), [tabs])
  const active = tabs.find((t) => t.id === activeTabId) ?? null

  // Keep the active tab visible.
  useEffect(() => {
    if (!activeTabId) return
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId, tabs.length])

  // Vertical wheel scrolls the strip horizontally.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const store = useEditorStore.getState
  const menuTab = tabs.find((t) => t.id === menuTabId) ?? null

  const tabMenu = (tab: EditorTab | null): MenuEntry[] => {
    if (!tab) return []
    const idx = tabs.findIndex((t) => t.id === tab.id)
    const onDisk = tab.kind === 'file' || tab.kind === 'image'
    return [
      { id: 'close', label: 'Close', shortcut: 'mod+w', icon: <X size={14} />, onSelect: () => void store().closeTab(tab.id) },
      { id: 'close-others', label: 'Close Others', disabled: tabs.length < 2, onSelect: () => void store().closeOthers(tab.id) },
      { id: 'close-right', label: 'Close to the Right', disabled: idx === tabs.length - 1, onSelect: () => void store().closeToRight(tab.id) },
      { id: 'close-saved', label: 'Close Saved', onSelect: () => void store().closeSaved() },
      { id: 'close-all', label: 'Close All', icon: <XSquare size={14} />, onSelect: () => void store().closeAll() },
      { type: 'separator', id: 's1' },
      ...(tab.preview ? [{ id: 'keep', label: 'Keep Open', icon: <Pin size={14} />, onSelect: () => store().pinTab(tab.id) } as MenuEntry] : []),
      { id: 'copy-path', label: 'Copy Path', icon: <Copy size={14} />, disabled: tab.kind === 'welcome', onSelect: () => copyPath(tab.path, false) },
      { id: 'copy-rel', label: 'Copy Relative Path', disabled: tab.kind === 'welcome', onSelect: () => copyPath(tab.path, true) },
      { type: 'separator', id: 's2' },
      { id: 'reveal', label: 'Reveal in Explorer View', icon: <FolderSearch size={14} />, disabled: !onDisk, onSelect: () => revealInExplorer(tab.path) },
      { id: 'reveal-os', label: revealOsLabel, disabled: !onDisk, onSelect: () => void atom.app.showItemInFolder(tab.path) },
      { type: 'separator', id: 's3' },
      {
        id: 'chat',
        label: 'Add to Chat',
        icon: <MessageSquarePlus size={14} />,
        disabled: !onDisk && tab.kind !== 'diff',
        onSelect: () => addToChat(tab.path)
      }
    ]
  }

  const onTabMouseDown = (e: ReactMouseEvent, tab: EditorTab): void => {
    if (e.button === 1) {
      e.preventDefault() // no autoscroll cursor
      return
    }
    if (e.button === 0) store().setActive(tab.id)
  }

  const onDragStart = (e: DragEvent, tab: EditorTab): void => {
    e.dataTransfer.setData(TAB_MIME, tab.id)
    if (tab.kind !== 'welcome') e.dataTransfer.setData('text/plain', tab.path)
    e.dataTransfer.effectAllowed = 'copyMove'
    setDrag({ id: tab.id, over: null, side: 'before' })
  }

  const onDragOver = (e: DragEvent, tab: EditorTab): void => {
    if (!e.dataTransfer.types.includes(TAB_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const side = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
    setDrag((d) => (d && (d.over !== tab.id || d.side !== side) ? { ...d, over: tab.id, side } : d))
  }

  const onDrop = (e: DragEvent, target: EditorTab | null): void => {
    const id = e.dataTransfer.getData(TAB_MIME)
    setDrag(null)
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    const list = store().tabs
    if (!target) {
      store().moveTab(id, list.length)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientX >= rect.left + rect.width / 2
    const idx = list.findIndex((t) => t.id === target.id)
    store().moveTab(id, after ? idx + 1 : idx)
  }

  const moreEntries: MenuEntry[] = [
    { id: 'wrap', label: 'Word Wrap', checked: wordWrap, shortcut: 'alt+z', onSelect: () => void useSettingsStore.getState().update({ editor: { wordWrap: !wordWrap } }) },
    { id: 'minimap', label: 'Minimap', checked: minimap, onSelect: () => void useSettingsStore.getState().update({ editor: { minimap: !minimap } }) },
    { type: 'separator', id: 'm1' },
    { id: 'reopen', label: 'Reopen Closed Editor', shortcut: 'mod+shift+t', disabled: !store().recentlyClosed.length, onSelect: () => void store().reopenClosed() },
    { id: 'close-saved', label: 'Close Saved', onSelect: () => void store().closeSaved() },
    { id: 'close-all', label: 'Close All', onSelect: () => void store().closeAll() }
  ]

  return (
    <div className="flex h-[35px] shrink-0 items-stretch border-b border-line bg-sidebar">
      <div
        ref={scrollRef}
        role="tablist"
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(TAB_MIME)) e.preventDefault()
        }}
        onDrop={(e) => onDrop(e, null)}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) store().openNewFileDialog()
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const isDeleted = !!deleted[tab.id]
          const desc = descriptions[tab.id]
          const showIndicator = drag && drag.over === tab.id && drag.id !== tab.id
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              role="tab"
              aria-selected={isActive}
              draggable
              title={tab.kind === 'welcome' ? 'Welcome' : `${tab.path}${tab.dirty ? ' • unsaved' : ''}${isDeleted ? ' • deleted on disk' : ''}`}
              onMouseDown={(e) => onTabMouseDown(e, tab)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  void store().closeTab(tab.id)
                }
              }}
              onDoubleClick={() => store().pinTab(tab.id)}
              onContextMenu={(e) => {
                setMenuTabId(tab.id)
                ctx.onContextMenu(e)
              }}
              onDragStart={(e) => onDragStart(e, tab)}
              onDragOver={(e) => onDragOver(e, tab)}
              onDragLeave={() => setDrag((d) => (d && d.over === tab.id ? { ...d, over: null } : d))}
              onDrop={(e) => onDrop(e, tab)}
              onDragEnd={() => setDrag(null)}
              className={cn(
                'group relative flex max-w-[240px] shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-line pl-3 pr-1.5 text-[12.5px] transition-colors duration-100',
                isActive ? '-mb-px bg-app text-fg' : 'text-muted hover:bg-hover hover:text-fg',
                drag?.id === tab.id && 'opacity-50'
              )}
            >
              {isActive && <span className="absolute inset-x-0 top-0 h-px bg-accent" />}
              {showIndicator && <span className={cn('absolute inset-y-1 z-10 w-0.5 rounded bg-accent', drag.side === 'before' ? '-left-px' : '-right-px')} />}
              <TabIcon tab={tab} />
              <span className={cn('truncate', tab.preview && 'italic', isDeleted && 'text-danger line-through decoration-danger/60')}>{tab.title}</span>
              {desc && <span className="min-w-0 shrink truncate text-[11px] text-subtle">{desc}</span>}
              <button
                type="button"
                title={tab.dirty ? 'Unsaved changes — close' : `Close (${formatKeybinding('mod+w')})`}
                aria-label="Close"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  void store().closeTab(tab.id)
                }}
                className={cn(
                  'relative ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-active hover:text-fg',
                  !tab.dirty && !isActive && 'opacity-0 group-hover:opacity-100',
                  !tab.dirty && isActive && 'opacity-70 hover:opacity-100'
                )}
              >
                {tab.dirty ? (
                  <>
                    <span className="h-2 w-2 rounded-full bg-fg/70 group-hover:hidden" />
                    <X size={14} className="hidden group-hover:block" />
                  </>
                ) : (
                  <X size={14} />
                )}
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 border-l border-line px-1.5">
        {active?.kind === 'file' && (
          <IconButton title={`Edit with ATOM (${formatKeybinding('mod+k')})`} icon={<Sparkles size={14} />} onClick={() => startInlineEdit()} />
        )}
        {active && (active.kind === 'file' || active.kind === 'image') && (
          <IconButton title={`Add File to Chat (${formatKeybinding('mod+l')} adds the selection)`} icon={<MessageSquarePlus size={14} />} onClick={() => addToChat(active.path)} />
        )}
        <IconButton title="More Actions" icon={<MoreHorizontal size={15} />} onClick={more.openFromEvent} active={more.open} />
      </div>

      <Menu {...ctx.props} entries={tabMenu(menuTab)} minWidth={220} />
      <Menu {...more.props} entries={moreEntries} minWidth={220} />
    </div>
  )
}
