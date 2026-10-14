import { Fragment, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../../lib/cn'

/** Keyboard bridge: the textarea forwards keys to the open popup first. */
export interface PopupMenuHandle {
  /** Returns true when the key was handled (the textarea then ignores it). */
  onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean
}

/** Viewport placement: the popup grows upwards from `bottom` (distance from the viewport bottom). */
export interface PopupAnchor {
  left: number
  bottom: number
  width: number
}

export type PopupSelectVia = 'enter' | 'tab' | 'click'

interface PopupListProps<T> {
  anchor: PopupAnchor
  items: T[]
  getKey(item: T): string
  renderItem(item: T, active: boolean): ReactNode
  /** Section title for an item; a header row is rendered whenever it changes. */
  sectionOf?(item: T): string | undefined
  onSelect(item: T, via: PopupSelectVia): void
  onClose(): void
  handleRef: RefObject<PopupMenuHandle | null>
  /** Shown when `items` is empty. */
  empty?: ReactNode
  footer?: ReactNode
  ariaLabel: string
}

/** Floating list above the composer with ↑ ↓ ↩ ⇥ Esc handled through `handleRef`. */
export function PopupList<T>({ anchor, items, getKey, renderItem, sectionOf, onSelect, onClose, handleRef, empty, footer, ariaLabel }: PopupListProps<T>) {
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const keys = items.map(getKey).join('\n')

  useEffect(() => setActive(0), [keys])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-popup-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  useImperativeHandle(
    handleRef,
    () => ({
      onKeyDown: (e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
          return true
        }
        if (!items.length) return false
        if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
          e.preventDefault()
          setActive((a) => (a + 1) % items.length)
          return true
        }
        if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
          e.preventDefault()
          setActive((a) => (a - 1 + items.length) % items.length)
          return true
        }
        if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Tab' && !e.shiftKey)) {
          const item = items[Math.min(active, items.length - 1)]
          if (!item) return false
          e.preventDefault()
          onSelect(item, e.key === 'Tab' ? 'tab' : 'enter')
          return true
        }
        return false
      }
    }),
    [items, active, onSelect, onClose]
  )

  let lastSection: string | undefined
  return createPortal(
    <div
      role="listbox"
      aria-label={ariaLabel}
      onMouseDown={(e) => e.preventDefault()}
      style={{ left: anchor.left, bottom: anchor.bottom, width: anchor.width }}
      className="fixed z-[150] flex max-h-[min(340px,48vh)] flex-col overflow-hidden rounded-lg border border-line bg-overlay shadow-pop animate-fade-in"
    >
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1">
        {items.length === 0
          ? empty
          : items.map((item, index) => {
              const section = sectionOf?.(item)
              const showHeader = section !== undefined && section !== lastSection
              lastSection = section
              const isActive = index === active
              return (
                <Fragment key={getKey(item)}>
                  {showHeader && (
                    <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-subtle">{section}</div>
                  )}
                  <div
                    role="option"
                    aria-selected={isActive}
                    data-popup-index={index}
                    onMouseMove={() => !isActive && setActive(index)}
                    onClick={() => onSelect(item, 'click')}
                    className={cn('flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-fg', isActive && 'bg-active')}
                  >
                    {renderItem(item, isActive)}
                  </div>
                </Fragment>
              )
            })}
      </div>
      {footer && <div className="flex shrink-0 items-center gap-3 border-t border-line px-2.5 py-1.5 text-[10.5px] text-subtle">{footer}</div>}
    </div>,
    document.body
  )
}
