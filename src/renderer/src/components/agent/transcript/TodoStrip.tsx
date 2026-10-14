import { useState } from 'react'
import { ChevronUp, CircleCheckBig, ListTodo } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { isRunning, todoProgress } from '../../../lib/agent-reducer'
import { useAgentStore } from '../../../stores/agent'
import { TodoChecklist } from './tools/MiscTools'

const OPEN_KEY = 'atom.agent.todoStrip.open'

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
}

/** Compact live todo progress shown above the composer (renders nothing when the agent has no todo list). */
export function TodoStrip({ chatId }: { chatId: string }) {
  const todos = useAgentStore((s) => s.chats[chatId]?.todos ?? null)
  const running = useAgentStore((s) => {
    const c = s.chats[chatId]
    return c ? isRunning(c) : false
  })
  const [open, setOpen] = useState(readOpen)
  if (!todos || !todos.length) return null

  const { total, completed, current } = todoProgress(todos)
  const allDone = completed === total
  const next = todos.find((t) => t.status === 'pending')
  const pct = total ? Math.round((completed / total) * 100) : 0
  const label = allDone ? 'All tasks completed' : current ? current.activeForm || current.content : next ? `Next: ${next.content}` : 'Tasks'
  const toggle = (): void => {
    setOpen(!open)
    writeOpen(!open)
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <button
        type="button"
        onClick={toggle}
        title={open ? 'Hide task list' : 'Show task list'}
        aria-expanded={open}
        className="flex h-8 w-full min-w-0 items-center gap-2 px-2.5 text-left text-[12px] transition-colors hover:bg-hover"
      >
        {allDone ? <CircleCheckBig size={13} className="shrink-0 text-success" /> : <ListTodo size={13} className="shrink-0 text-accent" />}
        <span className="shrink-0 tabular-nums font-medium text-muted">
          {completed}/{total}
        </span>
        <span className={cn('min-w-0 flex-1 truncate', current && running ? 'animate-shimmer-text font-medium' : allDone ? 'text-muted' : 'text-fg')} title={label}>
          {label}
        </span>
        <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-active" aria-hidden>
          <span className={cn('block h-full rounded-full transition-[width] duration-300', allDone ? 'bg-success' : 'bg-accent')} style={{ width: `${pct}%` }} />
        </span>
        <ChevronUp size={13} className={cn('shrink-0 text-subtle transition-transform duration-150', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="max-h-[40vh] overflow-y-auto border-t border-line px-2.5 py-2 animate-fade-in">
          <TodoChecklist todos={todos} />
        </div>
      )}
    </div>
  )
}
