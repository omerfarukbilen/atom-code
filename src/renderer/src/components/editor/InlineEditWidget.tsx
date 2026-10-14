import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check, CornerDownLeft, Pencil, RotateCcw, Sparkles, Square, X } from 'lucide-react'
import { dirname } from '@shared/paths'
import { atom } from '../../lib/api'
import { cn } from '../../lib/cn'
import { uuid } from '../../lib/ids'
import { monaco } from '../../lib/monaco'
import { useSettingsStore } from '../../stores/settings'
import { errorMessage, toast } from '../../stores/toast'
import { useWorkspaceStore } from '../../stores/workspace'
import { Kbd, Spinner } from '../ui'

/**
 * Cmd/Ctrl+K inline edit.
 *
 * `InlineEditSession` owns the Monaco side (a view zone that makes room above the target lines, a content
 * widget hosting the React UI, decorations, and the single undoable edit that previews the proposal).
 * `InlineEditWidget` is the React UI portaled into the session's DOM node.
 */

export type InlinePhase = 'prompt' | 'streaming' | 'review'

const CONTEXT_LINES = 200
const history: string[] = []

interface SessionOptions {
  reviewKey: monaco.editor.IContextKey<boolean>
  onClose(): void
}

export class InlineEditSession {
  readonly editor: monaco.editor.ICodeEditor
  readonly model: monaco.editor.ITextModel
  readonly domNode: HTMLDivElement
  readonly filePath: string
  readonly language: string
  /** Selected text sent to the model ('' when generating at the cursor). */
  readonly originalText: string
  /** True when generating new code below a non-empty line (the edit is an insertion after it). */
  readonly insertBelow: boolean
  phase: InlinePhase = 'prompt'
  instruction = ''

  private readonly opts: SessionOptions
  /** Exact text covered by the target range (restored on revert). */
  private readonly replacedText: string
  private readonly zone: monaco.editor.IViewZone
  private readonly widget: monaco.editor.IContentWidget
  private readonly resizeObserver: ResizeObserver
  private readonly disposables: monaco.IDisposable[] = []
  private zoneId: string | null = null
  private targetDecoration: string[] = []
  private addedDecorations: string[] = []
  private appliedVersion: number | null = null
  private closed = false

