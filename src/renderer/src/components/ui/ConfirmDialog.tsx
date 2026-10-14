import type { ReactNode } from 'react'
import { create } from 'zustand'
import { Button } from './Button'
import { Modal } from './Modal'

/**
 * Promise-based confirmation dialog.
 *
 *   if (await confirmDialog({ title: 'Delete file?', confirmLabel: 'Move to Trash', danger: true })) …
 *
 * Mount `<ConfirmHost />` once at the app root.
 */
export interface ConfirmOptions {
  title: ReactNode
  message?: ReactNode
  /** Alias of `message`. */
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** Optional icon shown left of the message. */
  icon?: ReactNode
}

interface ConfirmState {
  current: (ConfirmOptions & { resolve(ok: boolean): void }) | null
  open(options: ConfirmOptions): Promise<boolean>
  settle(ok: boolean): void
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  current: null,
  open: (options) =>
    new Promise<boolean>((resolve) => {
      get().current?.resolve(false)
      set({ current: { ...options, resolve } })
    }),
  settle: (ok) => {
    const cur = get().current
    set({ current: null })
    cur?.resolve(ok)
  }
}))

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().open(options)
}

export function ConfirmHost() {
  const current = useConfirmStore((s) => s.current)
  const settle = useConfirmStore((s) => s.settle)
  return <ConfirmDialog open={!!current} options={current} onSettle={settle} />
}

export interface ConfirmDialogProps {
  open: boolean
  options: ConfirmOptions | null
  onSettle(ok: boolean): void
}

/** Controlled variant (ConfirmHost renders this for the promise API). */
export function ConfirmDialog({ open, options: current, onSettle: settle }: ConfirmDialogProps) {
  const message = current?.message ?? current?.description
  return (
    <Modal
      open={open}
      onClose={() => settle(false)}
      title={current?.title}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => settle(false)}>
            {current?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={current?.danger ? 'danger' : 'primary'}
            size="sm"
            autoFocus
            onClick={() => settle(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                settle(true)
              }
            }}
          >
            {current?.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      {message ? (
        <div className="flex items-start gap-3 px-5 py-4 text-[12.5px] leading-relaxed text-muted">
          {current?.icon && <span className="mt-0.5 shrink-0">{current.icon}</span>}
          <div className="min-w-0 flex-1 selectable">{message}</div>
        </div>
      ) : null}
    </Modal>
  )
}
