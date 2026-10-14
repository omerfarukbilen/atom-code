/**
 * Output channel for the bottom panel: agent stderr / errors (from `atom.agent.onEvent`) and app-level logs
 * pushed with `logOutput(...)`.
 */
import { create } from 'zustand'
import { atom } from '../lib/api'

export type OutputLevel = 'info' | 'warn' | 'error'

export interface OutputLine {
  id: number
  /** Unix ms. */
  ts: number
  /** Channel, e.g. "agent", "app", "editor". */
  source: string
  level: OutputLevel
  text: string
  chatId?: string
}

export interface LogOptions {
  level?: OutputLevel
  source?: string
  chatId?: string
}

interface OutputState {
  lines: OutputLine[]
  /** Lines added since the Output tab was last viewed. */
  unread: number
  clear(): void
  markRead(): void
}

const MAX_LINES = 5000
let nextId = 1
let queue: OutputLine[] = []
let flushScheduled = false

export const useOutputStore = create<OutputState>((set) => ({
  lines: [],
  unread: 0,
  clear: () => set({ lines: [], unread: 0 }),
  markRead: () => set({ unread: 0 })
}))

function flush(): void {
  flushScheduled = false
  if (!queue.length) return
  const batch = queue
  queue = []
  useOutputStore.setState((s) => {
    const lines = s.lines.length + batch.length > MAX_LINES ? [...s.lines, ...batch].slice(-MAX_LINES) : [...s.lines, ...batch]
    return { lines, unread: s.unread + batch.length }
  })
}

function enqueue(lines: OutputLine[]): void {
  queue.push(...lines)
  if (!flushScheduled) {
    flushScheduled = true
    setTimeout(flush, 30)
  }
}

/** Append text to the Output panel. Multi-line text is split into separate entries. */
export function logOutput(line: string, options: LogOptions = {}): void {
  const ts = Date.now()
  const parts = line.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
  enqueue(
    parts.map((text) => ({
      id: nextId++,
      ts,
      source: options.source ?? 'app',
      level: options.level ?? 'info',
      text,
      chatId: options.chatId
    }))
  )
}

const unsubscribe = atom.agent.onEvent(({ chatId, event }) => {
  if (event.type === 'stderr') {
    logOutput(event.data, { source: 'agent', level: 'warn', chatId })
  } else if (event.type === 'error') {
    logOutput(`[${event.kind}] ${event.message}`, { source: 'agent', level: 'error', chatId })
  } else if (event.type === 'status' && event.status === 'error' && event.detail) {
    logOutput(event.detail, { source: 'agent', level: 'error', chatId })
  }
})

if (import.meta.hot) import.meta.hot.dispose(unsubscribe)
