import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  iconRight?: ReactNode
  loading?: boolean
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm',
  secondary: 'bg-elevated text-fg border border-line hover:bg-overlay hover:border-line-strong',
  outline: 'bg-transparent text-fg border border-line-strong hover:bg-hover',
  ghost: 'bg-transparent text-muted hover:bg-hover hover:text-fg',
  danger: 'bg-danger text-white hover:opacity-90'
}

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1 rounded',
  sm: 'h-7 px-2.5 text-[12px] gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[13px] gap-2 rounded-md',
  lg: 'h-10 px-4 text-[14px] gap-2 rounded-lg'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading, className, children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-100',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {loading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
      {children}
      {iconRight}
    </button>
  )
})
