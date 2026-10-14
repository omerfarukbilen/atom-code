import type { SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
}

export interface SelectProps<T extends string = string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  value: T
  options: SelectOption<T>[]
  onChange(value: T): void
  selectSize?: 'sm' | 'md'
}

/** Native select styled to match the theme (keyboard accessible, no portal needed). */
export function Select<T extends string = string>({ value, options, onChange, selectSize = 'md', className, ...rest }: SelectProps<T>) {
  return (
    <div className={cn('relative inline-flex items-center', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(
          'w-full appearance-none rounded-md border border-line bg-input pl-2 pr-7 text-fg outline-none transition-colors hover:border-line-strong focus:border-accent',
          selectSize === 'sm' ? 'h-7 text-[12px]' : 'h-8 text-[13px]'
        )}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-elevated text-fg">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2 text-subtle" />
    </div>
  )
}
