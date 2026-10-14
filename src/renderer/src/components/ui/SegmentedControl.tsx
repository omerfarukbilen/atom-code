import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface SegmentedOption<T extends string = string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  title?: string
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string = string> {
  value: T
  /** Option values are not used for inference — `value` decides the literal type. */
  options: SegmentedOption<NoInfer<T>>[]
  onChange(value: NoInfer<T>): void
  size?: 'sm' | 'md'
  className?: string
  /** Stretch segments to fill the container width. */
  fill?: boolean
}

/** Compact pill switcher for 2–6 mutually exclusive options (effort, theme mode, tabs…). */
export function SegmentedControl<T extends string = string>({ value, options, onChange, size = 'md', className, fill }: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" className={cn('inline-flex items-center gap-0.5 rounded-md border border-line bg-input p-0.5', fill && 'flex w-full', className)}>
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40',
              size === 'sm' ? 'h-6 px-2 text-[11.5px]' : 'h-7 px-2.5 text-[12px]',
              fill && 'flex-1',
              selected ? 'bg-active text-fg shadow-sm' : 'text-muted hover:bg-hover hover:text-fg'
            )}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
