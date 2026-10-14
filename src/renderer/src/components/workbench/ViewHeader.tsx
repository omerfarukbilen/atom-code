import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** 35 px sidebar view header: uppercase title on the left, icon actions on the right (revealed on hover). */
export function ViewHeader({ title, actions, children, className, alwaysShowActions }: { title: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; alwaysShowActions?: boolean }) {
  return (
    <div className={cn('group/header flex h-[35px] shrink-0 items-center gap-1 pl-4 pr-2', className)}>
      <div className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</div>
      {children}
      {actions && (
        <div className={cn('flex items-center gap-0.5 transition-opacity duration-100', !alwaysShowActions && 'opacity-0 group-hover/sidebar:opacity-100 focus-within:opacity-100')}>
          {actions}
        </div>
      )}
    </div>
  )
}
