import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { Input, Textarea, Toggle } from '../ui'
import { cn } from '../../lib/cn'

// ── Focus ───────────────────────────────────────────────────────────────────

/**
 * Focus an element after a Modal has finished its own initial focus pass (Modal focuses its first
 * focusable element on the next animation frame, which would otherwise win over `autoFocus`).
 */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => ref.current?.focus())
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [])
  return ref
}

// ── Search ──────────────────────────────────────────────────────────────────

/** Lower-cased search query for the settings view ('' = show everything). */
export const SettingsQueryContext = createContext('')

export function useSettingsQuery(): string {
  return useContext(SettingsQueryContext)
}

export function matchesQuery(query: string, ...texts: (string | undefined | null | false)[]): boolean {
  if (!query) return true
  const hay = texts.filter(Boolean).join(' ').toLowerCase()
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word))
}

/** Highlights the query words inside a label. */
export function Highlight({ text }: { text: string }) {
  const query = useSettingsQuery()
  if (!query) return <>{text}</>
  const words = query.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (words.length === 0) return <>{text}</>
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'ig'))
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-accent-soft px-px text-accent">
            {p}
          </mark>
        ) : (
          p
        )
      )}
    </>
  )
}

/**
 * Wraps arbitrary content that should only show when it matches the search query. Rows and searchables
 * mark themselves with `data-setting-row` so groups / sections can hide when nothing inside matches.
 */
export function Searchable({ terms, children, className }: { terms: string; children: ReactNode; className?: string }) {
  const query = useSettingsQuery()
  if (!matchesQuery(query, terms)) return null
  return (
    <div data-setting-row="" className={className}>
      {children}
    </div>
  )
}

// ── Layout ──────────────────────────────────────────────────────────────────

export function SectionHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-[20px] font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-[620px] text-[12.5px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/** A titled card of setting rows. Hidden automatically while searching when no row inside matches. */
export function SettingGroup({
  title,
  description,
  actions,
  children,
  className,
  flush
}: {
  title?: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** Render children without the card/divider styling. */
  flush?: boolean
}) {
  const query = useSettingsQuery()
  return (
    <div className={cn('mb-6', query && '[&:not(:has([data-setting-row]))]:hidden', className)}>
      {(title || actions) && (
        <div className="mb-2 flex items-end gap-3 px-0.5">
          <div className="min-w-0 flex-1">
            {title && <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{title}</div>}
            {description && <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{description}</div>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      )}
      {flush ? children : <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-elevated">{children}</div>}
    </div>
  )
}

export function SettingRow({
  label,
  description,
  keywords,
  children,
  stacked,
  danger,
  badge
}: {
  label: string
  description?: ReactNode
  /** Extra search terms. */
  keywords?: string
  children?: ReactNode
  /** Put the control below the label (wide controls). */
  stacked?: boolean
  danger?: boolean
  badge?: ReactNode
}) {
  const query = useSettingsQuery()
  const descText = typeof description === 'string' ? description : ''
  if (!matchesQuery(query, label, descText, keywords)) return null
  return (
    <div data-setting-row="" className={cn('px-4 py-3', stacked ? 'flex flex-col gap-2.5' : 'flex items-center gap-6')}>
      <div className="min-w-0 flex-1">
        <div className={cn('flex items-center gap-2 text-[13px] font-medium', danger ? 'text-danger' : 'text-fg')}>
          <Highlight text={label} />
          {badge}
        </div>
        {description && <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{description}</div>}
      </div>
      {children !== undefined && <div className={cn(stacked ? 'w-full' : 'flex shrink-0 items-center gap-2')}>{children}</div>}
    </div>
  )
}

/** Row with a Toggle — the most common setting shape. */
export function ToggleRow({
  label,
  description,
  keywords,
  checked,
  onChange,
  disabled
}: {
  label: string
  description?: ReactNode
  keywords?: string
  checked: boolean
  onChange(v: boolean): void
  disabled?: boolean
}) {
  return (
    <SettingRow label={label} description={description} keywords={keywords}>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} title={label} />
    </SettingRow>
  )
}

// ── Fields ──────────────────────────────────────────────────────────────────

/**
 * Local draft state for text settings: the field stays responsive while typing and the value is committed
 * after a short pause, on blur / Enter, and when the field unmounts (e.g. the overlay closes mid-edit).
 */
function useDraftCommit(value: string, onCommit: (v: string) => void, debounceMs: number, validate?: (v: string) => string | null) {
  const [draft, setDraft] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focused = useRef(false)
  const latest = useRef({ value, onCommit, validate, draft })
  latest.current = { value, onCommit, validate, draft }

  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])

  const commitNow = (v: string): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const l = latest.current
    if (v !== l.value && !(l.validate && l.validate(v))) l.onCommit(v)
  }

  useEffect(
    () => () => {
      if (!timer.current) return
      clearTimeout(timer.current)
      timer.current = null
      const l = latest.current
      if (l.draft !== l.value && !(l.validate && l.validate(l.draft))) l.onCommit(l.draft)
    },
    []
  )

  return {
    draft,
    change(v: string): void {
      setDraft(v)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => commitNow(v), debounceMs)
    },
    focus(): void {
      focused.current = true
    },
    blur(): void {
      focused.current = false
      commitNow(latest.current.draft)
    },
    commitNow
  }
}

