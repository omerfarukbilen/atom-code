import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ScrollText } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useAgentStore } from '../../stores/agent'
import { useLayoutStore } from '../../stores/layout'
import { useOutputStore, type OutputLine } from '../../stores/output'
import { EmptyState, Select } from '../ui'

type SourceFilter = 'all' | 'agent' | 'app'

function time(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

const LEVEL_CLASS: Record<OutputLine['level'], string> = {
  info: 'text-fg',
  warn: 'text-muted',
  error: 'text-danger'
}

/** Agent stderr / errors and app logs, newest at the bottom, with stick-to-bottom auto-scroll. */
export function OutputPanel() {
  const lines = useOutputStore((s) => s.lines)
  const visible = useLayoutStore((s) => s.panelVisible && s.panelTab === 'output')
  const [source, setSource] = useState<SourceFilter>('all')
  const [stick, setStick] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => (source === 'all' ? lines : lines.filter((l) => (source === 'agent' ? l.source === 'agent' : l.source !== 'agent'))), [lines, source])

  useEffect(() => {
    if (visible) useOutputStore.getState().markRead()
  }, [visible, lines.length])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick) el.scrollTop = el.scrollHeight
  }, [shown, stick, visible])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (atBottom !== stick) setStick(atBottom)
  }

  const chatTitle = (id?: string): string | null => {
    if (!id) return null
    // Read lazily: subscribing to chats would re-render the log on every streamed token.
    const chat = useAgentStore.getState().chats[id]
    return chat?.title?.trim() || 'Chat'
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-line px-3 text-[12px] text-muted">
        <span>Channel</span>
        <Select<SourceFilter>
          selectSize="sm"
          value={source}
          onChange={setSource}
          options={[
            { value: 'all', label: 'All output' },
            { value: 'agent', label: 'ATOM Agent' },
            { value: 'app', label: 'ATOM Code' }
          ]}
        />
        <span className="ml-auto text-[11px] text-subtle">{shown.length} lines</span>
      </div>
      <div className="relative min-h-0 flex-1">
        {shown.length === 0 ? (
          <EmptyState
            icon={<ScrollText size={24} />}
            title="No output yet"
            description="Diagnostics from the Claude agent process (stderr, errors) and ATOM Code logs show up here."
            className="h-full"
          />
        ) : (
          <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-auto px-3 py-1.5 font-mono text-[12px] leading-[1.55] selectable">
            {shown.map((l) => {
              const chat = chatTitle(l.chatId)
              return (
                <div key={l.id} className="flex gap-2 whitespace-pre-wrap break-all">
                  <span className="shrink-0 text-subtle">{time(l.ts)}</span>
                  <span className={cn('shrink-0', l.source === 'agent' ? 'text-accent' : 'text-info')}>[{chat ? `agent · ${chat.length > 24 ? `${chat.slice(0, 24)}…` : chat}` : l.source}]</span>
                  <span className={cn('min-w-0', LEVEL_CLASS[l.level])}>{l.text}</span>
                </div>
              )
            })}
          </div>
        )}
        {!stick && shown.length > 0 && (
          <button
            type="button"
            title="Scroll to end"
            onClick={() => setStick(true)}
            className="absolute bottom-3 right-5 inline-flex items-center gap-1 rounded-full border border-line bg-overlay px-2.5 py-1 text-[11px] text-muted shadow-pop hover:text-fg"
          >
            <ArrowDownToLine size={12} /> Latest
          </button>
        )}
      </div>
    </div>
  )
}
