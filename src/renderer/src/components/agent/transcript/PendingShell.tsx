import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { PermissionResponse } from '@shared/types'
import { useAgentStore } from '../../../stores/agent'

// ─────────────────────────────────────────────────────────────────────────────
// Shared card plumbing
// ─────────────────────────────────────────────────────────────────────────────

// Keyboard activity anywhere in the window: a card only reacts to Enter after the user paused typing, so a
// keystroke meant for the editor or the chat input can never approve a tool the user has not seen.
const QUIET_MS = 400
/** Enter is ignored this long after a card got focus. */
const FOCUS_ARM_MS = 350
/** An empty chat input may hand the keyboard to a new card once the user stopped typing this long ago. */
const TYPING_IDLE_MS = 800

let lastKeyAt = 0
let prevKeyAt = 0
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    () => {
      prevKeyAt = lastKeyAt
      lastKeyAt = Date.now()
    },
    true
  )
}

/** Monaco, the terminal and text inputs keep the keyboard: typing there must not land on a card. */
function isEditableFocus(el: Element): boolean {
  return isTypingTarget(el) || el.tagName === 'SELECT' || !!el.closest('.monaco-editor, .xterm')
}

/**
 * Whether a card that just appeared may take keyboard focus: never from the editor, the terminal or anything
 * outside the agent panel, and from a chat input only when it is empty and the user is not typing. A number is
 * the delay after which to ask again (the user may simply have pressed Enter to send a moment ago).
 */
function focusDecision(): boolean | number {
  const active = document.activeElement
  if (!active || active === document.body || active === document.documentElement) return true
  if (!active.closest('[data-agent-panel]')) return false
  if (!isEditableFocus(active)) return true
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) || active.value !== '') return false
  const idle = Date.now() - lastKeyAt
  return idle >= TYPING_IDLE_MS ? true : TYPING_IDLE_MS - idle + 20
}

/**
 * Focus the card when it appears — unless the user is working elsewhere (see `focusDecision`); the card can
 * then be focused with a click or Tab. `armed()` is true once the card had focus for a moment and the key
 * before the current one was pressed a while ago, so Enter only acts as a deliberate answer.
 */
export function useCardFocus(autoFocus: boolean): { ref: RefObject<HTMLDivElement | null>; armed: () => boolean } {
  const ref = useRef<HTMLDivElement>(null)
  const armedAt = useRef(Date.now() + 500)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onFocus = (): void => {
      armedAt.current = Math.max(armedAt.current, Date.now() + FOCUS_ARM_MS)
    }
    el.addEventListener('focus', onFocus)
    return () => el.removeEventListener('focus', onFocus)
  }, [])
  useEffect(() => {
    if (!autoFocus) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const attempt = (retry: boolean): void => {
      const el = ref.current
      if (!el || el.contains(document.activeElement)) return
      const decision = focusDecision()
      if (decision === true) el.focus({ preventScroll: true })
      else if (typeof decision === 'number' && retry) timer = setTimeout(() => attempt(false), decision)
    }
    attempt(true)
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [autoFocus])
  return { ref, armed: () => Date.now() >= armedAt.current && Date.now() - prevKeyAt >= QUIET_MS }
}

/** Printable character without modifiers (typed text, not a shortcut). */
function isTextKey(e: KeyboardEvent<HTMLElement>): boolean {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
}

/**
 * Text typed while the card itself has focus goes to the chat input (moving focus during keydown makes the
 * browser insert the character there) instead of being swallowed. Returns true when focus was moved.
 */
function typeThroughToComposer(card: HTMLElement): boolean {
  const input = card.closest('[data-agent-panel]')?.querySelector<HTMLTextAreaElement>('textarea[data-composer-input]')
  if (!input || input.disabled) return false
  input.focus({ preventScroll: true })
  const end = input.value.length
  input.setSelectionRange(end, end)
  return true
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
  ownKeys,
  children,
  label
}: {
  cardRef: RefObject<HTMLDivElement | null>
  icon: LucideIcon
  title: ReactNode
  subtitle?: ReactNode
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  /** Printable keys the card handles itself (e.g. option digits) instead of passing them to the chat input. */
  ownKeys?: RegExp
  children: ReactNode
  label: string
}) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget && isTextKey(e) && !ownKeys?.test(e.key) && typeThroughToComposer(e.currentTarget)) return
    onKeyDown?.(e)
  }
  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      role="group"
      aria-label={label}
      onKeyDown={handleKeyDown}
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
