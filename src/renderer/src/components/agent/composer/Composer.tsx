import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react'
import { ArrowUp, Clock, ImagePlus, Square } from 'lucide-react'
import type { AgentModeDefinition } from '@shared/types'
import { usePickerStore } from '../../../lib/agent-commands'
import { isRunning, stripAtomContext } from '../../../lib/agent-reducer'
import type { ComposerState, UserItem } from '../../../lib/agent-types'
import { cn } from '../../../lib/cn'
import { formatKeybinding } from '../../../lib/platform'
import { useAgentModes, useAgentStore } from '../../../stores/agent'
import { useLayoutStore } from '../../../stores/layout'
import { errorMessage, toast } from '../../../stores/toast'
import { useWorkspaceStore } from '../../../stores/workspace'
import { Kbd } from '../../ui'
import { AttachmentChips } from './AttachmentChips'
import { addImageFiles, isImageFile } from './attachments'
import { ContextRing } from './ContextRing'
import { EffortPicker } from './EffortPicker'
import { runLocalCommand } from './local-commands'
import { MentionMenu, resolveMention, type MentionItem } from './MentionMenu'
import { ModelPicker, useCurrentModel } from './ModelPicker'
import { ModePicker } from './ModePicker'
import { PermissionPicker } from './PermissionPicker'
import type { PopupAnchor, PopupMenuHandle, PopupSelectVia } from './PopupList'
import { SlashMenu, type SlashItem } from './SlashMenu'
import { caretCoordinates, detectPopup, samePopup, type ComposerPopup } from './utils'

const EMPTY_COMPOSER: ComposerState = { text: '', attachments: [], images: [] }

const PLACEHOLDERS: Record<string, string> = {
  agent: 'Ask ATOM to build, fix, explain… (@ for context, / for commands)',
  plan: 'Describe what to plan — ATOM researches first… (@ for context)',
  ask: 'Ask anything about your code… (@ for context, / for commands)',
  debug: 'Describe the bug or paste the error… (@ for context)',
  review: 'What should ATOM review? (@ for context, / for commands)',
  tdd: 'Describe the behaviour to build test-first… (@ for context)'
}

function placeholderFor(mode: AgentModeDefinition, running: boolean, suggestion: string | null): string {
  if (suggestion) return suggestion
  if (running) return 'Queue a follow-up… (Esc to stop)'
  return PLACEHOLDERS[mode.id] ?? `Ask ATOM (${mode.name})… (@ for context, / for commands)`
}

function userHistory(chatId: string): string[] {
  const chat = useAgentStore.getState().chats[chatId]
  if (!chat) return []
  return chat.items
    .filter((i): i is UserItem => i.kind === 'user')
    .map((i) => stripAtomContext(i.text))
    .filter((t) => t.trim().length > 0)
}

