import { cn } from '../../lib/cn'

export interface ToggleProps {
  checked: boolean
  onChange(checked: boolean): void
  disabled?: boolean
  size?: 'sm' | 'md'
  title?: string
}

export function Toggle({ checked, onChange, disabled, size = 'md', title }: ToggleProps) {
  const dims = size === 'sm' ? { track: 'h-4 w-7', knob: 'h-3 w-3', on: 'translate-x-3' } : { track: 'h-5 w-9', knob: 'h-4 w-4', on: 'translate-x-4' }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors duration-150 disabled:opacity-50',
        dims.track,
        checked ? 'bg-accent' : 'bg-line-strong'
      )}
    >
      <span className={cn('rounded-full bg-white shadow transition-transform duration-150', dims.knob, checked && dims.on)} />
    </button>
  )
}