export function TextField({
  value,
  onCommit,
  placeholder,
  mono,
  className,
  debounceMs = 450,
  type = 'text',
  validate
}: {
  value: string
  onCommit(v: string): void
  placeholder?: string
  mono?: boolean
  className?: string
  debounceMs?: number
  type?: 'text' | 'password' | 'url'
  /** Return an error message to block committing. */
  validate?(v: string): string | null
}) {
  const field = useDraftCommit(value, onCommit, debounceMs, validate)
  const error = validate ? validate(field.draft) : null
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Input
        inputSize="sm"
        type={type}
        value={field.draft}
        placeholder={placeholder}
        className={cn(mono && 'font-mono', error && 'border-danger')}
        onFocus={field.focus}
        onBlur={field.blur}
        onChange={(e) => field.change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') field.commitNow(field.draft)
        }}
      />
      {error && <div className="text-[11px] text-danger">{error}</div>}
    </div>
  )
}

export function TextAreaField({
  value,
  onCommit,
  placeholder,
  rows = 6,
  mono,
  className,
  debounceMs = 600
}: {
  value: string
  onCommit(v: string): void
  placeholder?: string
  rows?: number
  mono?: boolean
  className?: string
  debounceMs?: number
}) {
  const field = useDraftCommit(value, onCommit, debounceMs)
  return (
    <Textarea
      rows={rows}
      value={field.draft}
      placeholder={placeholder}
      className={cn(mono && 'font-mono text-[12px] leading-relaxed', className)}
      onFocus={field.focus}
      onBlur={field.blur}
      onChange={(e) => field.change(e.target.value)}
    />
  )
}

