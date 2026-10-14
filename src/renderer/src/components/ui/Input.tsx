import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode
  right?: ReactNode
  inputSize?: 'sm' | 'md'
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ icon, right, inputSize = 'md', className, ...rest }, ref) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border border-line bg-input px-2 text-fg transition-colors focus-within:border-accent',
        inputSize === 'sm' ? 'h-7 text-[12px]' : 'h-8 text-[13px]',
        className
      )}
    >
      {icon && <span className="shrink-0 text-subtle">{icon}</span>}
      <input ref={ref} spellCheck={false} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle" {...rest} />
      {right}
    </div>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      spellCheck={false}
      className={cn(
        'w-full resize-y rounded-md border border-line bg-input px-2.5 py-2 text-[13px] text-fg outline-none transition-colors placeholder:text-subtle focus:border-accent',
        className
      )}
      {...rest}
    />
  )
})
