import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'

/**
 * Inline file-name input used for "new file / new folder / rename" rows. Enter commits, Escape cancels,
 * blur commits when valid. For renames the file stem (without extension) is pre-selected.
 */
export function InlineNameInput({
  initial = '',
  validate,
  onCommit,
  onCancel,
  className
}: {
  initial?: string
  validate(value: string): string | null
  /** `viaKeyboard` is false when the input lost focus (the user clicked elsewhere). */
  onCommit(value: string, viaKeyboard: boolean): void
  onCancel(viaKeyboard: boolean): void
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)
  const [touched, setTouched] = useState(false)
  const done = useRef(false)
  const error = touched || value !== initial ? validate(value) : null

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = initial.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [initial])

  const finish = (commit: boolean, viaKeyboard: boolean): void => {
    if (done.current) return
    if (commit) {
      const err = validate(value)
      if (err || value.trim() === initial) {
        if (err && value.trim() && viaKeyboard) {
          setTouched(true)
          return
        }
        done.current = true
        onCancel(viaKeyboard)
        return
      }
      done.current = true
      onCommit(value.trim(), viaKeyboard)
    } else {
      done.current = true
      onCancel(viaKeyboard)
    }
  }

  return (
    // Clicks inside the input (placing the caret, double-clicking a word) belong to the input, not to the tree
    // row around it — the row would toggle the folder, or open the file and blur (= commit) a half-typed name.
    <div className={cn('relative min-w-0 flex-1', className)} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        value={value}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            finish(true, true)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            finish(false, true)
          }
        }}
        onBlur={() => {
          // Invalid names are dropped on blur rather than trapping focus.
          finish(!validate(value), false)
        }}
        className={cn(
          'h-[20px] w-full rounded-sm border bg-input px-1 text-[13px] text-fg outline-none',
          error ? 'border-danger' : 'border-accent'
        )}
      />
      {error && (
        <div className="absolute left-0 right-0 top-[21px] z-20 rounded-sm border border-danger bg-elevated px-1.5 py-1 text-[11.5px] leading-snug text-fg shadow-pop">
          {error}
        </div>
      )}
    </div>
  )
}
