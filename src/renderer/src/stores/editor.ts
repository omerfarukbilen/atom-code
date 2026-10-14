/**
 * Editor store — tabs, Monaco text models (one per file, keyed by `monaco.Uri.file(path)`), dirty tracking,
 * saving, external-change reloads, agent-edit decorations and per-workspace tab persistence.
 *
 * Implements `EditorStoreApi` from ./contracts. Monaco objects live in module scope (never in React state).
 */
import { create } from 'zustand'
import { diffLines } from 'diff'
import type { FileContent, IdeDiagnostic, WorkspaceInfo } from '@shared/types'
import { basename, dirname, isImagePath, isInside, joinPath, normalizeSlashes, relativePath } from '@shared/paths'
import type { ActiveEditorInfo, DiffTabRequest, EditorStoreApi, EditorTab, OpenFileOptions } from './contracts'
import { atom } from '../lib/api'
import { isMac, isWindows } from '../lib/platform'
import { fileUri, monaco, monacoLanguageForPath } from '../lib/monaco'
import { readThemeColors } from '../lib/xterm-theme'
import { errorMessage, toast } from './toast'
import { useSettingsStore } from './settings'
import { useWorkspaceStore } from './workspace'

// ── Public types ─────────────────────────────────────────────────────────────

export interface DiffTabData {
  originalUri: string
  modifiedUri: string
  readOnly: boolean
  language: string
}

export interface ImageTabData {
  /** data: URL */
  src: string
  size: number
  mtimeMs: number
}

export interface CursorState {
  line: number
  column: number
  /** Selected characters (0 when the selection is empty). */
  selectionLength: number
  /** Number of selected lines (0 when the selection is empty). */
  selectionLines: number
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

export type EditorDialog =
  | { kind: 'confirm-unsaved'; paths: string[]; resolve: (choice: UnsavedChoice) => void }
  | { kind: 'new-file'; initial: string }
  | null

export interface DiagnosticCounts {
  errors: number
  warnings: number
  infos: number
}

/** `openFile` options plus internal flags used by tab restoration. */
export interface InternalOpenFileOptions extends OpenFileOptions {
  /** Suppress error toasts (missing files during restore). */
  silent?: boolean
  /** Make the tab active (default true). */
  activate?: boolean
}

export interface EditorState extends EditorStoreApi {
  openFile(path: string, options?: InternalOpenFileOptions): Promise<void>
  diffData: Record<string, DiffTabData>
  imageData: Record<string, ImageTabData>
  /** Tab ids whose file was deleted on disk while open. */
  deleted: Record<string, true>
  /** Paths edited by the agent during this session. */
  agentEditedPaths: string[]
  /** Cursor of the active text editor (for the status bar). */
  cursor: CursorState | null
  diagnosticCounts: DiagnosticCounts
  /** Bumped whenever Monaco markers change. */
  diagnosticsVersion: number
  dialog: EditorDialog
  recentlyClosed: string[]

  /** Activate a tab; `focus` moves keyboard focus into the editor (default true). */
  setActive(id: string, focus?: boolean): void
  pinTab(id: string): void
  moveTab(id: string, toIndex: number): void
  /** Close several tabs, asking once about unsaved changes. Resolves false when cancelled. */
  closeTabs(ids: string[]): Promise<boolean>
  closeOthers(id: string): Promise<void>
  closeToRight(id: string): Promise<void>
  closeAll(): Promise<void>
  closeSaved(): Promise<void>
  reopenClosed(): Promise<void>
  cycleTab(delta: 1 | -1): void
  saveFile(path: string, options?: { format?: boolean }): Promise<boolean>
  /** Discard unsaved changes and reload the file from disk. */
  revertFile(path: string): Promise<void>
  revealLine(path: string, line: number, options?: { column?: number; endLine?: number; focus?: boolean }): void
  openWelcome(): void
  openNewFileDialog(): void
  createFile(pathInput: string): Promise<boolean>
  closeDialog(): void
  setCursor(cursor: CursorState | null): void
}

// ── Path helpers ─────────────────────────────────────────────────────────────

const caseInsensitive = isWindows || isMac

function pathKey(p: string): string {
  const n = normalizeSlashes(p).replace(/\/+$/, '')
  return caseInsensitive ? n.toLowerCase() : n
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b)
}

function findFileTab(tabs: EditorTab[], path: string): EditorTab | undefined {
  const k = pathKey(path)
  return tabs.find((t) => (t.kind === 'file' || t.kind === 'image') && pathKey(t.path) === k)
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif'
}