  constructor(editor: monaco.editor.ICodeEditor, opts: SessionOptions) {
    const model = editor.getModel()
    if (!model) throw new Error('No model')
    this.editor = editor
    this.model = model
    this.opts = opts
    this.filePath = model.uri.fsPath
    this.language = model.getLanguageId()

    const sel = editor.getSelection() ?? new monaco.Selection(1, 1, 1, 1)
    const startLine = sel.startLineNumber
    let endLine = sel.endLineNumber
    if (!sel.isEmpty() && sel.endColumn === 1 && endLine > startLine) endLine--
    let range: monaco.Range
    if (sel.isEmpty()) {
      const blank = model.getLineContent(startLine).trim() === ''
      this.insertBelow = !blank
      const maxCol = model.getLineMaxColumn(startLine)
      range = blank ? new monaco.Range(startLine, 1, startLine, maxCol) : new monaco.Range(startLine, maxCol, startLine, maxCol)
      this.originalText = ''
    } else {
      this.insertBelow = false
      range = new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine))
      this.originalText = model.getValueInRange(range)
    }
    this.replacedText = model.getValueInRange(range)
    this.targetDecoration = model.deltaDecorations([], [this.targetDecorationFor(range)])

    this.domNode = document.createElement('div')
    this.domNode.className = 'atom-inline-widget'
    // Keep keystrokes inside the widget away from Monaco's keybinding dispatcher (React handlers use capture).
    this.domNode.addEventListener('keydown', (e) => e.stopPropagation())
    this.domNode.addEventListener('keypress', (e) => e.stopPropagation())

    this.widget = {
      getId: () => 'atom.inlineEdit.widget',
      getDomNode: () => this.domNode,
      getPosition: () => {
        const proposal = this.proposalRange()
        if (proposal) return { position: { lineNumber: proposal.startLineNumber, column: 1 }, preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE] }
        const target = this.targetRange()
        const line = target?.startLineNumber ?? startLine
        return {
          position: { lineNumber: line, column: 1 },
          preference: [this.insertBelow ? monaco.editor.ContentWidgetPositionPreference.BELOW : monaco.editor.ContentWidgetPositionPreference.ABOVE]
        }
      },
      allowEditorOverflow: false
    }
    this.zone = { afterLineNumber: this.zoneAnchor(), heightInPx: 46, domNode: document.createElement('div'), suppressMouseDown: true }

    this.updateWidth()
    editor.addContentWidget(this.widget)
    editor.changeViewZones((acc) => {
      this.zoneId = acc.addZone(this.zone)
    })
    editor.revealLineInCenterIfOutsideViewport(startLine, monaco.editor.ScrollType.Smooth)

    this.resizeObserver = new ResizeObserver(() => this.relayout())
    this.resizeObserver.observe(this.domNode)
    this.disposables.push(editor.onDidLayoutChange(() => this.updateWidth()))
  }

  get hasProposal(): boolean {
    return this.appliedVersion !== null
  }

  setPhase(phase: InlinePhase): void {
    this.phase = phase
    this.opts.reviewKey.set(phase === 'review')
  }

  /** Request payload context: the selected text plus up to 200 lines around it. */
  context(): { selection: string; prefix: string; suffix: string } {
    const r = this.targetRange() ?? new monaco.Range(1, 1, 1, 1)
    const count = this.model.getLineCount()
    const lastPrefixLine = this.insertBelow ? r.startLineNumber : r.startLineNumber - 1
    const firstSuffixLine = r.endLineNumber + 1
    const prefixStart = Math.max(1, lastPrefixLine - CONTEXT_LINES + 1)
    const suffixEnd = Math.min(count, firstSuffixLine + CONTEXT_LINES - 1)
    const prefix = lastPrefixLine >= 1 ? this.model.getValueInRange(new monaco.Range(prefixStart, 1, lastPrefixLine, this.model.getLineMaxColumn(lastPrefixLine))) : ''
    const suffix = firstSuffixLine <= count ? this.model.getValueInRange(new monaco.Range(firstSuffixLine, 1, suffixEnd, this.model.getLineMaxColumn(suffixEnd))) : ''
    const selection = this.originalText ? this.model.getValueInRange(r) : ''
    return { selection, prefix, suffix }
  }

  /** Replace the target with `text` as one undoable edit and highlight the inserted lines. */
  applyProposal(text: string): void {
    const target = this.targetRange()
    if (!target) return
    let body = text.replace(/\r\n/g, '\n')
    if (!this.originalText || !this.originalText.endsWith('\n')) body = body.replace(/\n+$/, '')
    const insertText = this.insertBelow ? `\n${body}` : body
    this.model.pushStackElement()
    this.editor.executeEdits('atom.inlineEdit', [{ range: target, text: insertText, forceMoveMarkers: true }])
    this.model.pushStackElement()
    this.appliedVersion = this.model.getAlternativeVersionId()
    const startLine = this.insertBelow ? target.startLineNumber + 1 : target.startLineNumber
    const endLine = Math.min(this.model.getLineCount(), startLine + body.split('\n').length - 1)
    const added = new monaco.Range(startLine, 1, endLine, this.model.getLineMaxColumn(endLine))
    this.targetDecoration = this.model.deltaDecorations(this.targetDecoration, [])
    this.addedDecorations = this.model.deltaDecorations(this.addedDecorations, [
      {
        range: added,
        options: {
          isWholeLine: true,
          className: 'atom-inline-added',
          linesDecorationsClassName: 'atom-inline-added-gutter',
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      }
    ])
    this.editor.setPosition({ lineNumber: startLine, column: 1 })
    this.editor.revealRangeInCenterIfOutsideViewport(added, monaco.editor.ScrollType.Smooth)
    this.relayout(true)
  }

  /** Undo the previewed proposal (used by Reject, Retry and Edit). */
  revert(): void {
    const proposal = this.proposalRange()
    if (this.appliedVersion === null || !proposal) return
    if (this.model.getAlternativeVersionId() === this.appliedVersion) {
      void this.model.undo()
    } else {
      const from = this.insertBelow
        ? new monaco.Position(proposal.startLineNumber - 1, this.model.getLineMaxColumn(proposal.startLineNumber - 1))
        : new monaco.Position(proposal.startLineNumber, 1)
      const range = new monaco.Range(from.lineNumber, from.column, proposal.endLineNumber, this.model.getLineMaxColumn(proposal.endLineNumber))
      this.editor.executeEdits('atom.inlineEdit.revert', [{ range, text: this.replacedText, forceMoveMarkers: true }])
    }
    this.addedDecorations = this.model.deltaDecorations(this.addedDecorations, [])
    this.appliedVersion = null
    // Re-create the tracked target so a retry edits the same lines.
    const start = Math.max(1, proposal.startLineNumber - (this.insertBelow ? 1 : 0))
    const end = Math.min(this.model.getLineCount(), start + this.replacedText.split('\n').length - 1)
    const target = this.insertBelow
      ? new monaco.Range(start, this.model.getLineMaxColumn(start), start, this.model.getLineMaxColumn(start))
      : new monaco.Range(start, 1, end, this.model.getLineMaxColumn(end))
    this.targetDecoration = this.model.deltaDecorations(this.targetDecoration, [this.targetDecorationFor(target)])
    this.relayout(true)
  }

  accept(): void {
    this.close()
  }

  reject(): void {
    this.revert()
    this.close()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.dispose()
    this.opts.onClose()
  }

  focusEditor(): void {
    this.editor.focus()
  }

  private dispose(): void {
    this.opts.reviewKey.set(false)
    this.resizeObserver.disconnect()
    this.disposables.forEach((d) => d.dispose())
    if (!this.model.isDisposed()) this.model.deltaDecorations([...this.targetDecoration, ...this.addedDecorations], [])
    this.targetDecoration = []
    this.addedDecorations = []
    this.editor.removeContentWidget(this.widget)
    const id = this.zoneId
    if (id) this.editor.changeViewZones((acc) => acc.removeZone(id))
    this.zoneId = null
  }

  private targetDecorationFor(range: monaco.Range): monaco.editor.IModelDeltaDecoration {
    return {
      range,
      options: {
        stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
        ...(this.originalText ? { isWholeLine: true, className: 'atom-inline-pending', linesDecorationsClassName: 'atom-inline-pending-gutter' } : {})
      }
    }
  }

  private targetRange(): monaco.Range | null {
    const id = this.targetDecoration[0]
    return id ? this.model.getDecorationRange(id) : null
  }

  private proposalRange(): monaco.Range | null {
    const id = this.addedDecorations[0]
    return id && this.appliedVersion !== null ? this.model.getDecorationRange(id) : null
  }

  private zoneAnchor(): number {
    const proposal = this.proposalRange()
    if (proposal) return proposal.startLineNumber - 1
    const target = this.targetRange()
    if (!target) return this.zone?.afterLineNumber ?? 0
    return this.insertBelow ? target.startLineNumber : target.startLineNumber - 1
  }

  private updateWidth(): void {
    const info = this.editor.getLayoutInfo()
    this.domNode.style.width = `${Math.max(260, info.contentWidth - 24)}px`
  }

  /** Keep the reserved space in sync with the widget height and the (moving) target lines. */
  private relayout(force = false): void {
    const id = this.zoneId
    if (!id || this.closed) return
    const height = Math.ceil(this.domNode.getBoundingClientRect().height) + 4
    const anchor = this.zoneAnchor()
    if (!force && Math.abs(height - (this.zone.heightInPx ?? 0)) < 1 && anchor === this.zone.afterLineNumber) return
    this.zone.heightInPx = Math.max(28, height)
    this.zone.afterLineNumber = anchor
    this.editor.changeViewZones((acc) => acc.layoutZone(id))
    this.editor.layoutContentWidget(this.widget)
  }
}

