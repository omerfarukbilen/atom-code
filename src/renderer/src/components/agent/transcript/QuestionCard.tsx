import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, MessageCircleQuestion } from 'lucide-react'
import type { PermissionRequest } from '@shared/types'
import { cn } from '../../../lib/cn'
import { Badge, Button, Kbd } from '../../ui'
import { arr, isObj, str } from './format'
import { Markdown } from './Markdown'
import { PendingShell, isTypingTarget, useCardFocus, useResponder } from './PendingShell'

interface QuestionOption {
  label: string
  description: string
  preview?: string
}

interface Question {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect: boolean
}

function parseQuestions(input: Record<string, unknown>): Question[] {
  return arr(input.questions)
    .filter(isObj)
    .map((q) => ({
      question: str(q.question) ?? '',
      header: str(q.header) ?? '',
      multiSelect: q.multiSelect === true,
      options: arr(q.options)
        .filter(isObj)
        .map((o) => ({ label: str(o.label) ?? '', description: str(o.description) ?? '', preview: str(o.preview) }))
        .filter((o) => o.label)
    }))
    .filter((q) => q.question)
}

/** Box-drawing / ASCII-art previews render monospaced; everything else as markdown. */
function isMonospacePreview(text: string): boolean {
  if (/^\s*```/.test(text)) return false
  return /[│┌┐└┘├┤┬┴┼─═║╔╗╚╝╭╮╯╰]/.test(text) || text.split('\n').filter((l) => /^ {2,}\S/.test(l)).length >= 3
}

const SKIP_MESSAGE = 'The user skipped these questions. Continue with your best judgment, or ask again if you are blocked.'

interface QuestionState {
  selected: string[]
  otherOn: boolean
  otherText: string
}

const EMPTY_STATE: QuestionState = { selected: [], otherOn: false, otherText: '' }

function answerOf(s: QuestionState): string {
  const parts = [...s.selected]
  if (s.otherOn && s.otherText.trim()) parts.push(s.otherText.trim())
  return parts.join(', ')
}

function Indicator({ multi, on }: { multi: boolean; on: boolean }) {
  return (
    <span
      className={cn(
        'mt-[2px] flex h-3.5 w-3.5 shrink-0 items-center justify-center border transition-colors',
        multi ? 'rounded-[4px]' : 'rounded-full',
        on ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong bg-input'
      )}
    >
      {on && (multi ? <Check size={10} strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-accent-fg" />)}
    </span>
  )
}

function QuestionBlock({
  q,
  index,
  state,
  active,
  onChange,
  onActivate
}: {
  q: Question
  index: number
  state: QuestionState
  active: boolean
  onChange: (next: QuestionState) => void
  onActivate: () => void
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const otherRef = useRef<HTMLInputElement>(null)
  const toggle = (label: string): void => {
    onActivate()
    if (q.multiSelect) {
      const has = state.selected.includes(label)
      onChange({ ...state, selected: has ? state.selected.filter((l) => l !== label) : [...state.selected, label] })
    } else {
      onChange({ ...state, selected: [label], otherOn: false })
    }
  }
  const toggleOther = (): void => {
    onActivate()
    const otherOn = q.multiSelect ? !state.otherOn : true
    onChange({ ...state, otherOn, selected: q.multiSelect ? state.selected : [] })
    if (otherOn) requestAnimationFrame(() => otherRef.current?.focus())
  }
  const hoveredOption = hovered !== null ? q.options[hovered] : undefined
  const previewOption = hoveredOption?.preview ? hoveredOption : q.options.find((o) => o.preview && state.selected.includes(o.label))
  const preview = previewOption?.preview

  return (
    <div className={cn('rounded-lg px-1 py-1', active && 'bg-hover/40')} onFocusCapture={onActivate}>
      <div className="flex items-center gap-2">
        {q.header && <Badge tone="accent">{q.header}</Badge>}
        {q.multiSelect && <span className="text-[11px] text-subtle">Select all that apply</span>}
        <span className="flex-1" />
        <span className="text-[10.5px] text-subtle">Question {index + 1}</span>
      </div>
      <div className="mt-1 break-words text-[13px] font-medium leading-snug text-fg">{q.question}</div>
      <div className="mt-2 flex flex-col gap-1.5">
        {q.options.map((o, oi) => {
          const on = state.selected.includes(o.label)
          return (
            <button
              key={o.label}
              type="button"
              role={q.multiSelect ? 'checkbox' : 'radio'}
              aria-checked={on}
              onClick={() => toggle(o.label)}
              onMouseEnter={() => setHovered(oi)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(oi)}
              onBlur={() => setHovered(null)}
              className={cn(
                'flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                on ? 'border-accent bg-accent-soft' : 'border-line bg-panel hover:border-line-strong hover:bg-hover'
              )}
            >
              <Indicator multi={q.multiSelect} on={on} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-fg">{o.label}</span>
                {o.description && <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">{o.description}</span>}
              </span>
              {active && oi < 9 && <Kbd keys={String(oi + 1)} className="mt-[1px]" />}
            </button>
          )
        })}
        <div
          className={cn(
            'flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors',
            state.otherOn ? 'border-accent bg-accent-soft' : 'border-line bg-panel hover:border-line-strong'
          )}
        >
          <button type="button" role={q.multiSelect ? 'checkbox' : 'radio'} aria-checked={state.otherOn} title="Answer in your own words" onClick={toggleOther} className="flex items-start gap-2.5">
            <Indicator multi={q.multiSelect} on={state.otherOn} />
            <span className="text-[12.5px] font-medium text-fg">Other</span>
          </button>
          <input
            ref={otherRef}
            value={state.otherText}
            onFocus={() => {
              onActivate()
              if (!state.otherOn) onChange({ ...state, otherOn: true, selected: q.multiSelect ? state.selected : [] })
            }}
            onChange={(e) => onChange({ ...state, otherText: e.target.value, otherOn: true, selected: q.multiSelect ? state.selected : [] })}
            placeholder="Type your own answer…"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-subtle"
          />
        </div>
      </div>
      {preview && (
        <div className="mt-2 max-h-[280px] overflow-auto rounded-lg border border-line bg-input px-3 py-2 animate-fade-in">
          {isMonospacePreview(preview) ? (
            <pre className="selectable whitespace-pre font-mono text-[11.5px] leading-[17px] text-fg">{preview}</pre>
          ) : (
            <Markdown content={preview} className="!text-[12px]" />
          )}
        </div>
      )}
    </div>
  )
}

/** AskUserQuestion: selectable option cards per question, "Other" free text, previews; Submit → answers. */
export function QuestionCard({ request, autoFocus }: { request: PermissionRequest; autoFocus: boolean }) {
  const { ref, armed } = useCardFocus(autoFocus)
  const [busy, respond] = useResponder(request.requestId)
  const questions = useMemo(() => parseQuestions(request.input), [request.input])
  const [states, setStates] = useState<QuestionState[]>(() => questions.map(() => EMPTY_STATE))
  const [activeQ, setActiveQ] = useState(0)
  const stateOf = (i: number): QuestionState => states[i] ?? EMPTY_STATE
  const complete = questions.length > 0 && questions.every((_, i) => answerOf(stateOf(i)).length > 0)

  const setState = (i: number, next: QuestionState): void => {
    setStates((prev) => {
      const copy = questions.map((_, k) => prev[k] ?? EMPTY_STATE)
      copy[i] = next
      return copy
    })
  }

  const submit = (): void => {
    if (!complete) return
    const answers: Record<string, string> = {}
    const annotations: Record<string, { preview: string }> = {}
    questions.forEach((q, i) => {
      const s = stateOf(i)
      answers[q.question] = answerOf(s)
      if (!q.multiSelect && s.selected.length === 1) {
        const preview = q.options.find((o) => o.label === s.selected[0])?.preview
        if (preview) annotations[q.question] = { preview }
      }
    })
    respond({
      behavior: 'allow',
      scope: 'once',
      updatedInput: { ...request.input, answers, ...(Object.keys(annotations).length ? { annotations } : {}) }
    })
  }
  const skip = (): void => respond({ behavior: 'deny', message: SKIP_MESSAGE })

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (isTypingTarget(e.target)) (e.target as HTMLElement).blur()
      else skip()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && (e.target === e.currentTarget || isTypingTarget(e.target))) {
      e.preventDefault()
      // In the card's own "Other" input Enter is deliberate; on the card itself it waits for a typing pause.
      if (!e.repeat && (isTypingTarget(e.target) || armed())) submit()
      return
    }
    if (!isTypingTarget(e.target) && /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat) {
      const q = questions[activeQ]
      const option = q?.options[Number(e.key) - 1]
      if (!q || !option) return
      e.preventDefault()
      const s = stateOf(activeQ)
      if (q.multiSelect) {
        const has = s.selected.includes(option.label)
        setState(activeQ, { ...s, selected: has ? s.selected.filter((l) => l !== option.label) : [...s.selected, option.label] })
      } else {
        setState(activeQ, { ...s, selected: [option.label], otherOn: false })
        // Single-select: move on to the next question.
        if (activeQ < questions.length - 1) setActiveQ(activeQ + 1)
      }
    }
  }

  return (
    <PendingShell
      cardRef={ref}
      icon={MessageCircleQuestion}
      label="Questions from ATOM"
      onKeyDown={onKeyDown}
      ownKeys={/^[1-9]$/}
      title={questions.length > 1 ? `ATOM has ${questions.length} questions` : 'ATOM has a question'}
      subtitle="Pick an option or write your own answer."
    >
      <div className="flex flex-col gap-3 px-2.5 pb-3">
        {questions.map((q, i) => (
          <QuestionBlock
            key={`${i}:${q.question}`}
            q={q}
            index={i}
            state={stateOf(i)}
            active={questions.length > 1 ? activeQ === i : true}
            onChange={(next) => setState(i, next)}
            onActivate={() => setActiveQ(i)}
          />
        ))}
        {!questions.length && <div className="px-1 text-[12px] text-muted">The question could not be displayed.</div>}
        <div className="flex items-center gap-1.5 px-1">
          <Button variant="primary" size="sm" disabled={busy || !complete} onClick={submit} iconRight={<Kbd keys="enter" className="!border-transparent !bg-accent-fg/15 !text-accent-fg" />}>
            Submit {questions.length > 1 ? 'answers' : 'answer'}
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" disabled={busy} onClick={skip} iconRight={<Kbd keys="escape" />}>
            Skip
          </Button>
        </div>
      </div>
    </PendingShell>
  )
}
