/**
 * Integrated terminals. Each instance owns an xterm `Terminal` rendered into a persistent host element that
 * lives outside React, so switching tabs or hiding the panel never disposes the session or its scrollback.
 */
import { create } from 'zustand'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { TerminalInfo } from '@shared/types'
import { basename } from '@shared/paths'
import { atom } from '../lib/api'
import { isMac } from '../lib/platform'
import { buildXtermTheme, withBundledFonts } from '../lib/xterm-theme'
import { useSettingsStore } from './settings'
import { errorMessage, toast } from './toast'
import { useWorkspaceStore } from './workspace'

export interface TerminalInstance {
  id: string
  /** Display title, e.g. "zsh". */
  title: string
  info: TerminalInfo
  /** Exit code once the process ended (the tab stays until a key is pressed). */
  exitCode: number | null
}

interface TerminalRuntime {
  term: Terminal
  fit: FitAddon
  host: HTMLDivElement
  opened: boolean
  cols: number
  rows: number
  disposables: { dispose(): void }[]
}

export interface TerminalState {
  instances: TerminalInstance[]
  activeId: string | null
  creating: boolean
  /** Spawn a new shell in the workspace folder. Resolves with its id (null on failure). */
  create(options?: { cwd?: string; focus?: boolean }): Promise<string | null>
  /** Kill the process and close the tab. */
  kill(id: string): Promise<void>
  setActive(id: string): void
  clear(id?: string): void
}

const runtimes = new Map<string, TerminalRuntime>()
const pendingData = new Map<string, string[]>()
let lastDims = { cols: 120, rows: 30 }

const fontsReady: Promise<unknown> =
  typeof document !== 'undefined' && document.fonts
    ? Promise.race([document.fonts.load('13px "JetBrains Mono Variable"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => undefined)
    : Promise.resolve()

function shellTitle(info: TerminalInfo): string {
  const raw = basename(info.shell || info.title || 'shell').replace(/\.exe$/i, '')
  return raw || 'shell'
}

function terminalOptions() {
  const { settings } = useSettingsStore.getState()
  return {
    fontFamily: withBundledFonts(settings.terminal.fontFamily),
    fontSize: settings.terminal.fontSize,
    cursorBlink: settings.terminal.cursorBlink,
    theme: buildXtermTheme(settings.theme)
  }
}

function writeClipboard(text: string): void {
  void navigator.clipboard.writeText(text).catch(() => document.execCommand('copy'))
}

function createRuntime(id: string): TerminalRuntime {
  const opts = terminalOptions()
  const term = new Terminal({
    ...opts,
    allowProposedApi: true,
    scrollback: 5000,
    lineHeight: 1.2,
    cursorStyle: 'bar',
    cursorInactiveStyle: 'outline',
    macOptionIsMeta: true,
    allowTransparency: false,
    drawBoldTextInBrightColors: true,
    smoothScrollDuration: 0
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon((_event, uri) => void atom.app.openExternal(uri)))

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    const mod = isMac ? e.metaKey : e.ctrlKey
    // Copy: mod+c with a selection (otherwise Ctrl+C goes to the shell as SIGINT). Ctrl+Shift+C on Linux/Windows.
    if (e.code === 'KeyC' && !e.altKey && ((mod && !e.shiftKey && term.hasSelection()) || (!isMac && e.ctrlKey && e.shiftKey))) {
      if (term.hasSelection()) writeClipboard(term.getSelection())
      e.preventDefault()
      return false
    }
    // Paste: let the browser fire its native paste event (xterm handles it) instead of sending ^V.
    if (e.code === 'KeyV' && !e.altKey && (mod || (!isMac && e.ctrlKey && e.shiftKey))) return false
    // mod+k clears the terminal (macOS convention).
    if (isMac && e.metaKey && e.code === 'KeyK' && !e.shiftKey && !e.altKey) {
      term.clear()
      e.preventDefault()
      return false
    }
    return true
  })

  const host = document.createElement('div')
  host.className = 'atom-xterm-host'
  host.style.cssText = 'width:100%;height:100%;overflow:hidden'

  const rt: TerminalRuntime = { term, fit, host, opened: false, cols: lastDims.cols, rows: lastDims.rows, disposables: [] }
  rt.disposables.push(
    term.onData((data) => {
      const inst = useTerminalStore.getState().instances.find((i) => i.id === id)
      if (inst && inst.exitCode !== null) {
        // Defer: disposing the terminal from inside its own onData emitter is unsafe.
        setTimeout(() => closeInstance(id), 0)
        return
      }
      void atom.terminal.write(id, data)
    })
  )
  return rt
}

function closeInstance(id: string): void {
  const rt = runtimes.get(id)
  runtimes.delete(id)
  pendingData.delete(id)
  if (rt) {
    rt.disposables.forEach((d) => d.dispose())
    rt.host.remove()
    rt.term.dispose()
  }
  useTerminalStore.setState((s) => {
    const idx = s.instances.findIndex((i) => i.id === id)
    const instances = s.instances.filter((i) => i.id !== id)
    let activeId = s.activeId
    if (activeId === id) activeId = instances[Math.min(Math.max(idx, 0), instances.length - 1)]?.id ?? null
    return { instances, activeId }
  })
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  instances: [],
  activeId: null,
  creating: false,

  create: async (options = {}) => {
    if (get().creating) return null
    set({ creating: true })
    try {
      const cwd = options.cwd ?? useWorkspaceStore.getState().workspace?.path
      const info = await atom.terminal.create({ cwd, cols: lastDims.cols, rows: lastDims.rows })
      const rt = createRuntime(info.id)
      runtimes.set(info.id, rt)
      const queued = pendingData.get(info.id)
      if (queued) {
        rt.term.write(queued.join(''))
        pendingData.delete(info.id)
      }
      const base = shellTitle(info)
      const instance: TerminalInstance = { id: info.id, title: base, info, exitCode: null }
      set({ instances: [...get().instances, instance], activeId: info.id, creating: false })
      if (options.focus !== false) requestAnimationFrame(() => focusTerminal(info.id))
      return info.id
    } catch (err) {
      set({ creating: false })
      toast.error('Could not start a terminal', errorMessage(err))
      return null
    }
  },

  kill: async (id) => {
    const inst = get().instances.find((i) => i.id === id)
    if (inst && inst.exitCode === null) await atom.terminal.kill(id).catch(() => undefined)
    closeInstance(id)
  },

  setActive: (id) => {
    if (get().instances.some((i) => i.id === id)) set({ activeId: id })
  },

  clear: (id) => {
    const target = id ?? get().activeId
    if (target) runtimes.get(target)?.term.clear()
  }
}))

