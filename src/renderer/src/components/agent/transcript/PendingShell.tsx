import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { PermissionResponse } from '@shared/types'
import { useAgentStore } from '../../../stores/agent'

// ─────────────────────────────────────────────────────────────────────────────
// Shared card plumbing
// ─────────────────────────────────────────────────────────────────────────────

/** Focus the card when it appears; Enter is ignored for a moment so a keystroke meant for the composer cannot approve. */
export function useCardFocus(autoFocus: boolean): { ref: RefObject<HTMLDivElement | null>; armed: () => boolean } {
  const ref = useRef<HTMLDivElement>(null)
  const armedAt = useRef(Date.now() + 500)
  useEffect(() => {
    if (!autoFocus) return
    armedAt.current = Math.max(armedAt.current, Date.now() + 350)
    ref.current?.focus({ preventScroll: true })
  }, [autoFocus])
  return { ref, armed: () => Date.now() >= armedAt.current }
}

/** Respond once (cards disappear optimistically; this guards double clicks). */
export function useResponder(requestId: string): [boolean, (response: PermissionResponse) => void] {
  const [busy, setBusy] = useState(false)
  // A ref, not the state: two clicks / Enter + click in the same frame both see `busy === false`.
  const inFlight = useRef(false)
  const respond = (response: PermissionResponse): void => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    void useAgentStore
      .getState()
      .respondPermission(requestId, response)
      .finally(() => {
        inFlight.current = false
        setBusy(false)
      })
  }
  return [busy, respond]
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

export function PendingShell({
  cardRef,
  icon: Icon,
  title,
  subtitle,
  onKeyDown,
  children,
  label
}: {
  cardRef: RefObject<HTMLDivElement | null>
  icon: LucideIcon
  title: ReactNode
  subtitle?: ReactNode
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
  label: string
}) {
  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="overflow-hidden rounded-xl border border-accent/45 bg-elevated shadow-glow outline-none animate-fade-in focus-visible:border-accent"
    >
      <div className="flex items-start gap-2.5 px-3.5 pb-2 pt-3">
        <span className="mt-[1px] flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="break-words text-[13px] font-semibold leading-snug text-fg">{title}</div>
          {subtitle && <div className="mt-0.5 text-[11.5px] text-muted">{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  )
}
