import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useWorkspaceStore } from '../../../stores/workspace'
import { toast } from '../../../stores/toast'

export interface TranscriptContextValue {
  chatId: string
  /** Absolute workspace path of the chat ('' when unknown) — used to resolve relative file paths. */
  workspace: string
}

export const TranscriptContext = createContext<TranscriptContextValue>({ chatId: '', workspace: '' })

/** Chat id + workspace of the transcript being rendered (falls back to the open workspace). */
export function useTranscript(): TranscriptContextValue {
  const ctx = useContext(TranscriptContext)
  const fallback = useWorkspaceStore((s) => s.workspace?.path ?? '')
  return ctx.workspace ? ctx : { ...ctx, workspace: fallback }
}

/** Nesting depth: 0 = main thread, ≥1 = inside a subagent card (renders more compactly). */
export const DepthContext = createContext(0)

export function useDepth(): number {
  return useContext(DepthContext)
}

/** Current time, re-rendering every `intervalMs` while `active`. */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [active, intervalMs])
  return active ? now : Date.now()
}

/** Clipboard helper with a short-lived "copied" flag for icon feedback. */
export function useCopy(resetMs = 1400): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )
  const copy = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(
        () => {
          setCopied(true)
          if (timer.current !== null) window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => setCopied(false), resetMs)
        },
        () => toast.error('Could not copy to the clipboard')
      )
    },
    [resetMs]
  )
  return [copied, copy]
}