// ── DOM attachment (used by the <XTerm/> component) ──────────────────────────

/** Mount the terminal's persistent host into `container`. Returns a detach function (does not dispose). */
export function attachTerminal(id: string, container: HTMLElement): () => void {
  const rt = runtimes.get(id)
  if (!rt) return () => undefined
  container.appendChild(rt.host)
  if (!rt.opened) {
    rt.opened = true
    void fontsReady.then(() => {
      if (!rt.host.isConnected || runtimes.get(id) !== rt) {
        rt.opened = false
        return
      }
      rt.term.open(rt.host)
      fitTerminal(id)
    })
  } else {
    requestAnimationFrame(() => fitTerminal(id))
  }
  return () => {
    if (rt.host.parentElement === container) container.removeChild(rt.host)
  }
}

/** Fit the terminal to its container and propagate the size to the pty. */
export function fitTerminal(id: string): void {
  const rt = runtimes.get(id)
  if (!rt || !rt.opened || !rt.host.isConnected || !rt.term.element) return
  const { clientWidth, clientHeight } = rt.host
  if (clientWidth < 20 || clientHeight < 20) return
  try {
    const dims = rt.fit.proposeDimensions()
    if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows) || dims.cols < 2 || dims.rows < 1) return
    if (dims.cols !== rt.term.cols || dims.rows !== rt.term.rows) rt.term.resize(dims.cols, dims.rows)
    if (dims.cols !== rt.cols || dims.rows !== rt.rows) {
      rt.cols = dims.cols
      rt.rows = dims.rows
      lastDims = { cols: dims.cols, rows: dims.rows }
      void atom.terminal.resize(id, dims.cols, dims.rows).catch(() => undefined)
    }
  } catch {
    /* renderer not ready */
  }
}

