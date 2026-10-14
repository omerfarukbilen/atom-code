import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Tooltip text — required for accessibility. */
  title: string
  icon: ReactNode
  size?: 'xs' | 'sm' | 'md'
  active?: boolean
  variant?: 'ghost' | 'subtle'
}

const SIZES = { xs: 'h-5 w-5 rounded', sm: 'h-6 w-6 rounded-md', md: 'h-7 w-7 rounded-md' }

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { title, icon, size = 'sm', active, variant = 'ghost', className, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex shrink-0 items-center justify-center text-muted transition-colors duration-100 hover:bg-hover hover:text-fg',
        'disabled:pointer-events-none disabled:opacity-40',
        variant === 'subtle' && 'bg-hover',
        active && 'bg-active text-fg',
        SIZES[size],
        className
      )}
      {...rest}
    >
      {icon}
    </button>
  )
})
