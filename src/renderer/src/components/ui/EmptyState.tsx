import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      {icon && <div className="mb-1 text-subtle">{icon}</div>}
      <div className="text-[13px] font-medium text-fg">{title}</div>
      {description && <div className="max-w-[280px] text-[12px] leading-relaxed text-muted">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