// ── React UI ─────────────────────────────────────────────────────────────────

function modelLabel(model: string): string {
  const m = model.trim() || 'sonnet'
  return m.charAt(0).toUpperCase() + m.slice(1)
}

export function InlineEditWidget({ session }: { session: InlineEditSession }) {
  const inlineModel = useSettingsStore((s) => s.settings.agent.inlineEditModel)
  const editorFontSize = useSettingsStore((s) => s.settings.editor.fontSize)
  const [phase, setPhaseState] = useState<InlinePhase>(session.phase)
  const [instruction, setInstruction] = useState(session.instruction)
  const [streamText, setStreamText] = useState('')
  const [removedHtml, setRemovedHtml] = useState<string | null>(null)
  const historyIndex = useRef(-1)
  const requestRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLPreElement>(null)

  const setPhase = (p: InlinePhase): void => {
    session.setPhase(p)
    setPhaseState(p)
  }

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      if (requestRef.current) void atom.ai.cancelInlineEdit(requestRef.current).catch(() => undefined)
      requestRef.current = null
    }
  }, [])

  // Auto-grow the prompt.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(140, el.scrollHeight)}px`
  }, [instruction, phase])

  useEffect(() => {
    if (previewRef.current) previewRef.current.scrollTop = previewRef.current.scrollHeight
  }, [streamText])

  // Syntax-highlighted copy of the replaced lines, shown in red during review.
  useEffect(() => {
    if (phase !== 'review' || !session.originalText) {
      setRemovedHtml(null)
      return
    }
    let alive = true
    const lines = session.originalText.split('\n')
    const shown = lines.slice(0, 40).join('\n')
    void monaco.editor
      .colorize(shown, session.language, { tabSize: session.model.getOptions().tabSize })
      .then((html) => alive && setRemovedHtml(html))
      .catch(() => alive && setRemovedHtml(null))
    return () => {
      alive = false
    }
  }, [phase, session])

  const submit = async (text: string): Promise<void> => {
    const prompt = text.trim()
    if (!prompt || phase === 'streaming') return
    if (history[0] !== prompt) history.unshift(prompt)
    history.splice(30)
    historyIndex.current = -1
    session.instruction = prompt
    if (session.hasProposal) session.revert()
    setStreamText('')
    setPhase('streaming')
    const requestId = uuid()
    requestRef.current = requestId
    const off = atom.ai.onInlineEditDelta((e) => {
      if (e.requestId === requestId) setStreamText(e.text)
    })
    try {
      const ctx = session.context()
      const ws = useWorkspaceStore.getState().workspace?.path ?? dirname(session.filePath)
      const res = await atom.ai.inlineEdit({
        requestId,
        workspace: ws,
        filePath: session.filePath,
        language: session.language,
        instruction: prompt,
        selection: ctx.selection,
        prefix: ctx.prefix,
        suffix: ctx.suffix,
        model: inlineModel || undefined
      })
      if (requestRef.current !== requestId) return
      requestRef.current = null
      if (res.error) throw new Error(res.error)
      if (!res.text.trim() && !session.originalText) throw new Error('The model returned no code.')
      session.applyProposal(res.text)
      setPhase('review')
      session.focusEditor()
    } catch (err) {
      // Stopped or superseded: the user already moved on.
      if (requestRef.current !== requestId) return
      requestRef.current = null
      setPhase('prompt')
      toast.error('Inline edit failed', errorMessage(err))
      requestAnimationFrame(() => inputRef.current?.focus())
    } finally {
      off()
    }
  }

  const stop = (): void => {
    const id = requestRef.current
    requestRef.current = null
    if (id) void atom.ai.cancelInlineEdit(id).catch(() => undefined)
    setPhase('prompt')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const editPrompt = (): void => {
    session.revert()
    setPhase('prompt')
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }

  const onKey = (e: ReactKeyboardEvent): void => {
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'Escape') {
      e.preventDefault()
      if (phase === 'streaming') stop()
      else if (phase === 'review') session.reject()
      else session.close()
      return
    }
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      if (phase === 'review') session.reject()
      else session.close()
      return
    }
    if (phase === 'review') {
      if ((mod && e.key === 'Enter') || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault()
        session.accept()
      } else if (mod && e.key === 'Backspace') {
        e.preventDefault()
        session.reject()
      }
      return
    }
    if (phase !== 'prompt' || e.target !== inputRef.current) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit(instruction)
    } else if (e.key === 'ArrowUp' && (instruction === '' || historyIndex.current >= 0) && history.length) {
      e.preventDefault()
      historyIndex.current = Math.min(history.length - 1, historyIndex.current + 1)
      setInstruction(history[historyIndex.current])
    } else if (e.key === 'ArrowDown' && historyIndex.current >= 0) {
      e.preventDefault()
      historyIndex.current -= 1
      setInstruction(historyIndex.current >= 0 ? history[historyIndex.current] : '')
    }
  }

  const lineHeight = Math.round(editorFontSize * 1.55)
  const placeholder = session.originalText ? 'Edit selected code…  e.g. “add error handling”' : 'Generate code…  e.g. “a debounce helper”'
  const removedCount = session.originalText ? session.originalText.split('\n').length : 0
  const previewLines = streamText.split('\n')

  return (
    <div className="pb-1.5 pt-1" onKeyDownCapture={onKey}>
      <div
        className={cn(
          'max-w-[680px] overflow-hidden rounded-lg border bg-elevated shadow-pop animate-fade-in',
          phase === 'review' ? 'border-line-strong' : 'border-accent/50 shadow-glow'
        )}
      >
        {phase !== 'review' ? (
          <div className="flex items-start gap-2 px-2.5 py-2">
            <Sparkles size={15} className={cn('mt-[3px] shrink-0 text-accent', phase === 'streaming' && 'animate-atom-pulse')} />
            <textarea
              ref={inputRef}
              value={instruction}
              rows={1}
              readOnly={phase === 'streaming'}
              spellCheck={false}
              placeholder={placeholder}
              onChange={(e) => {
                historyIndex.current = -1
                setInstruction(e.target.value)
              }}
              className="min-h-[20px] flex-1 resize-none bg-transparent font-sans text-[13px] leading-5 text-fg outline-none placeholder:text-subtle"
            />
            <div className="flex shrink-0 items-center gap-1.5 pt-px">
              {phase === 'streaming' ? (
                <>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
                    <Spinner size={11} />
                    <span className="animate-shimmer-text">Generating</span>
                  </span>
                  <button
                    type="button"
                    title="Stop (Esc)"
                    onClick={stop}
                    className="inline-flex h-6 items-center gap-1 rounded-md border border-line px-1.5 text-[11px] text-muted hover:bg-hover hover:text-fg"
                  >
                    <Square size={10} className="fill-current" /> Stop
                  </button>
                </>
              ) : (
                <>
                  <span className="rounded bg-active px-1.5 py-px text-[10.5px] font-medium text-muted" title="Model used for inline edits (Settings → Models & Agent)">
                    {modelLabel(inlineModel)}
                  </span>
                  <button
                    type="button"
                    title="Submit (Enter)"
                    disabled={!instruction.trim()}
                    onClick={() => void submit(instruction)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-fg transition-opacity hover:bg-accent-hover disabled:opacity-40"
                  >
                    <CornerDownLeft size={13} />
                  </button>
                  <button type="button" title="Close (Esc)" onClick={() => session.close()} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-fg">
                    <X size={13} />
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <Check size={14} className="shrink-0 text-success" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted" title={session.instruction}>
              {session.instruction}
            </span>
            <button
              type="button"
              title="Accept (Tab / mod+Enter)"
              onClick={() => session.accept()}
              className="inline-flex h-6 items-center gap-1.5 rounded-md bg-success px-2 text-[11.5px] font-medium text-app hover:opacity-90"
            >
              Accept <Kbd keys="mod+enter" className="border-transparent bg-app/20 text-current" />
            </button>
            <button
              type="button"
              title="Reject (Esc)"
              onClick={() => session.reject()}
              className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line px-2 text-[11.5px] font-medium text-fg hover:bg-hover"
            >
              Reject <Kbd keys="escape" />
            </button>
            <button type="button" title="Retry with the same instruction" onClick={() => void submit(session.instruction)} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
              <RotateCcw size={13} />
            </button>
            <button type="button" title="Edit instruction" onClick={editPrompt} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
              <Pencil size={13} />
            </button>
          </div>
        )}

        {phase === 'prompt' && (
          <div className="flex items-center gap-3 border-t border-line px-3 py-1 text-[10.5px] text-subtle">
            <span>
              <Kbd keys="enter" /> submit
            </span>
            <span>
              <Kbd keys="shift+enter" /> new line
            </span>
            {history.length > 0 && (
              <span>
                <Kbd keys="up" /> history
              </span>
            )}
            <span className="ml-auto">
              <Kbd keys="escape" /> close
            </span>
          </div>
        )}

        {phase === 'streaming' && streamText && (
          <pre
            ref={previewRef}
            className="max-h-[180px] overflow-auto border-t border-line bg-input px-3 py-2 font-mono text-[12px] leading-[1.5] text-muted"
            style={{ maskImage: previewLines.length > 8 ? 'linear-gradient(to bottom, transparent, black 28px)' : undefined }}
          >
            {streamText}
          </pre>
        )}
      </div>

      {phase === 'review' && removedCount > 0 && (
        <div className="mt-1 overflow-hidden rounded-sm bg-diff-del" title="Replaced lines">
          {removedHtml !== null ? (
            <div
              className="whitespace-pre font-mono opacity-80"
              style={{ fontSize: editorFontSize, lineHeight: `${lineHeight}px` }}
              dangerouslySetInnerHTML={{ __html: removedHtml }}
            />
          ) : (
            <pre className="font-mono text-muted opacity-80" style={{ fontSize: editorFontSize, lineHeight: `${lineHeight}px` }}>
              {session.originalText.split('\n').slice(0, 40).join('\n')}
            </pre>
          )}
          {removedCount > 40 && <div className="px-1 py-0.5 text-[11px] text-subtle">… {removedCount - 40} more lines replaced</div>}
        </div>
      )}
    </div>
  )
}
