import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface ModalProps {
  open: boolean
  onClose(): void
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Tailwind width class, default max-w-lg. */
  width?: string
  /** Close when clicking the backdrop (default true). */
  dismissible?: boolean
  className?: string
  hideClose?: boolean
}

export function Modal({ open, onClose, title, description, children, footer, width = 'max-w-lg', dismissible = true, className, hideClose }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    const prev = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => {
      const el = panelRef.current?.querySelector<HTMLElement>('[autofocus], input, textarea, button')
      el?.focus()
    })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      prev?.focus?.()
    }
  }, [open, dismissible, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 px-4 pt-[10vh] backdrop-blur-[2px] animate-fade-in" onMouseDown={(e) => dismissible && e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" className={cn('flex max-h-[80vh] w-full flex-col overflow-hidden rounded-xl border border-line bg-elevated shadow-pop', width, className)}>
        {(title || !hideClose) && (
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              {title && <div className="text-[15px] font-semibold text-fg">{title}</div>}
              {description && <div className="mt-1 text-[12.5px] leading-relaxed text-muted">{description}</div>}
            </div>
            {!hideClose && (
              <button type="button" title="Close" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
                <X size={16} />
              </button>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-panel px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
