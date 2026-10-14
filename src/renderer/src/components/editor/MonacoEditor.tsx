import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Editor, type OnMount } from '@monaco-editor/react'
import { atom } from '../../lib/api'
import { fileUri, monaco } from '../../lib/monaco'
import { withBundledFonts } from '../../lib/xterm-theme'
import { useSettingsStore } from '../../stores/settings'
import { flushPendingReveal, getActiveCodeEditor, registerInlineEditHandler, samePath, setActiveCodeEditor, useEditorStore } from '../../stores/editor'
import { Spinner } from '../ui'
import { addToChat } from './commands'
import { InlineEditSession, InlineEditWidget } from './InlineEditWidget'

// Cross-file navigation (Go to Definition, peek → open) and links go through ATOM's tabs / the OS browser.
monaco.editor.registerEditorOpener({
  openCodeEditor(_source, resource, selectionOrPosition) {
    if (resource.scheme !== 'file') return false
    let line: number | undefined
    let column: number | undefined
    if (selectionOrPosition) {
      if ('startLineNumber' in selectionOrPosition) {
        line = selectionOrPosition.startLineNumber
        column = selectionOrPosition.startColumn
      } else {
        line = selectionOrPosition.lineNumber
        column = selectionOrPosition.column
      }
    }
    void useEditorStore.getState().openFile(resource.fsPath, { line, column, preview: true })
    return true
  }
})

monaco.editor.registerLinkOpener({
  open(resource) {
    if (resource.scheme === 'http' || resource.scheme === 'https' || resource.scheme === 'mailto') {
      void atom.app.openExternal(resource.toString(true))
      return true
    }
    if (resource.scheme === 'file') {
      void useEditorStore.getState().openFile(resource.fsPath, { preview: true })
      return true
    }
    return false
  }
})

/** Monaco options derived from Settings → Editor (shared by the code and diff editors). */
export function useEditorOptions(): monaco.editor.IStandaloneEditorConstructionOptions {
  const e = useSettingsStore((s) => s.settings.editor)
  return useMemo(
    () => ({
      fontSize: e.fontSize,
      fontFamily: withBundledFonts(e.fontFamily),
      fontLigatures: true,
      lineHeight: Math.round(e.fontSize * 1.55),
      tabSize: e.tabSize,
      insertSpaces: e.insertSpaces,
      wordWrap: e.wordWrap ? 'on' : 'off',
      minimap: { enabled: e.minimap, renderCharacters: false, maxColumn: 100, showSlider: 'mouseover' },
      lineNumbers: e.lineNumbers ? 'on' : 'off',
      bracketPairColorization: { enabled: e.bracketPairColorization },
      guides: { bracketPairs: e.bracketPairColorization ? 'active' : false, indentation: true, highlightActiveIndentation: true },
      stickyScroll: { enabled: e.stickyScroll },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      renderLineHighlight: 'all',
      renderWhitespace: 'selection',
      padding: { top: 8, bottom: 8 },
      automaticLayout: true,
      fixedOverflowWidgets: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false, alwaysConsumeMouseWheel: false },
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      showFoldingControls: 'mouseover',
      folding: true,
      linkedEditing: true,
      mouseWheelZoom: false,
      contextmenu: true,
      roundedSelection: true,
      'semanticHighlighting.enabled': false,
      suggest: { preview: true, showStatusBar: false },
      inlineSuggest: { enabled: true },
      unicodeHighlight: { ambiguousCharacters: false },
      accessibilitySupport: 'off',
      dragAndDrop: true,
      // Explorer/tab drags carry the path as text — open the file instead of inserting it.
      dropIntoEditor: { enabled: false }
    }),
    [e]
  )
}