export function focusTerminal(id?: string): void {
  const target = id ?? useTerminalStore.getState().activeId
  if (target) runtimes.get(target)?.term.focus()
}

export function isTerminalFocused(): boolean {
  const el = document.activeElement
  return !!el && !!el.closest('.atom-xterm-host')
}

/** Text currently selected in a terminal (active terminal by default), or ''. */
export function getTerminalSelection(id?: string): string {
  const target = id ?? useTerminalStore.getState().activeId
  const rt = target ? runtimes.get(target) : undefined
  return rt?.term.hasSelection() ? rt.term.getSelection() : ''
}

/** Plain text of the last `maxChars` characters of a terminal's buffer (active terminal by default). */
export function getTerminalBufferText(maxChars = 8000, id?: string): string {
  const target = id ?? useTerminalStore.getState().activeId
  const rt = target ? runtimes.get(target) : undefined
  if (!rt) return ''
  const buffer = rt.term.buffer.active
  const lines: string[] = []
  let total = 0
  for (let i = buffer.length - 1; i >= 0 && total < maxChars; i--) {
    const line = buffer.getLine(i)
    if (!line) continue
    const text = line.translateToString(true)
    if (line.isWrapped && lines.length) lines[0] = text + lines[0]
    else lines.unshift(text)
    total += text.length + 1
  }
  const out = lines.join('\n').replace(/\n+$/, '')
  return out.length > maxChars ? out.slice(out.length - maxChars) : out
}

// ── Event routing & settings ─────────────────────────────────────────────────

const disposers: Array<() => void> = []

disposers.push(
  atom.terminal.onData((e) => {
    const rt = runtimes.get(e.id)
    if (rt) {
      rt.term.write(e.data)
      return
    }
    // Data can arrive before `create()` resolved; keep it until the instance is registered.
    const queued = pendingData.get(e.id) ?? []
    if (queued.length < 2000) queued.push(e.data)
    pendingData.set(e.id, queued)
  })
)

disposers.push(
  atom.terminal.onExit((e) => {
    const rt = runtimes.get(e.id)
    if (!rt) return
    rt.term.write(`\r\n\x1b[2m[Process exited with code ${e.exitCode}] — press any key to close\x1b[0m\r\n`)
    useTerminalStore.setState((s) => ({ instances: s.instances.map((i) => (i.id === e.id ? { ...i, exitCode: e.exitCode } : i)) }))
  })
)

disposers.push(
  useSettingsStore.subscribe((s, prev) => {
    const themeChanged = s.settings.theme !== prev.settings.theme
    const t = s.settings.terminal
    const p = prev.settings.terminal
    const fontChanged = t.fontFamily !== p.fontFamily || t.fontSize !== p.fontSize
    if (!themeChanged && !fontChanged && t.cursorBlink === p.cursorBlink) return
    const opts = terminalOptions()
    for (const [id, rt] of runtimes) {
      if (themeChanged) rt.term.options.theme = opts.theme
      if (fontChanged) {
        rt.term.options.fontFamily = opts.fontFamily
        rt.term.options.fontSize = opts.fontSize
      }
      rt.term.options.cursorBlink = opts.cursorBlink
      if (fontChanged) requestAnimationFrame(() => fitTerminal(id))
    }
  })
)

if (import.meta.hot) {
  import.meta.hot.dispose(() => disposers.forEach((d) => d()))
}

// ── Bottom panel UI state ────────────────────────────────────────────────────

interface PanelUiState {
  /** True while the bottom panel takes (almost) the whole editor column. */
  maximized: boolean
  toggleMaximized(): void
  /** Reflect the measured state (set by the workbench layout). */
  setMaximized(v: boolean): void
}

let maximizeHandler: (() => void) | null = null

/** The workbench implements maximize/restore (it owns the editor/panel split); it registers itself here. */
export function registerPanelMaximizeHandler(handler: () => void): () => void {
  maximizeHandler = handler
  return () => {
    if (maximizeHandler === handler) maximizeHandler = null
  }
}

export const usePanelUiStore = create<PanelUiState>((set, get) => ({
  maximized: false,
  toggleMaximized: () => maximizeHandler?.(),
  setMaximized: (maximized) => {
    if (get().maximized !== maximized) set({ maximized })
  }
}))
