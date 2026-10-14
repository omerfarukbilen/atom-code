import type { ReactElement } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useToastStore, type ToastKind } from '../../stores/toast'
import { cn } from '../../lib/cn'

const ICONS: Record<ToastKind, ReactElement> = {
  info: <Info size={15} className="text-info" />,
  success: <CheckCircle2 size={15} className="text-success" />,
  warning: <AlertTriangle size={15} className="text-warning" />,
  error: <XCircle size={15} className="text-danger" />
}

/** Mount once at the app root. */
export function Toaster() {
  const { toasts, dismiss } = useToastStore()
  return (
    <div className="pointer-events-none fixed bottom-8 right-4 z-[300] flex w-[360px] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={cn('pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-overlay px-3 py-2.5 shadow-pop animate-fade-in')}>
          <span className="mt-0.5">{ICONS[t.kind]}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium text-fg">{t.message}</div>
            {t.detail && <div className="mt-0.5 line-clamp-3 break-words text-[11.5px] text-muted selectable">{t.detail}</div>}
            {t.action && (
              <button type="button" className="mt-1.5 text-[12px] font-medium text-accent hover:underline" onClick={() => { t.action?.run(); dismiss(t.id) }}>
                {t.action.label}
              </button>
            )}
          </div>
          <button type="button" title="Dismiss" onClick={() => dismiss(t.id)} className="rounded p-0.5 text-subtle hover:bg-hover hover:text-fg">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