/** The code editor for file tabs. One instance is kept alive and switches models when the active file changes. */
export const MonacoEditor = memo(function MonacoEditor({ path }: { path: string }) {
  const theme = useSettingsStore((s) => s.settings.theme)
  const options = useEditorOptions()
  const uri = useMemo(() => fileUri(path).toString(), [path])
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const reviewKeyRef = useRef<monaco.editor.IContextKey<boolean> | null>(null)
  const [session, setSession] = useState<InlineEditSession | null>(null)
  const sessionRef = useRef<InlineEditSession | null>(null)
  sessionRef.current = session

  const startInlineEdit = useCallback(() => {
    const editor = editorRef.current
    const reviewKey = reviewKeyRef.current
    if (!editor || !reviewKey || !editor.getModel()) return
    const current = sessionRef.current
    if (current) {
      // The shortcut toggles the prompt.
      if (current.phase === 'review') current.reject()
      else current.close()
      return
    }
    const created = new InlineEditSession(editor, {
      reviewKey,
      onClose: () => {
        if (sessionRef.current === created) {
          sessionRef.current = null
          setSession(null)
        }
        requestAnimationFrame(() => editor.focus())
      }
    })
    sessionRef.current = created
    setSession(created)
  }, [])

  useEffect(() => registerInlineEditHandler(startInlineEdit), [startInlineEdit])

  useEffect(
    () => () => {
      sessionRef.current?.close()
      if (editorRef.current && getActiveCodeEditor() === editorRef.current) setActiveCodeEditor(null)
      useEditorStore.getState().setCursor(null)
    },
    []
  )

  /** Actions and listeners registered on mount; disposed with the component (Monaco does not do it for us). */
  const mountDisposables = useRef<monaco.IDisposable[]>([])

  useEffect(
    () => () => {
      mountDisposables.current.forEach((d) => d.dispose())
      mountDisposables.current = []
    },
    []
  )

  const onMount: OnMount = (editor) => {
    editorRef.current = editor
    reviewKeyRef.current = editor.createContextKey<boolean>('atomInlineReview', false)
    const subs = mountDisposables.current

    // Review-phase keys of the inline edit (only active while a proposal is shown). `addAction` scopes the
    // keybindings to this editor instance and returns a disposable — `addCommand` would register global,
    // never-disposed keybindings that pile up every time the editor remounts.
    const reviewAction = (id: string, label: string, keybinding: number, when: string, run: () => void): void => {
      subs.push(editor.addAction({ id, label, keybindings: [keybinding], precondition: 'atomInlineReview', keybindingContext: when, run }))
    }
    reviewAction('atom.inlineEdit.acceptTab', 'Accept ATOM Edit', monaco.KeyCode.Tab, '!suggestWidgetVisible && !inlineSuggestionVisible', () =>
      sessionRef.current?.accept()
    )
    reviewAction('atom.inlineEdit.accept', 'Accept ATOM Edit', monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, 'true', () => sessionRef.current?.accept())
    reviewAction('atom.inlineEdit.reject', 'Reject ATOM Edit', monaco.KeyCode.Escape, '!suggestWidgetVisible && !findWidgetVisible', () =>
      sessionRef.current?.reject()
    )

    // ⌘K / ⌘L are dispatched by the global keybinding registry (editor.inlineEdit / editor.addToChat), which
    // runs before Monaco; the bindings here make them discoverable in the context menu.
    subs.push(
      editor.addAction({
        id: 'atom.inlineEdit',
        label: 'Edit with ATOM',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
        contextMenuGroupId: '0_atom',
        contextMenuOrder: 1,
        run: () => startInlineEdit()
      }),
      editor.addAction({
        id: 'atom.addToChat',
        label: 'Add to Chat',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
        contextMenuGroupId: '0_atom',
        contextMenuOrder: 2,
        run: () => addToChat()
      })
    )

    let raf = 0
    const publishCursor = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const model = editor.getModel()
        const sel = editor.getSelection()
        if (!model || !sel) {
          useEditorStore.getState().setCursor(null)
          return
        }
        const empty = sel.isEmpty()
        useEditorStore.getState().setCursor({
          line: sel.positionLineNumber,
          column: sel.positionColumn,
          selectionLength: empty ? 0 : model.getValueLengthInRange(sel),
          selectionLines: empty ? 0 : sel.endLineNumber - sel.startLineNumber + 1
        })
      })
    }
    subs.push({ dispose: () => cancelAnimationFrame(raf) })

    subs.push(
      editor.onDidChangeCursorSelection(publishCursor),
      editor.onDidFocusEditorText(publishCursor),
      editor.onDidChangeModel(() => {
        // Switching files keeps a previewed inline edit (it is an ordinary undoable edit).
        sessionRef.current?.accept()
        flushPendingReveal(editor)
        publishCursor()
      }),
      editor.onDidBlurEditorWidget(() => {
        if (useSettingsStore.getState().settings.editor.autoSave !== 'onFocusChange') return
        const model = editor.getModel()
        if (!model || model.uri.scheme !== 'file') return
        const store = useEditorStore.getState()
        const tab = store.tabs.find((t) => t.kind === 'file' && samePath(t.path, model.uri.fsPath))
        if (tab?.dirty) void store.saveFile(tab.path, { format: false })
      })
    )

    setActiveCodeEditor(editor)
    publishCursor()
  }

  return (
    <div className="relative h-full w-full">
      <Editor
        path={uri}
        theme={theme}
        options={options}
        keepCurrentModel
        saveViewState
        onMount={onMount}
        loading={
          <div className="flex items-center gap-2 text-[12px] text-subtle">
            <Spinner size={12} /> Loading editor…
          </div>
        }
      />
      {session && createPortal(<InlineEditWidget session={session} />, session.domNode)}
    </div>
  )
})
