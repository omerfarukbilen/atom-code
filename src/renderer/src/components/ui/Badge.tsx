import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-active text-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info'
}

export function Badge({ tone = 'neutral', children, className, title }: { tone?: BadgeTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-[18px] items-center gap-1 rounded px-1.5 text-[10.5px] font-medium leading-none', TONES[tone], className)}>
      {children}
    </span>
  )
}