function imageMime(path: string): string {
  const ext = basename(path).split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_MIME[ext] ?? 'image/png'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// ── Monaco-side registries (module scope) ────────────────────────────────────

interface FileEntry {
  path: string
  model: monaco.editor.ITextModel
  /** Alternative version id of the model at the last load/save. */
  savedVersion: number
  mtimeMs: number
  disposables: monaco.IDisposable[]
  agentDecorations: string[]
  agentTimer?: number
  autoSaveTimer?: number
}

interface DiffEntry {
  path: string
  original: monaco.editor.ITextModel
  modified: monaco.editor.ITextModel
  savedVersion: number
  disposables: monaco.IDisposable[]
}

const files = new Map<string, FileEntry>()
const diffs = new Map<string, DiffEntry>()
const inflightOpens = new Map<string, Promise<void>>()
const reloadChains = new Map<string, Promise<void>>()
const agentMarks = new Map<string, number>()
const recentReloads = new Map<string, { ranges: LineRange[]; at: number }>()
const conflictToasts = new Map<string, number>()
let mru: string[] = []
let diffCounter = 0

interface LineRange {
  start: number
  end: number
}

let activeCodeEditor: monaco.editor.IStandaloneCodeEditor | null = null
let activeDiffEditor: monaco.editor.IStandaloneDiffEditor | null = null

/** The code editor instance used for file tabs (null until the first file is shown). */
export function getActiveCodeEditor(): monaco.editor.IStandaloneCodeEditor | null {
  return activeCodeEditor
}

export function setActiveCodeEditor(editor: monaco.editor.IStandaloneCodeEditor | null): void {
  activeCodeEditor = editor
  if (editor) flushPendingReveal(editor)
}

export function getActiveDiffEditor(): monaco.editor.IStandaloneDiffEditor | null {
  return activeDiffEditor
}

export function setActiveDiffEditor(editor: monaco.editor.IStandaloneDiffEditor | null): void {
  activeDiffEditor = editor
}

/** The text editor showing the active tab: the file editor, or the modified side of a diff. */
export function getActiveMonacoEditor(): monaco.editor.ICodeEditor | null {
  const { tabs, activeTabId } = useEditorStore.getState()
  const tab = tabs.find((t) => t.id === activeTabId)
  if (!tab) return null
  if (tab.kind === 'file') {
    const entry = files.get(pathKey(tab.path))
    return activeCodeEditor && entry && activeCodeEditor.getModel() === entry.model ? activeCodeEditor : null
  }
  if (tab.kind === 'diff') return activeDiffEditor?.getModifiedEditor() ?? null
  return null
}

/** The Monaco model ATOM keeps for an open file, if any. */
export function getFileModel(path: string): monaco.editor.ITextModel | null {
  return files.get(pathKey(path))?.model ?? null
}

export function getDiffModels(tabId: string): { original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null {
  const d = diffs.get(tabId)
  return d ? { original: d.original, modified: d.modified } : null
}

// Inline edit is implemented by the mounted MonacoEditor component; commands trigger it through here.
let inlineEditHandler: (() => void) | null = null

export function registerInlineEditHandler(handler: () => void): () => void {
  inlineEditHandler = handler
  return () => {
    if (inlineEditHandler === handler) inlineEditHandler = null
  }
}

export function triggerInlineEdit(): boolean {
  if (!inlineEditHandler) return false
  inlineEditHandler()
  return true
}

// ── Reveal ───────────────────────────────────────────────────────────────────

interface PendingReveal {
  key: string
  line?: number
  column?: number
  endLine?: number
  focus: boolean
}

let pendingReveal: PendingReveal | null = null

function requestReveal(path: string, r: Omit<PendingReveal, 'key'>): void {
  pendingReveal = { key: pathKey(path), ...r }
  if (activeCodeEditor) flushPendingReveal(activeCodeEditor)
}

/** Apply a queued reveal once `editor` shows the requested model. Called on mount and model switches. */
export function flushPendingReveal(editor: monaco.editor.ICodeEditor): void {
  const p = pendingReveal
  const model = editor.getModel()
  if (!p || !model || pathKey(model.uri.fsPath) !== p.key || model.uri.scheme !== 'file') return
  pendingReveal = null
  if (p.line !== undefined) revealInEditor(editor, p.line, p.endLine, p.column)
  if (p.focus) requestAnimationFrame(() => editor.focus())
}

export function revealInEditor(editor: monaco.editor.ICodeEditor, line: number, endLine?: number, column?: number): void {
  const model = editor.getModel()
  if (!model) return
  const count = model.getLineCount()
  const start = Math.max(1, Math.min(line, count))
  const end = Math.max(start, Math.min(endLine ?? start, count))
  const col = Math.max(1, Math.min(column ?? 1, model.getLineMaxColumn(start)))
  editor.setSelection(new monaco.Range(start, col, start, col))
  editor.revealRangeInCenterIfOutsideViewport(new monaco.Range(start, 1, end, 1), monaco.editor.ScrollType.Smooth)
  const ids = model.deltaDecorations(
    [],
    [
      {
        range: new monaco.Range(start, 1, end, 1),
        options: { isWholeLine: true, className: 'atom-reveal-highlight' }
      }
    ]
  )
  window.setTimeout(() => {
    if (!model.isDisposed()) model.deltaDecorations(ids, [])
  }, 1600)
}

// ── Text diff helpers ────────────────────────────────────────────────────────

/**
 * Replace `model`'s content with `next` using minimal edits (keeps cursors, folding and scroll position in
 * untouched regions, and stays undoable). Returns the changed line ranges in the new text.
 */
function applyMinimalEdits(model: monaco.editor.ITextModel, next: string): LineRange[] {
  const wantCrlf = next.includes('\r\n')
  const eol = wantCrlf ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF
  if ((model.getEOL() === '\r\n') !== wantCrlf && /\n/.test(next)) model.pushEOL(eol)
  const current = model.getValue()
  if (current === next) return []

  const changes = diffLines(current, next)
  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = []
  const ranges: LineRange[] = []
  let oldOffset = 0
  let newLine = 1
  for (let i = 0; i < changes.length; i++) {
    const ch = changes[i]
    if (!ch.added && !ch.removed) {
      oldOffset += ch.value.length
      newLine += ch.count
      continue
    }
    let removedText = ''
    let addedText = ''
    let addedLines = 0
    if (ch.removed) {
      removedText = ch.value
      const nextCh = changes[i + 1]
      if (nextCh?.added) {
        addedText = nextCh.value
        addedLines = nextCh.count
        i++
      }
    } else {
      addedText = ch.value
      addedLines = ch.count
    }
    const start = model.getPositionAt(oldOffset)
    const end = model.getPositionAt(oldOffset + removedText.length)
    edits.push({ range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), text: addedText, forceMoveMarkers: true })
    if (addedLines > 0) ranges.push({ start: newLine, end: newLine + addedLines - 1 })
    oldOffset += removedText.length
    newLine += addedLines
  }
  model.pushStackElement()
  model.pushEditOperations([], edits, () => null)
  model.pushStackElement()
  return ranges
}

function accentHex(): string {
  return readThemeColors(useSettingsStore.getState().settings.theme).accent
}

function decorateAgentLines(entry: FileEntry, ranges: LineRange[]): void {
  if (!ranges.length || entry.model.isDisposed()) return
  window.clearTimeout(entry.agentTimer)
  const color = accentHex()
  const count = entry.model.getLineCount()
  entry.agentDecorations = entry.model.deltaDecorations(
    entry.agentDecorations,
    ranges.map((r) => ({
      range: new monaco.Range(Math.min(r.start, count), 1, Math.min(r.end, count), 1),
      options: {
        isWholeLine: true,
        className: 'atom-agent-changed-line',
        linesDecorationsClassName: 'atom-agent-changed-gutter',
        overviewRuler: { color, position: monaco.editor.OverviewRulerLane.Left },
        minimap: { color, position: monaco.editor.MinimapPosition.Gutter }
      }
    }))
  )
  entry.agentTimer = window.setTimeout(() => {
    if (!entry.model.isDisposed()) entry.agentDecorations = entry.model.deltaDecorations(entry.agentDecorations, [])
  }, 6000)
}

// ── Store ────────────────────────────────────────────────────────────────────

function emptyCounts(): DiagnosticCounts {
  return { errors: 0, warnings: 0, infos: 0 }
}

export const useEditorStore = create<EditorState>((set, get) => {
  // ---- internal helpers (closures over set/get) ----

  const patchTab = (id: string, patch: Partial<EditorTab>): void => {
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  }

  const touchMru = (id: string): void => {
    mru = [id, ...mru.filter((x) => x !== id)]
  }

  const activate = (id: string): void => {
    if (get().activeTabId !== id) set({ activeTabId: id })
    touchMru(id)
  }

  const updateFileDirty = (entry: FileEntry): void => {
    const tab = findFileTab(get().tabs, entry.path)
    if (!tab) return
    const dirty = entry.model.getAlternativeVersionId() !== entry.savedVersion
    if (tab.dirty !== dirty) patchTab(tab.id, dirty ? { dirty, preview: false } : { dirty })
  }

  const scheduleAutoSave = (entry: FileEntry): void => {
    const { autoSave, autoSaveDelayMs } = useSettingsStore.getState().settings.editor
    window.clearTimeout(entry.autoSaveTimer)
    if (autoSave !== 'afterDelay') return
    entry.autoSaveTimer = window.setTimeout(() => {
      if (entry.model.isDisposed()) return
      if (entry.model.getAlternativeVersionId() !== entry.savedVersion) void get().saveFile(entry.path, { format: false })
    }, Math.max(200, autoSaveDelayMs))
  }

  const ensureFileEntry = (path: string, content: string, mtimeMs: number): FileEntry => {
    const k = pathKey(path)
    const existing = files.get(k)
    if (existing && !existing.model.isDisposed()) return existing
    const uri = fileUri(path)
    let model = monaco.editor.getModel(uri)
    if (model) {
      if (model.getValue() !== content) model.setValue(content)
    } else {
      model = monaco.editor.createModel(content, monacoLanguageForPath(path), uri)
    }
    const { tabSize, insertSpaces } = useSettingsStore.getState().settings.editor
    // Respect the file's own indentation; the settings are the fallback for new/flat files.
    model.detectIndentation(insertSpaces, tabSize)
    const entry: FileEntry = { path, model, savedVersion: model.getAlternativeVersionId(), mtimeMs, disposables: [], agentDecorations: [] }
    entry.disposables.push(
      model.onDidChangeContent(() => {
        updateFileDirty(entry)
        scheduleAutoSave(entry)
      })
    )
    files.set(k, entry)
    return entry
  }

  const disposeFileEntry = (path: string): void => {
    const k = pathKey(path)
    const entry = files.get(k)
    if (!entry) return
    files.delete(k)
    window.clearTimeout(entry.agentTimer)
    window.clearTimeout(entry.autoSaveTimer)
    // Let React switch the editor to another model first.
    window.setTimeout(() => {
      entry.disposables.forEach((d) => d.dispose())
      if (!entry.model.isDisposed()) entry.model.dispose()
    }, 0)
  }

  const disposeDiffEntry = (id: string): void => {
    const d = diffs.get(id)
    if (!d) return
    diffs.delete(id)
    window.setTimeout(() => {
      d.disposables.forEach((x) => x.dispose())
      if (!d.original.isDisposed()) d.original.dispose()
      if (!d.modified.isDisposed()) d.modified.dispose()
    }, 0)
  }

  /** Insert a new tab after the active one, or replace the current preview tab. */
  const insertTab = (tab: EditorTab, activateIt: boolean): void => {
    const { tabs, activeTabId } = get()
    const previewIdx = tab.preview ? tabs.findIndex((t) => t.preview && !t.dirty) : -1
    let next: EditorTab[]
    if (previewIdx >= 0) {
      const replaced = tabs[previewIdx]
      next = tabs.slice()
      next[previewIdx] = tab
      if (replaced.kind === 'file') disposeFileEntry(replaced.path)
      mru = mru.filter((x) => x !== replaced.id)
      const imgs = { ...get().imageData }
      delete imgs[replaced.id]
      set({ imageData: imgs })
    } else {
      const activeIdx = tabs.findIndex((t) => t.id === activeTabId)
      next = tabs.slice()
      next.splice(activeIdx >= 0 ? activeIdx + 1 : tabs.length, 0, tab)
    }
    set({ tabs: next })
    if (activateIt) activate(tab.id)
    else mru = [...mru, tab.id]
  }

  const askUnsaved = (paths: string[]): Promise<UnsavedChoice> =>
    new Promise<UnsavedChoice>((resolve) => {
      const prev = get().dialog
      if (prev?.kind === 'confirm-unsaved') prev.resolve('cancel')
      set({
        dialog: {
          kind: 'confirm-unsaved',
          paths,
          resolve: (choice) => {
            set({ dialog: null })
            resolve(choice)
          }
        }
      })
      void ensureDialogHost()
    })

  const notifyConflict = (path: string): void => {
    const k = pathKey(path)
    const last = conflictToasts.get(k) ?? 0
    if (Date.now() - last < 6000) return
    conflictToasts.set(k, Date.now())
    toast.show(
      {
        kind: 'warning',
        message: 'File changed on disk',
        detail: `${basename(path)} has unsaved changes. Reloading will discard them.`,
        action: { label: 'Reload', run: () => void get().revertFile(path) }
      },
      12000
    )
  }

  const reloadInternal = (path: string, force: boolean): Promise<void> => {
    const k = pathKey(path)
    const prev = reloadChains.get(k) ?? Promise.resolve()
    const run = prev.then(async () => {
      const tab = findFileTab(get().tabs, path)
      if (tab?.kind === 'image') {
        await reloadImage(tab.id, path)
        return
      }
      const entry = files.get(k)
      if (!entry || entry.model.isDisposed()) return
      let content: FileContent
      try {
        content = await atom.fs.readFile(path)
      } catch {
        return
      }
      if (content.isBinary || content.tooLarge || entry.model.isDisposed()) return
      clearDeleted(path)
      const dirty = entry.model.getAlternativeVersionId() !== entry.savedVersion
      if (entry.model.getValue() === content.content) {
        entry.mtimeMs = content.mtimeMs
        if (force && dirty) {
          entry.savedVersion = entry.model.getAlternativeVersionId()
          updateFileDirty(entry)
        }
        return
      }
      if (dirty && !force) {
        notifyConflict(path)
        return
      }
      const ranges = applyMinimalEdits(entry.model, content.content)
      entry.savedVersion = entry.model.getAlternativeVersionId()
      entry.mtimeMs = content.mtimeMs
      updateFileDirty(entry)
      recentReloads.set(k, { ranges, at: Date.now() })
      const mark = agentMarks.get(k)
      if (mark && Date.now() - mark < 10_000) decorateAgentLines(entry, ranges)
    })
    const chained = run.catch((err: unknown) => console.error('[editor] reload failed', path, err))
    reloadChains.set(k, chained)
    void chained.finally(() => {
      if (reloadChains.get(k) === chained) reloadChains.delete(k)
    })
    return chained
  }

  const reloadImage = async (id: string, path: string): Promise<void> => {
    try {
      const content = await atom.fs.readFile(path)
      if (!content.isBinary || content.encoding !== 'base64') return
      clearDeleted(path)
      set({ imageData: { ...get().imageData, [id]: { src: `data:${imageMime(path)};base64,${content.content}`, size: content.size, mtimeMs: content.mtimeMs } } })
    } catch {
      /* ignore */
    }
  }

  const clearDeleted = (path: string): void => {
    const tab = findFileTab(get().tabs, path)
    if (tab && get().deleted[tab.id]) {
      const next = { ...get().deleted }
      delete next[tab.id]
      set({ deleted: next })
    }
  }

  const openFileInternal = async (path: string, options: InternalOpenFileOptions = {}): Promise<void> => {
    const { preview = false, focus = true, silent = false, activate: activateIt = true } = options
    const existing = findFileTab(get().tabs, path)
    if (existing) {
      if (activateIt) activate(existing.id)
      if (!preview && existing.preview) patchTab(existing.id, { preview: false })
      if (existing.kind === 'file' && activateIt) requestReveal(existing.path, { line: options.line, column: options.column, endLine: options.endLine, focus })
      return
    }
    const k = pathKey(path)
    const inflight = inflightOpens.get(k)
    if (inflight) {
      await inflight
      if (findFileTab(get().tabs, path)) await openFileInternal(path, options)
      return
    }
    const task = (async () => {
      let content: FileContent
      try {
        content = await atom.fs.readFile(path)
      } catch (err) {
        if (!silent) toast.error(`Could not open ${basename(path)}`, errorMessage(err))
        return
      }
      const name = basename(path)
      if (content.tooLarge) {
        if (!silent)
          toast.show({
            kind: 'warning',
            message: `${name} is too large to open`,
            detail: `The file is ${formatBytes(content.size)}; the editor opens files up to 5 MB.`,
            action: { label: 'Reveal in file manager', run: () => void atom.app.showItemInFolder(path) }
          })
        return
      }
      if (content.isBinary) {
        if (content.encoding === 'base64' && isImagePath(path)) {
          set({ imageData: { ...get().imageData, [path]: { src: `data:${imageMime(path)};base64,${content.content}`, size: content.size, mtimeMs: content.mtimeMs } } })
          insertTab({ id: path, kind: 'image', path, title: name, language: 'image', dirty: false, preview }, activateIt)
        } else if (!silent) {
          toast.show({
            kind: 'info',
            message: `${name} is a binary file`,
            detail: 'Binary files cannot be displayed in the text editor.',
            action: { label: 'Reveal in file manager', run: () => void atom.app.showItemInFolder(path) }
          })
        }
        return
      }
      const entry = ensureFileEntry(path, content.content, content.mtimeMs)
      insertTab({ id: path, kind: 'file', path, title: name, language: entry.model.getLanguageId(), dirty: false, preview }, activateIt)
      if (activateIt) requestReveal(path, { line: options.line, column: options.column, endLine: options.endLine, focus })
    })()
    inflightOpens.set(k, task)
    try {
      await task
    } finally {
      inflightOpens.delete(k)
    }
  }

  const removeTabs = (ids: string[]): void => {
    const remove = new Set(ids)
    const { tabs, activeTabId } = get()
    const removed = tabs.filter((t) => remove.has(t.id))
    if (!removed.length) return
    const remaining = tabs.filter((t) => !remove.has(t.id))
    mru = mru.filter((x) => !remove.has(x))
    let nextActive = activeTabId
    if (activeTabId && remove.has(activeTabId)) {
      nextActive = mru.find((x) => remaining.some((t) => t.id === x)) ?? null
      if (!nextActive && remaining.length) {
        const idx = tabs.findIndex((t) => t.id === activeTabId)
        nextActive = (remaining[Math.min(idx, remaining.length - 1)] ?? remaining[0]).id
      }
    }
    const imageData = { ...get().imageData }
    const diffData = { ...get().diffData }
    const deleted = { ...get().deleted }
    const closedPaths: string[] = []
    for (const t of removed) {
      delete imageData[t.id]
      delete diffData[t.id]
      delete deleted[t.id]
      if (t.kind === 'file' || t.kind === 'image') closedPaths.push(t.path)
    }
    set({
      tabs: remaining,
      activeTabId: nextActive,
      imageData,
      diffData,
      deleted,
      recentlyClosed: [...closedPaths.reverse(), ...get().recentlyClosed.filter((p) => !closedPaths.some((c) => samePath(c, p)))].slice(0, 30),
      cursor: nextActive === activeTabId ? get().cursor : null
    })
    if (nextActive) touchMru(nextActive)
    for (const t of removed) {
      if (t.kind === 'file') disposeFileEntry(t.path)
      if (t.kind === 'diff') disposeDiffEntry(t.id)
    }
  }

  const saveDiff = async (id: string): Promise<boolean> => {
    const d = diffs.get(id)
    const data = get().diffData[id]
    if (!d || !data || data.readOnly) return true
    const text = d.modified.getValue()
    const version = d.modified.getAlternativeVersionId()
    try {
      const stat = await atom.fs.writeFile(d.path, text)
      d.savedVersion = version
      patchTab(id, { dirty: false })
      const entry = files.get(pathKey(d.path))
      if (entry && !entry.model.isDisposed() && entry.model.getValue() !== text) {
        applyMinimalEdits(entry.model, text)
        entry.savedVersion = entry.model.getAlternativeVersionId()
        entry.mtimeMs = stat.mtimeMs
        updateFileDirty(entry)
      }
      return true
    } catch (err) {
      toast.error(`Could not save ${basename(d.path)}`, errorMessage(err))
      return false
    }
  }

  return {
    tabs: [],
    activeTabId: null,
    diffData: {},
    imageData: {},
    deleted: {},
    agentEditedPaths: [],
    cursor: null,
    diagnosticCounts: emptyCounts(),
    diagnosticsVersion: 0,
    dialog: null,
    recentlyClosed: [],

    openFile: (path, options) => openFileInternal(path, options),

    openDiff: (request: DiffTabRequest) => {
      const { path } = request
      const readOnly = request.readOnly ?? true
      const language = request.language ?? monacoLanguageForPath(path)
      const title = request.title ?? `${basename(path)} (Diff)`
      // Re-use an existing diff tab for the same file and title.
      const existing = get().tabs.find((t) => t.kind === 'diff' && samePath(t.path, path) && t.title === title)
      if (existing) {
        const d = diffs.get(existing.id)
        if (d && !existing.dirty) {
          if (d.original.getValue() !== request.original) d.original.setValue(request.original)
          if (d.modified.getValue() !== request.modified) d.modified.setValue(request.modified)
          d.savedVersion = d.modified.getAlternativeVersionId()
          set({ diffData: { ...get().diffData, [existing.id]: { ...get().diffData[existing.id], readOnly } } })
          activate(existing.id)
          return
        }
      }
      const n = ++diffCounter
      const id = `diff:${path}:${n}`
      const base = normalizeSlashes(path).replace(/^\/*/, '/')
      const original = monaco.editor.createModel(request.original, language, monaco.Uri.from({ scheme: 'atom-diff', path: `/${n}/original${base}` }))
      const modified = monaco.editor.createModel(request.modified, language, monaco.Uri.from({ scheme: 'atom-diff', path: `/${n}/modified${base}` }))
      const entry: DiffEntry = { path, original, modified, savedVersion: modified.getAlternativeVersionId(), disposables: [] }
      entry.disposables.push(
        modified.onDidChangeContent(() => {
          const dirty = get().diffData[id]?.readOnly === false && modified.getAlternativeVersionId() !== entry.savedVersion
          const tab = get().tabs.find((t) => t.id === id)
          if (tab && tab.dirty !== dirty) patchTab(id, { dirty })
        })
      )
      diffs.set(id, entry)
      set({ diffData: { ...get().diffData, [id]: { originalUri: original.uri.toString(), modifiedUri: modified.uri.toString(), readOnly, language } } })
      insertTab({ id, kind: 'diff', path, title, language, dirty: false, preview: false }, true)
    },

    closeTab: async (id) => {
      await get().closeTabs([id])
    },

    closeTabs: async (ids) => {
      const tabs = get().tabs.filter((t) => ids.includes(t.id))
      if (!tabs.length) return true
      const dirty = tabs.filter((t) => t.dirty)
      if (dirty.length) {
        const choice = await askUnsaved(dirty.map((t) => t.path))
        if (choice === 'cancel') return false
        if (choice === 'save') {
          for (const t of dirty) {
            const ok = t.kind === 'diff' ? await saveDiff(t.id) : await get().saveFile(t.path)
            if (!ok) return false
          }
        }
      }
      removeTabs(tabs.map((t) => t.id))
      return true
    },

    closeOthers: async (id) => {
      await get().closeTabs(get().tabs.filter((t) => t.id !== id).map((t) => t.id))
      activate(id)
    },

    closeToRight: async (id) => {
      const tabs = get().tabs
      const idx = tabs.findIndex((t) => t.id === id)
      if (idx < 0) return
      await get().closeTabs(tabs.slice(idx + 1).map((t) => t.id))
    },

    closeAll: async () => {
      await get().closeTabs(get().tabs.map((t) => t.id))
    },

    closeSaved: async () => {
      await get().closeTabs(get().tabs.filter((t) => !t.dirty).map((t) => t.id))
    },

    reopenClosed: async () => {
      const [path, ...rest] = get().recentlyClosed
      if (!path) return
      set({ recentlyClosed: rest })
      await openFileInternal(path, { preview: false })
    },

    cycleTab: (delta) => {
      const { tabs, activeTabId } = get()
      if (tabs.length < 2) return
      const idx = tabs.findIndex((t) => t.id === activeTabId)
      const next = tabs[(idx + delta + tabs.length) % tabs.length]
      activate(next.id)
      if (next.kind === 'file') requestReveal(next.path, { focus: true })
    },

    setActive: (id, focus = true) => {
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab) return
      activate(id)
      if (tab.kind === 'file') requestReveal(tab.path, { focus })
    },

    pinTab: (id) => patchTab(id, { preview: false }),

    moveTab: (id, toIndex) => {
      const tabs = get().tabs.slice()
      const from = tabs.findIndex((t) => t.id === id)
      if (from < 0) return
      const [tab] = tabs.splice(from, 1)
      const target = Math.max(0, Math.min(toIndex > from ? toIndex - 1 : toIndex, tabs.length))
      tabs.splice(target, 0, { ...tab, preview: false })
      set({ tabs })
    },

    saveActive: async () => {
      const { tabs, activeTabId } = get()
      const tab = tabs.find((t) => t.id === activeTabId)
      if (!tab) return
      if (tab.kind === 'file') await get().saveFile(tab.path)
      else if (tab.kind === 'diff') await saveDiff(tab.id)
    },

    saveAll: async () => {
      const active = get().tabs.find((t) => t.id === get().activeTabId)
      for (const t of get().tabs) {
        if (!t.dirty) continue
        if (t.kind === 'file') await get().saveFile(t.path, { format: t.id === active?.id })
        else if (t.kind === 'diff') await saveDiff(t.id)
      }
    },

    saveFile: async (path, options = {}) => {
      const entry = files.get(pathKey(path))
      if (!entry || entry.model.isDisposed()) return false
      window.clearTimeout(entry.autoSaveTimer)
      const { formatOnSave } = useSettingsStore.getState().settings.editor
      if ((options.format ?? true) && formatOnSave && activeCodeEditor && activeCodeEditor.getModel() === entry.model) {
        const action = activeCodeEditor.getAction('editor.action.formatDocument')
        if (action?.isSupported()) {
          await Promise.race([action.run().catch(() => undefined), new Promise((r) => window.setTimeout(r, 2000))])
        }
      }
      const version = entry.model.getAlternativeVersionId()
      const text = entry.model.getValue()
      try {
        const stat = await atom.fs.writeFile(path, text)
        entry.savedVersion = version
        entry.mtimeMs = stat.mtimeMs
        clearDeleted(path)
        updateFileDirty(entry)
        return true
      } catch (err) {
        toast.error(`Could not save ${basename(path)}`, errorMessage(err))
        return false
      }
    },

    revertFile: (path) => reloadInternal(path, true),

    reloadFromDisk: (path) => reloadInternal(path, false),

    revealLine: (path, line, options = {}) => {
      const tab = findFileTab(get().tabs, path)
      if (!tab || tab.kind !== 'file') {
        void openFileInternal(path, { line, column: options.column, endLine: options.endLine, focus: options.focus ?? true })
        return
      }
      activate(tab.id)
      requestReveal(path, { line, column: options.column, endLine: options.endLine, focus: options.focus ?? true })
    },

    getActiveEditorInfo: () => {
      const { tabs, activeTabId, cursor } = get()
      const tab = tabs.find((t) => t.id === activeTabId)
      if (!tab || (tab.kind !== 'file' && tab.kind !== 'diff')) return null
      const editor = getActiveMonacoEditor()
      const model = editor?.getModel()
      if (!editor || !model) {
        return { path: tab.path, language: tab.language, line: cursor?.line ?? 1, column: cursor?.column ?? 1, selection: null }
      }
      const pos = editor.getPosition()
      const sel = editor.getSelection()
      const info: ActiveEditorInfo = {
        path: tab.path,
        language: model.getLanguageId(),
        line: pos?.lineNumber ?? 1,
        column: pos?.column ?? 1,
        selection: sel && !sel.isEmpty() ? { text: model.getValueInRange(sel), startLine: sel.startLineNumber, endLine: sel.endLineNumber } : null
      }
      return info
    },

    getDiagnostics: (path) => collectDiagnostics(path),

    markAgentEdited: (path) => {
      const k = pathKey(path)
      agentMarks.set(k, Date.now())
      if (!get().agentEditedPaths.some((p) => samePath(p, path))) set({ agentEditedPaths: [...get().agentEditedPaths, path] })
      const entry = files.get(k)
      const recent = recentReloads.get(k)
      if (entry && recent && Date.now() - recent.at < 4000) decorateAgentLines(entry, recent.ranges)
      if (findFileTab(get().tabs, path)) void reloadInternal(path, false)
    },

    hasDirtyTabs: () => get().tabs.some((t) => t.dirty),

    openWelcome: () => {
      const existing = get().tabs.find((t) => t.kind === 'welcome')
      if (existing) {
        activate(existing.id)
        return
      }
      insertTab({ id: 'welcome', kind: 'welcome', path: '', title: 'Welcome', language: '', dirty: false, preview: false }, true)
    },

    openNewFileDialog: () => {
      const ws = useWorkspaceStore.getState().workspace
      const active = get().tabs.find((t) => t.id === get().activeTabId)
      let initial = ''
      if (ws && active && (active.kind === 'file' || active.kind === 'image') && isInside(ws.path, active.path)) {
        const rel = relativePath(ws.path, dirname(active.path))
        initial = rel && rel !== '.' ? `${rel}/` : ''
      }
      set({ dialog: { kind: 'new-file', initial } })
      void ensureDialogHost()
    },

    createFile: async (pathInput) => {
      const ws = useWorkspaceStore.getState().workspace
      const input = pathInput.trim().replace(/\\/g, '/')
      if (!input || input.endsWith('/')) {
        toast.warning('Enter a file name')
        return false
      }
      if (input.split('/').some((seg) => seg === '..')) {
        toast.warning('Relative segments ("..") are not allowed')
        return false
      }
      const isAbs = input.startsWith('/') || /^[a-zA-Z]:\//.test(input)
      let abs: string
      if (isAbs) abs = input
      else if (ws) abs = joinPath(ws.path, input.replace(/^(\.\/)+/, ''))
      else {
        toast.warning('Open a folder first', 'New files are created inside the current workspace.')
        return false
      }
      try {
        await atom.fs.createFile(abs, '')
      } catch (err) {
        toast.error(`Could not create ${basename(abs)}`, errorMessage(err))
        return false
      }
      set({ dialog: null })
      await openFileInternal(abs, { preview: false, focus: true })
      return true
    },

    closeDialog: () => {
      const d = get().dialog
      if (d?.kind === 'confirm-unsaved') d.resolve('cancel')
      else set({ dialog: null })
    },

    setCursor: (cursor) => {
      const prev = get().cursor
      if (
        prev === cursor ||
        (prev && cursor && prev.line === cursor.line && prev.column === cursor.column && prev.selectionLength === cursor.selectionLength && prev.selectionLines === cursor.selectionLines)
      )
        return
      set({ cursor })
    }
  }
})

// ── Diagnostics ──────────────────────────────────────────────────────────────

function severityOf(s: monaco.MarkerSeverity): IdeDiagnostic['severity'] {
  switch (s) {
    case monaco.MarkerSeverity.Error:
      return 'error'
    case monaco.MarkerSeverity.Warning:
      return 'warning'
    case monaco.MarkerSeverity.Info:
      return 'info'
    default:
      return 'hint'
  }
}

export function toIdeDiagnostic(m: monaco.editor.IMarker): IdeDiagnostic {
  const code = typeof m.code === 'string' ? m.code : m.code?.value
  return {
    path: m.resource.fsPath,
    severity: severityOf(m.severity),
    message: m.message,
    line: m.startLineNumber,
    column: m.startColumn,
    endLine: m.endLineNumber,
    endColumn: m.endColumn,
    source: m.source ?? m.owner,
    code: code || undefined
  }
}

/** Markers of file models (diff/scratch models are excluded). */
export function getFileMarkers(path?: string): monaco.editor.IMarker[] {
  const markers = path ? monaco.editor.getModelMarkers({ resource: fileUri(path) }) : monaco.editor.getModelMarkers({})
  return markers.filter((m) => m.resource.scheme === 'file')
}

function collectDiagnostics(path?: string): IdeDiagnostic[] {
  return getFileMarkers(path).map(toIdeDiagnostic)
}

let markersTimer = 0
monaco.editor.onDidChangeMarkers(() => {
  if (markersTimer) return
  markersTimer = window.setTimeout(() => {
    markersTimer = 0
    const counts = emptyCounts()
    for (const m of getFileMarkers()) {
      if (m.severity === monaco.MarkerSeverity.Error) counts.errors++
      else if (m.severity === monaco.MarkerSeverity.Warning) counts.warnings++
      else if (m.severity === monaco.MarkerSeverity.Info) counts.infos++
    }
    useEditorStore.setState((s) => ({ diagnosticCounts: counts, diagnosticsVersion: s.diagnosticsVersion + 1 }))
  }, 120)
})

// ── Dialog host fallback ─────────────────────────────────────────────────────

let dialogHosts = 0

/** Called by <EditorDialogs/> on mount/unmount. */
export function registerDialogHost(): () => void {
  dialogHosts++
  return () => {
    dialogHosts--
  }
}

async function ensureDialogHost(): Promise<void> {
  if (dialogHosts > 0) return
  // EditorArea normally renders the dialogs; mount a standalone host if it is not on screen.
  await new Promise((r) => setTimeout(r, 0))
  if (dialogHosts > 0) return
  const mod = await import('../components/editor/EditorDialogs')
  mod.mountStandaloneEditorDialogs()
}

// ── External changes (fs watcher) ────────────────────────────────────────────

function handleFsEvents(events: { kind: string; path: string }[]): void {
  const state = useEditorStore.getState()
  let deleted: Record<string, true> | null = null
  for (const ev of events) {
    if (ev.kind === 'unlinkDir') {
      for (const t of state.tabs) {
        if ((t.kind === 'file' || t.kind === 'image') && isInside(ev.path, t.path)) {
          deleted = deleted ?? { ...state.deleted }
          deleted[t.id] = true
        }
      }
      continue
    }
    const tab = findFileTab(state.tabs, ev.path)
    if (!tab) continue
    if (ev.kind === 'unlink') {
      deleted = deleted ?? { ...state.deleted }
      deleted[tab.id] = true
    } else if (ev.kind === 'change' || ev.kind === 'add') {
      if (tab.kind === 'image') {
        void state.reloadFromDisk(tab.path)
        continue
      }
      const entry = files.get(pathKey(tab.path))
      if (!entry) continue
      void atom.fs
        .stat(tab.path)
        .then((stat) => {
          if (stat.exists && stat.mtimeMs === entry.mtimeMs && ev.kind === 'change') return
          return useEditorStore.getState().reloadFromDisk(tab.path)
        })
        .catch(() => undefined)
    }
  }
  if (deleted) useEditorStore.setState({ deleted })
}

const disposers: Array<() => void> = []
disposers.push(atom.fs.onChange(handleFsEvents))

// Auto-save "onFocusChange": save everything when the window loses focus.
const onWindowBlur = (): void => {
  if (useSettingsStore.getState().settings.editor.autoSave === 'onFocusChange') void useEditorStore.getState().saveAll()
}
window.addEventListener('blur', onWindowBlur)
disposers.push(() => window.removeEventListener('blur', onWindowBlur))

// Keep model indentation in sync with the settings.
disposers.push(
  useSettingsStore.subscribe((s, prev) => {
    const a = s.settings.editor
    const b = prev.settings.editor
    if (a.tabSize === b.tabSize && a.insertSpaces === b.insertSpaces) return
    for (const entry of files.values()) if (!entry.model.isDisposed()) entry.model.detectIndentation(a.insertSpaces, a.tabSize)
  })
)

// ── Per-workspace tab persistence ────────────────────────────────────────────

interface PersistedTabs {
  paths: string[]
  active: string | null
}

const TABS_KEY = 'atom.editor.tabs.v1:'
let currentWorkspace: string | null = null
let restoring = false
let persistTimer = 0

function persistTabs(): void {
  if (!currentWorkspace || restoring) return
  const { tabs, activeTabId } = useEditorStore.getState()
  const saved: PersistedTabs = {
    paths: tabs.filter((t) => t.kind === 'file' || t.kind === 'image').map((t) => t.path),
    active: tabs.find((t) => t.id === activeTabId && (t.kind === 'file' || t.kind === 'image'))?.path ?? null
  }
  try {
    localStorage.setItem(TABS_KEY + currentWorkspace, JSON.stringify(saved))
  } catch {
    /* storage unavailable */
  }
}

function readPersisted(ws: string): PersistedTabs | null {
  try {
    const raw = localStorage.getItem(TABS_KEY + ws)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedTabs>
    return { paths: Array.isArray(parsed.paths) ? parsed.paths.filter((p): p is string => typeof p === 'string') : [], active: typeof parsed.active === 'string' ? parsed.active : null }
  } catch {
    return null
  }
}

async function onWorkspaceChanged(ws: WorkspaceInfo | null): Promise<void> {
  const next = ws?.path ?? null
  if (next === currentWorkspace) return
  window.clearTimeout(persistTimer)
  persistTabs()
  const store = useEditorStore.getState()
  if (currentWorkspace) {
    // Leave dirty buffers open so no work is lost; everything else belongs to the previous workspace.
    const clean = store.tabs.filter((t) => !t.dirty && t.kind !== 'welcome').map((t) => t.id)
    await store.closeTabs(clean)
  }
  currentWorkspace = next
  if (!next) return
  const saved = readPersisted(next)
  if (!saved || !saved.paths.length) return
  restoring = true
  try {
    for (const p of saved.paths.slice(0, 40)) {
      await useEditorStore.getState().openFile(p, { preview: false, focus: false, silent: true, activate: false })
    }
    const st = useEditorStore.getState()
    const activeTab = saved.active ? findFileTab(st.tabs, saved.active) : undefined
    if (activeTab) st.setActive(activeTab.id, false)
    else if (!st.activeTabId && st.tabs.length) st.setActive(st.tabs[st.tabs.length - 1].id, false)
  } finally {
    restoring = false
    persistTabs()
  }
}

disposers.push(
  useEditorStore.subscribe((s, prev) => {
    if (s.tabs === prev.tabs && s.activeTabId === prev.activeTabId) return
    window.clearTimeout(persistTimer)
    persistTimer = window.setTimeout(persistTabs, 250)
  })
)

// Cross-store subscriptions are deferred so circular imports between stores resolve first.
queueMicrotask(() => {
  void onWorkspaceChanged(useWorkspaceStore.getState().workspace)
  disposers.push(
    useWorkspaceStore.subscribe((s, prev) => {
      if (s.workspace?.path !== prev.workspace?.path) void onWorkspaceChanged(s.workspace)
    })
  )
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => disposers.forEach((d) => d()))
}
