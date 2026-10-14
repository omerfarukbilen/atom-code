import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type WheelEvent } from 'react'
import { X } from 'lucide-react'
import { create } from 'zustand'
import { findMode } from '@shared/modes'
import { closeChatTab } from '../../../lib/agent-guards'
import { DEFAULT_CHAT_TITLE, isRunning } from '../../../lib/agent-reducer'
import { cn } from '../../../lib/cn'
import { useAgentStore } from '../../../stores/agent'
import { useSettingsStore } from '../../../stores/settings'
import { Spinner } from '../../ui'

/** Which tab is being renamed inline (the header menu's "Rename chat" starts it too). */
export const useTabRename = create<{ renamingId: string | null; start(id: string): void; stop(): void }>((set) => ({
  renamingId: null,
  start: (id) => set({ renamingId: id }),
  stop: () => set({ renamingId: null })
}))

const TAB_MIME = 'application/x-atom-chat-tab'

export { closeChatTab }

/** Horizontally scrollable chat tabs: mode-colored status dot, title, close button; middle-click closes. */
export function ChatTabs() {
  const order = useAgentStore((s) => s.order)
  const activeId = useAgentStore((s) => s.activeChatId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!activeId) return
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-chat-tab="${CSS.escape(activeId)}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, order.length])

  const onWheel = (e: WheelEvent<HTMLDivElement>): void => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
  }

  const onDragOver = (e: DragEvent<HTMLElement>, index: number): void => {
    if (!e.dataTransfer.types.includes(TAB_MIME)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    setDropIndex(e.clientX < rect.left + rect.width / 2 ? index : index + 1)
  }

  const onDrop = (e: DragEvent<HTMLElement>): void => {
    const id = e.dataTransfer.getData(TAB_MIME)
    const target = dropIndex
    setDropIndex(null)
    if (!id || target === null) return
    e.preventDefault()
    e.stopPropagation()
    const from = order.indexOf(id)
    if (from < 0) return
    useAgentStore.getState().moveChat(id, target > from ? target - 1 : target)
  }

  return (
    <div
      ref={scrollRef}
      role="tablist"
      aria-label="Chats"
      onWheel={onWheel}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex(null)
      }}
      className="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {order.map((id, index) => (
        <ChatTab
          key={id}
          id={id}
          active={id === activeId}
          dropBefore={dropIndex === index}
          dropAfter={dropIndex === order.length && index === order.length - 1}
          onDragOver={(e) => onDragOver(e, index)}
          onDrop={onDrop}
          onDragEnd={() => setDropIndex(null)}
        />
      ))}
    </div>
  )
}

interface ChatTabProps {
  id: string
  active: boolean
  dropBefore: boolean
  dropAfter: boolean
  onDragOver(e: DragEvent<HTMLElement>): void
  onDrop(e: DragEvent<HTMLElement>): void
  onDragEnd(): void
}

const ChatTab = memo(function ChatTab({ id, active, dropBefore, dropAfter, onDragOver, onDrop, onDragEnd }: ChatTabProps) {
  const title = useAgentStore((s) => s.chats[id]?.title || DEFAULT_CHAT_TITLE)
  const status = useAgentStore((s) => s.chats[id]?.status ?? 'idle')
  const awaiting = useAgentStore((s) => (s.chats[id]?.pendingRequests.length ?? 0) > 0)
  const hasError = useAgentStore((s) => !!s.chats[id]?.error || s.chats[id]?.status === 'error')
  const modeId = useAgentStore((s) => s.chats[id]?.modeId ?? '')
  const customModes = useSettingsStore((s) => s.settings.customModes)
  const mode = useMemo(() => findMode(modeId, customModes), [modeId, customModes])
  const renaming = useTabRename((s) => s.renamingId === id)
  const running = isRunning({ status })

  const stateLabel = awaiting ? ' · waiting for you' : running ? ' · working…' : hasError ? ' · error' : ''

  return (
    <div
      data-chat-tab={id}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      draggable={!renaming}
      title={`${title} — ${mode.name} mode${stateLabel}`}
      onClick={() => useAgentStore.getState().setActive(id)}
      onDoubleClick={() => useTabRename.getState().start(id)}
      onMouseDown={(e) => {
        // Middle button: suppress autoscroll so the aux click can close the tab.
        if (e.button === 1) e.preventDefault()
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        void closeChatTab(id)
      }}
      onKeyDown={(e) => {
        if (e.key === 'F2') {
          e.preventDefault()
          useTabRename.getState().start(id)
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(TAB_MIME, id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        'group/tab relative flex h-7 min-w-[68px] max-w-[180px] shrink-0 items-center gap-1.5 rounded-md pl-2 pr-1 text-[12px] transition-colors duration-100',
        active ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg'
      )}
    >
      {(dropBefore || dropAfter) && (
        <span className={cn('pointer-events-none absolute top-1 bottom-1 w-0.5 rounded-full bg-accent', dropBefore ? '-left-[2px]' : '-right-[2px]')} />
      )}
      <TabIndicator running={running} awaiting={awaiting} error={hasError} color={mode.color} />
      {renaming ? <RenameInput id={id} initial={title} /> : <span className="min-w-0 flex-1 truncate">{title}</span>}
      <button
        type="button"
        title="Close chat"
        aria-label="Close chat"
        onClick={(e) => {
          e.stopPropagation()
          void closeChatTab(id)
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded text-subtle transition-opacity hover:bg-hover hover:text-fg',
          active ? 'opacity-100' : 'opacity-0 focus:opacity-100 group-hover/tab:opacity-100'
        )}
      >
        <X size={12} />
      </button>
    </div>
  )
})

function TabIndicator({ running, awaiting, error, color }: { running: boolean; awaiting: boolean; error: boolean; color: string }) {
  if (awaiting) return <span className="h-2 w-2 shrink-0 rounded-full bg-warning animate-atom-pulse" />
  if (running) return <Spinner size={10} className="text-accent" />
  if (error) return <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
}

function RenameInput({ id, initial }: { id: string; initial: string }) {
  const [value, setValue] = useState(initial === DEFAULT_CHAT_TITLE ? '' : initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const finish = (commit: boolean): void => {
    if (done.current) return
    done.current = true
    if (commit && value.trim() && value.trim() !== initial) useAgentStore.getState().renameChat(id, value)
    useTabRename.getState().stop()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      finish(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      finish(false)
    }
  }

  return (
    <input
      ref={ref}
      value={value}
      placeholder="Chat name"
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="h-5 min-w-0 flex-1 rounded border border-accent bg-input px-1 text-[12px] text-fg outline-none"
    />
  )
}
