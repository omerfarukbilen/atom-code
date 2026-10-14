import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { cn } from '../../lib/cn'
import { Kbd } from './Kbd'

export interface MenuItem {
  id: string
  label: ReactNode
  description?: ReactNode
  icon?: ReactNode
  /** Keybinding hint, e.g. "mod+s". */
  shortcut?: string
  checked?: boolean
  disabled?: boolean
  danger?: boolean
  onSelect?: () => void
}

export type MenuEntry = MenuItem | { type: 'separator'; id: string } | { type: 'header'; id: string; label: ReactNode }

function isItem(e: MenuEntry): e is MenuItem {
  return !('type' in e)
}

export interface MenuPosition {
  x: number
  y: number
  /** Preferred placement relative to (x, y). */
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'
}

export interface MenuProps {
  open: boolean
  position: MenuPosition | null
  entries: MenuEntry[]
  onClose(): void
  minWidth?: number
  className?: string
}

/** Floating menu rendered in a portal with full keyboard navigation (↑ ↓ ↩ Esc). */
export function Menu({ open, position, entries, onClose, minWidth = 200, className }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const items = entries.filter(isItem).filter((i) => !i.disabled)
  const [active, setActive] = useState(0)
  const [style, setStyle] = useState<React.CSSProperties>({ left: -9999, top: -9999 })

  useLayoutEffect(() => {
    if (!open || !position || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const placement = position.placement ?? 'bottom-start'
    let left = placement.endsWith('end') ? position.x - rect.width : position.x
    let top = placement.startsWith('top') ? position.y - rect.height : position.y
    left = Math.max(6, Math.min(left, window.innerWidth - rect.width - 6))
    top = Math.max(6, Math.min(top, window.innerHeight - rect.height - 6))
    setStyle({ left, top })
  }, [open, position, entries.length])

  useEffect(() => {
    if (!open) return
    setActive(Math.max(0, items.findIndex((i) => i.checked)))
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => (a + 1) % Math.max(1, items.length))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => (a - 1 + items.length) % Math.max(1, items.length))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        const item = items[active]
        if (item) {
          onClose()
          item.onSelect?.()
        }
      }
    }
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onClose)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, items.length])

  if (!open || !position) return null
  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ ...style, minWidth }}
      className={cn('fixed z-[200] max-h-[70vh] overflow-auto rounded-lg border border-line bg-overlay p-1 shadow-pop animate-fade-in', className)}
    >
      {entries.map((entry) => {
        if (!isItem(entry)) {
          if (entry.type === 'separator') return <div key={entry.id} className="my-1 h-px bg-line" />
          return (
            <div key={entry.id} className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-subtle">
              {entry.label}
            </div>
          )
        }
        const index = items.indexOf(entry)
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onMouseEnter={() => index >= 0 && setActive(index)}
            onClick={() => {
              onClose()
              entry.onSelect?.()
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-fg disabled:opacity-40',
              index === active && 'bg-active',
              entry.danger && 'text-danger'
            )}
          >
            {entry.icon !== undefined && <span className="flex w-4 shrink-0 items-center justify-center text-muted">{entry.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{entry.label}</span>
              {entry.description && <span className="block truncate text-[11px] text-muted">{entry.description}</span>}
            </span>
            {entry.checked && <Check size={14} className="shrink-0 text-accent" />}
            {entry.shortcut && <Kbd keys={entry.shortcut} />}
          </button>
        )
      })}
    </div>,
    document.body
  )
}

/**
 * Hook for anchored dropdown menus.
 *   const menu = useMenu()
 *   <button onClick={menu.openFromEvent}>…</button>
 *   <Menu {...menu.props} entries={…} />
 */
export function useMenu(placement: MenuPosition['placement'] = 'bottom-start') {
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const openFromEvent = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      const x = placement.endsWith('end') ? r.right : r.left
      const y = placement.startsWith('top') ? r.top - 4 : r.bottom + 4
      setPosition((p) => (p ? null : { x, y, placement }))
    },
    [placement]
  )
  const openAt = useCallback((x: number, y: number) => setPosition({ x, y, placement: 'bottom-start' }), [])
  const close = useCallback(() => setPosition(null), [])
  return { open: position !== null, openFromEvent, openAt, close, props: { open: position !== null, position, onClose: close } }
}

/** Right-click context menu helper: `onContextMenu={ctx.onContextMenu}` + `<Menu {...ctx.props} entries={...} />`. */
export function useContextMenu() {
  const menu = useMenu()
  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      menu.openAt(e.clientX, e.clientY)
    },
    [menu]
  )
  return { ...menu, onContextMenu }
}
