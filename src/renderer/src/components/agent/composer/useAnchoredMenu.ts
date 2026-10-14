import { useCallback, useEffect, useRef, useState } from 'react'
import { usePickerStore, type AgentPickerKind } from '../../../lib/agent-commands'
import type { MenuPosition } from '../../ui'

/**
 * Menu anchored to a button that can also be opened programmatically (⌘. / ⌘/ via the picker bus).
 * Clicking the anchor while the menu is open closes it (the menu's outside-click handler fires first,
 * so a reopen right after a close is ignored).
 */
export function useAnchoredMenu(placement: NonNullable<MenuPosition['placement']> = 'top-start') {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const closedAt = useRef(0)

  const openMenu = useCallback((): boolean => {
    const el = anchorRef.current
    if (!el) return false
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    setPosition({ x: placement.endsWith('end') ? r.right : r.left, y: placement.startsWith('top') ? r.top - 4 : r.bottom + 4, placement })
    return true
  }, [placement])

  const close = useCallback(() => {
    closedAt.current = Date.now()
    setPosition(null)
  }, [])

  const toggle = useCallback(() => {
    if (position) close()
    else if (Date.now() - closedAt.current > 200) openMenu()
  }, [position, close, openMenu])

  return { anchorRef, open: position !== null, openMenu, close, toggle, props: { open: position !== null, position, onClose: close } }
}

/** Open a picker when a command requests it (retries for a few frames while the panel expands). */
export function usePickerRequest(kind: AgentPickerKind, open: () => boolean, enabled = true): void {
  const request = usePickerStore((s) => s.request)
  useEffect(() => {
    if (!enabled || !request || request.kind !== kind) return
    const { consume } = usePickerStore.getState()
    if (Date.now() - request.at > 2000) {
      consume(request.id)
      return
    }
    let frame = 0
    let tries = 0
    const attempt = (): void => {
      if (open() || ++tries > 30) {
        consume(request.id)
        return
      }
      frame = requestAnimationFrame(attempt)
    }
    frame = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(frame)
  }, [request, kind, open, enabled])
}