export function NumberField({
  value,
  onCommit,
  min,
  max,
  step = 1,
  suffix,
  width = 'w-24',
  placeholder,
  disabled
}: {
  value: number | null
  onCommit(v: number): void
  min?: number
  max?: number
  step?: number
  suffix?: string
  width?: string
  placeholder?: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  useEffect(() => setDraft(value === null ? '' : String(value)), [value])

  const commit = (): void => {
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(n)) {
      setDraft(value === null ? '' : String(value))
      return
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
    setDraft(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }

  return (
    <Input
      inputSize="sm"
      type="number"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      value={draft}
      className={cn(width, disabled && 'opacity-50')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
      right={suffix ? <span className="shrink-0 text-[11px] text-subtle">{suffix}</span> : undefined}
    />
  )
}

/** Number with an "Unlimited" switch mapping to `null`. */
export function NullableNumberField({
  value,
  onCommit,
  min,
  step,
  defaultValue,
  suffix,
  prefix
}: {
  value: number | null
  onCommit(v: number | null): void
  min?: number
  step?: number
  /** Value used when switching off "Unlimited". */
  defaultValue: number
  suffix?: string
  prefix?: string
}) {
  const unlimited = value === null
  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-2 text-[12px] text-muted">
        <Toggle size="sm" checked={unlimited} onChange={(v) => onCommit(v ? null : defaultValue)} title="Unlimited" />
        Unlimited
      </label>
      {!unlimited && (
        <div className="flex items-center gap-1">
          {prefix && <span className="text-[12px] text-muted">{prefix}</span>}
          <NumberField value={value} onCommit={onCommit} min={min} step={step} suffix={suffix} />
        </div>
      )}
    </div>
  )
}

// ── Lists ───────────────────────────────────────────────────────────────────

/** Editable list of strings (permission rules, glob patterns…) with validation and example chips. */
export function ListEditor({
  items,
  onChange,
  placeholder,
  validate,
  examples,
  tone = 'neutral',
  emptyText,
  mono = true
}: {
  items: string[]
  onChange(items: string[]): void
  placeholder?: string
  validate?(v: string): string | null
  examples?: { value: string; label?: string }[]
  tone?: 'neutral' | 'success' | 'danger'
  emptyText?: string
  mono?: boolean
}) {
  const [draft, setDraft] = useState('')
  const trimmed = draft.trim()
  const error = trimmed ? (validate?.(trimmed) ?? (items.includes(trimmed) ? 'Already in the list.' : null)) : null

  const add = (v: string): void => {
    const value = v.trim()
    if (!value || items.includes(value) || validate?.(value)) return
    onChange([...items, value])
    setDraft('')
  }

  const dot = tone === 'success' ? 'bg-success' : tone === 'danger' ? 'bg-danger' : 'bg-subtle'

  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 ? (
        <div className="divide-y divide-line overflow-hidden rounded-md border border-line bg-input">
          {items.map((item) => (
            <div key={item} className="group flex items-center gap-2 px-2.5 py-1.5">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)} />
              <span className={cn('selectable min-w-0 flex-1 truncate text-[12px] text-fg', mono && 'font-mono')}>{item}</span>
              <button
                type="button"
                title={`Remove ${item}`}
                onClick={() => onChange(items.filter((i) => i !== item))}
                className="rounded p-0.5 text-subtle opacity-0 transition-opacity hover:bg-hover hover:text-danger group-hover:opacity-100"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        emptyText && <div className="rounded-md border border-dashed border-line px-3 py-2.5 text-[12px] text-subtle">{emptyText}</div>
      )}
      <div className="flex gap-2">
        <Input
          inputSize="sm"
          className={cn('flex-1', mono && 'font-mono', error && 'border-danger')}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            }
          }}
        />
        <button
          type="button"
          title="Add"
          disabled={!trimmed || !!error}
          onClick={() => add(draft)}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-elevated px-2.5 text-[12px] font-medium text-fg hover:bg-overlay disabled:opacity-40"
        >
          <Plus size={13} /> Add
        </button>
      </div>
      {error && <div className="text-[11px] text-danger">{error}</div>}
      {examples && examples.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-subtle">Examples:</span>
          {examples
            .filter((ex) => !items.includes(ex.value))
            .map((ex) => (
              <button
                key={ex.value}
                type="button"
                title={ex.label ?? `Add ${ex.value}`}
                onClick={() => add(ex.value)}
                className="rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[11px] text-muted transition-colors hover:border-line-strong hover:text-fg"
              >
                + {ex.value}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

/** Compact chips input (tool names, skills). Enter / comma adds, Backspace on empty removes the last chip. */
export function ChipsInput({
  values,
  onChange,
  placeholder,
  suggestions = [],
  tone = 'neutral'
}: {
  values: string[]
  onChange(values: string[]): void
  placeholder?: string
  suggestions?: string[]
  tone?: 'neutral' | 'danger' | 'accent'
}) {
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const add = (raw: string): void => {
    const parts = raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    const next = [...values]
    for (const p of parts) if (!next.includes(p)) next.push(p)
    if (next.length !== values.length) onChange(next)
    setDraft('')
  }
  const q = draft.trim().toLowerCase()
  const visibleSuggestions = suggestions.filter((s) => !values.includes(s) && (!q || s.toLowerCase().includes(q))).slice(0, 12)
  const chipTone = tone === 'danger' ? 'bg-danger-soft text-danger' : tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-active text-fg'

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          'flex min-h-8 flex-wrap items-center gap-1 rounded-md border bg-input px-1.5 py-1 transition-colors',
          focused ? 'border-accent' : 'border-line'
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((v) => (
          <span key={v} className={cn('inline-flex h-5 items-center gap-1 rounded px-1.5 font-mono text-[11px]', chipTone)}>
            {v}
            <button
              type="button"
              title={`Remove ${v}`}
              onClick={(e) => {
                e.stopPropagation()
                onChange(values.filter((x) => x !== v))
              }}
              className="opacity-60 hover:opacity-100"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          spellCheck={false}
          placeholder={values.length === 0 ? placeholder : ''}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            if (draft.trim()) add(draft)
          }}
          onChange={(e) => {
            const v = e.target.value
            if (v.endsWith(',')) add(v)
            else setDraft(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            } else if (e.key === 'Backspace' && !draft && values.length > 0) {
              onChange(values.slice(0, -1))
            }
          }}
          className="h-5 min-w-[120px] flex-1 bg-transparent px-1 font-mono text-[12px] text-fg outline-none placeholder:font-sans placeholder:text-subtle"
        />
      </div>
      {focused && visibleSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {visibleSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              title={`Add ${s}`}
              onMouseDown={(e) => {
                e.preventDefault()
                add(s)
              }}
              className="rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[11px] text-muted hover:border-line-strong hover:text-fg"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Small "card" radio option used for policies, themes and executables. */
export function OptionCard({
  selected,
  onSelect,
  title,
  description,
  icon,
  danger,
  children,
  className
}: {
  selected: boolean
  onSelect(): void
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  danger?: boolean
  children?: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-100',
        selected
          ? danger
            ? 'border-danger bg-danger-soft'
            : 'border-accent bg-accent-soft'
          : danger
            ? 'border-line bg-elevated hover:border-danger'
            : 'border-line bg-elevated hover:border-line-strong',
        className
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          selected ? (danger ? 'border-danger' : 'border-accent') : 'border-line-strong'
        )}
      >
        {selected && <span className={cn('h-2 w-2 rounded-full', danger ? 'bg-danger' : 'bg-accent')} />}
      </span>
      {icon && <span className={cn('mt-0.5 shrink-0', danger ? 'text-danger' : selected ? 'text-accent' : 'text-muted')}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[13px] font-medium', danger ? 'text-danger' : 'text-fg')}>{title}</span>
        {description && <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{description}</span>}
        {children}
      </span>
    </button>
  )
}