/** The chat input: attachments, auto-growing textarea, @ / slash menus and the mode/model/effort/permission toolbar. */
export function Composer({ chatId }: { chatId: string }) {
  const composer = useAgentStore((s) => s.chats[chatId]?.composer ?? EMPTY_COMPOSER)
  const status = useAgentStore((s) => s.chats[chatId]?.status ?? 'idle')
  const modeId = useAgentStore((s) => s.chats[chatId]?.modeId ?? '')
  const suggestion = useAgentStore((s) => s.chats[chatId]?.suggestion ?? null)
  const queuedCount = useAgentStore((s) => s.chats[chatId]?.queuedCount ?? 0)
  const chatWorkspace = useAgentStore((s) => s.chats[chatId]?.workspace ?? '')
  const openWorkspace = useWorkspaceStore((s) => s.workspace?.path ?? '')
  const workspace = chatWorkspace || openWorkspace
  const modes = useAgentModes()
  const mode = useMemo(() => modes.find((m) => m.id === modeId) ?? modes[0], [modes, modeId])
  const model = useCurrentModel(chatId)
  const running = isRunning({ status })

  const cardRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const popupHandle = useRef<PopupMenuHandle | null>(null)
  const dismissedValue = useRef<string | null>(null)
  const recallIndex = useRef(-1)
  const recalledText = useRef<string | null>(null)
  const [popup, setPopup] = useState<ComposerPopup | null>(null)
  const [anchor, setAnchor] = useState<PopupAnchor | null>(null)

  const { text, attachments, images } = composer
  const hasContent = text.trim().length > 0 || attachments.length > 0 || images.length > 0

  // ── text helpers ───────────────────────────────────────────────────────────

  const setText = useCallback((value: string) => useAgentStore.getState().setComposerText(value, chatId), [chatId])

  const syncPopupRef = useRef<() => void>(() => undefined)

  /** Set the text and put the caret at `caret` (default: end) after React re-renders the textarea. */
  const setTextWithCaret = useCallback(
    (value: string, caret?: number) => {
      setText(value)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        const pos = caret ?? value.length
        el.setSelectionRange(pos, pos)
        syncPopupRef.current()
      })
    },
    [setText]
  )

  // ── focus registration ─────────────────────────────────────────────────────

  useEffect(
    () =>
      useAgentStore.getState().registerComposerFocus(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        const end = el.value.length
        el.setSelectionRange(end, end)
      }),
    []
  )

  // Switching tabs keeps the keyboard in the chat when it was already there (never focus a collapsed panel).
  useEffect(() => {
    const el = textareaRef.current
    if (!el || !useLayoutStore.getState().agentVisible || el.offsetWidth === 0) return
    const active = document.activeElement
    if (!active || active === document.body || active.closest('[data-agent-panel]')) el.focus({ preventScroll: true })
  }, [])

  // ── auto-grow (max ≈ 40% of the panel height) ──────────────────────────────

  const resize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const panel = el.closest<HTMLElement>('[data-agent-panel]')
    const max = Math.max(96, Math.round((panel?.clientHeight ?? 720) * 0.4))
    el.style.height = 'auto'
    let scroll = el.scrollHeight
    if (!el.value && el.placeholder) {
      // Size an empty input to its (possibly long, suggested-prompt) placeholder.
      el.value = el.placeholder
      scroll = el.scrollHeight
      el.value = ''
    }
    el.style.height = `${Math.min(scroll, max)}px`
    el.style.overflowY = el.value && el.scrollHeight > max ? 'auto' : 'hidden'
  }, [])

  const placeholder = placeholderFor(mode, running, !text ? suggestion : null)
  useLayoutEffect(resize, [text, placeholder, resize])

  useEffect(() => {
    const el = cardRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== last) {
        last = el.clientWidth
        resize()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [resize])

  // ── @ / slash popup ────────────────────────────────────────────────────────

  const computeAnchor = useCallback((p: ComposerPopup): PopupAnchor | null => {
    const el = textareaRef.current
    const card = cardRef.current
    if (!el || !card) return null
    const box = card.getBoundingClientRect()
    const bottom = window.innerHeight - box.top + 6
    if (p.kind === 'mention') {
      const width = Math.min(440, Math.max(260, box.width))
      const caret = caretCoordinates(el, p.start)
      let left = el.getBoundingClientRect().left + caret.left - 10
      left = Math.max(box.left, Math.min(left, box.right - width))
      left = Math.max(6, Math.min(left, window.innerWidth - width - 6))
      return { left, bottom, width }
    }
    const width = Math.min(560, box.width)
    return { left: Math.max(6, box.left), bottom, width }
  }, [])

  const syncPopup = useCallback(() => {
    const el = textareaRef.current
    if (!el || document.activeElement !== el || el.selectionStart !== el.selectionEnd) {
      setPopup(null)
      return
    }
    const value = el.value
    if (dismissedValue.current !== null) {
      if (dismissedValue.current === value) {
        setPopup(null)
        return
      }
      dismissedValue.current = null
    }
    const next = detectPopup(value, el.selectionStart)
    setPopup((prev) => (samePopup(prev, next) ? prev : next))
    setAnchor(next ? computeAnchor(next) : null)
  }, [computeAnchor])

  useLayoutEffect(() => {
    syncPopupRef.current = syncPopup
  }, [syncPopup])

  const closePopup = useCallback(() => {
    dismissedValue.current = textareaRef.current?.value ?? null
    setPopup(null)
  }, [])

  const onMentionSelect = useCallback(
    (item: MentionItem) => {
      const el = textareaRef.current
      if (!el || popup?.kind !== 'mention') return
      const value = el.value
      const start = popup.start
      const end = Math.max(start + 1, el.selectionStart ?? start + 1 + popup.query.length)
      let tail = value.slice(end)
      if ((start === 0 || /\s/.test(value[start - 1] ?? '')) && tail.startsWith(' ')) tail = tail.slice(1)
      setPopup(null)
      setTextWithCaret(value.slice(0, start) + tail, start)
      resolveMention(item, workspace)
        .then((att) => useAgentStore.getState().addAttachment(att, chatId))
        .catch((err: unknown) => toast.info(errorMessage(err)))
    },
    [popup, workspace, chatId, setTextWithCaret]
  )

  const submit = useCallback(async () => {
    const s = useAgentStore.getState()
    const c = s.chats[chatId]
    if (!c) return
    const { text: value, attachments: atts, images: imgs } = c.composer
    if (!value.trim() && !atts.length && !imgs.length) return
    setPopup(null)
    recallIndex.current = -1
    recalledText.current = null
    if (value.trim().startsWith('/') && runLocalCommand(chatId, value)) return
    await s.send(undefined, { chatId })
  }, [chatId])

  const onSlashSelect = useCallback(
    (item: SlashItem, via: PopupSelectVia) => {
      const el = textareaRef.current
      const store = useAgentStore.getState()
      setPopup(null)
      switch (item.kind) {
        case 'mode-arg':
          store.setMode(item.mode.id, chatId)
          setTextWithCaret('')
          return
        case 'model-arg':
          store.setModel(item.model.value, chatId)
          setTextWithCaret('')
          return
        case 'local':
          if (item.name === 'mode' || item.name === 'model') setTextWithCaret(`/${item.name} `)
          else runLocalCommand(chatId, `/${item.name}`)
          return
        case 'command': {
          const value = el?.value ?? ''
          const firstSpace = value.search(/\s/)
          const token = (firstSpace === -1 ? value : value.slice(0, firstSpace)).slice(1)
          // Enter on a fully typed command runs it right away; Tab / click completes it.
          if (via === 'enter' && token === item.name) {
            void submit()
            return
          }
          const rest = firstSpace === -1 ? '' : value.slice(firstSpace).replace(/^\s+/, '')
          const head = `/${item.name} `
          setTextWithCaret(head + rest, head.length)
        }
      }
    },
    [chatId, setTextWithCaret, submit]
  )

  // ── picker requests the toolbar cannot honour ──────────────────────────────

  const pickerRequest = usePickerStore((s) => s.request)
  useEffect(() => {
    if (!pickerRequest) return
    const { consume } = usePickerStore.getState()
    if (pickerRequest.kind === 'effort' && !model.supportsEffort) {
      consume(pickerRequest.id)
      toast.info(`${model.label} has no adjustable reasoning effort`)
    } else if (pickerRequest.kind === 'permission' && mode.forcedPermissionMode === 'plan') {
      consume(pickerRequest.id)
      toast.info(`${mode.name} mode is read-only`, 'Approving the plan lets you choose how edits are applied.')
    }
  }, [pickerRequest, model, mode])

  // ── keyboard ───────────────────────────────────────────────────────────────

  const recall = (direction: -1 | 1): boolean => {
    const history = userHistory(chatId)
    if (!history.length) return false
    let idx = recallIndex.current
    if (direction === -1) idx = idx < 0 ? history.length - 1 : Math.max(0, idx - 1)
    else if (idx < 0) return false
    else idx += 1
    if (idx >= history.length) {
      recallIndex.current = -1
      recalledText.current = null
      setTextWithCaret('')
      return true
    }
    recallIndex.current = idx
    recalledText.current = history[idx]
    setTextWithCaret(history[idx])
    return true
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (popup && popupHandle.current?.onKeyDown(e)) return
    const el = e.currentTarget
    const plain = !e.altKey && !e.metaKey && !e.ctrlKey

    if (e.key === 'Tab' && e.shiftKey && plain) {
      e.preventDefault()
      useAgentStore.getState().cycleMode(1, chatId)
      return
    }
    if (e.key === 'Tab' && !e.shiftKey && plain && !el.value && suggestion) {
      e.preventDefault()
      useAgentStore.getState().acceptSuggestion(chatId)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      void submit()
      return
    }
    if (e.key === 'Escape') {
      if (running) {
        e.preventDefault()
        e.stopPropagation()
        void useAgentStore.getState().interrupt(chatId)
      } else if (suggestion && !el.value) {
        e.preventDefault()
        useAgentStore.getState().dismissSuggestion(chatId)
      }
      return
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && plain && !e.shiftKey) {
      const value = el.value
      const recalled = recallIndex.current >= 0 && value === recalledText.current
      const multiline = value.includes('\n')
      if (e.key === 'ArrowUp') {
        const atStart = el.selectionStart === 0 && el.selectionEnd === 0
        if ((!value && recallIndex.current < 0) || (recalled && (!multiline || atStart))) {
          if (recall(-1)) e.preventDefault()
        }
      } else if (recalled) {
        const atEnd = el.selectionStart === value.length
        if ((!multiline || atEnd) && recall(1)) e.preventDefault()
      }
    }
  }

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value
    if (recallIndex.current >= 0 && value !== recalledText.current) {
      recallIndex.current = -1
      recalledText.current = null
    }
    setText(value)
    syncPopup()
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(e.clipboardData.files).filter(isImageFile)
    if (!files.length) return
    const plainText = e.clipboardData.getData('text/plain')
    // Keep real text pastes; a lone file name next to the image (Finder / Explorer copy) is dropped.
    if (!plainText || !/\s/.test(plainText.trim()) || files.some((f) => f.name === plainText.trim())) e.preventDefault()
    void addImageFiles(files, chatId)
  }

  const onPickImages = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length) void addImageFiles(files, chatId).then(() => textareaRef.current?.focus())
  }

  const sendTitle = running ? `Queue message — sent when ATOM is ready (${formatKeybinding('enter')})` : `Send (${formatKeybinding('enter')})`

  return (
    <div className="@container relative">
      <div
        ref={cardRef}
        className={cn(
          'relative rounded-xl border border-line bg-elevated transition-[border-color,box-shadow] duration-150',
          'hover:border-line-strong focus-within:border-accent/70 focus-within:shadow-glow'
        )}
      >
        <AttachmentChips chatId={chatId} attachments={attachments} images={images} workspace={workspace} />
        <div className="relative px-3 pt-2.5">
          <textarea
            ref={textareaRef}
            value={text}
            rows={1}
            spellCheck
            aria-label="Message ATOM"
            placeholder={placeholder}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onSelect={syncPopup}
            onClick={syncPopup}
            onBlur={() => setPopup(null)}
            onPaste={onPaste}
            className={cn(
              'block min-h-[40px] w-full resize-none bg-transparent text-[13px] leading-[1.5] text-fg outline-none placeholder:text-subtle',
              suggestion && !text && 'placeholder:italic',
              suggestion && !text && 'pr-14'
            )}
          />
          {suggestion && !text && (
            <span className="pointer-events-none absolute right-3 top-2.5 flex items-center gap-1 text-[10.5px] text-subtle" title="Press Tab to use the suggested prompt">
              <Kbd keys="tab" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 px-1.5 pb-1.5 pt-1">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
            <ModePicker chatId={chatId} />
            <ModelPicker chatId={chatId} />
            <EffortPicker chatId={chatId} />
            <PermissionPicker chatId={chatId} />
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {queuedCount > 0 && (
              <span
                title={`${queuedCount} message${queuedCount === 1 ? '' : 's'} queued — delivered when ATOM reaches the next step`}
                className="flex h-5 items-center gap-1 rounded-md bg-accent-soft px-1.5 text-[10.5px] font-medium text-accent"
              >
                <Clock size={11} />
                <span className="hidden @xs:inline">Queued</span>
                <span className="tabular-nums">{queuedCount}</span>
              </span>
            )}
            <button
              type="button"
              title="Attach images (or paste / drop them)"
              aria-label="Attach images"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <ImagePlus size={14} />
            </button>
            <ContextRing chatId={chatId} />
            {running && (
              <button
                type="button"
                title="Stop (Esc)"
                aria-label="Stop"
                onClick={() => void useAgentStore.getState().interrupt(chatId)}
                className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-fg text-app transition-opacity hover:opacity-85"
              >
                <Square size={10} fill="currentColor" strokeWidth={0} />
              </button>
            )}
            {(!running || hasContent) && (
              <button
                type="button"
                title={sendTitle}
                aria-label={running ? 'Queue message' : 'Send'}
                disabled={!hasContent}
                onClick={() => void submit()}
                className={cn(
                  'ml-0.5 flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-100',
                  hasContent ? 'bg-accent text-accent-fg shadow-sm hover:bg-accent-hover' : 'bg-active text-subtle'
                )}
              >
                <ArrowUp size={15} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={onPickImages} />
      {popup && anchor && popup.kind === 'mention' && (
        <MentionMenu query={popup.query} anchor={anchor} workspace={workspace} handleRef={popupHandle} onSelect={onMentionSelect} onClose={closePopup} />
      )}
      {popup && anchor && (popup.kind === 'slash' || popup.kind === 'slash-arg') && (
        <SlashMenu chatId={chatId} popup={popup} anchor={anchor} handleRef={popupHandle} onSelect={onSlashSelect} onClose={closePopup} />
      )}
    </div>
  )
}
