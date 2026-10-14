import { app, ipcMain } from 'electron'
import { spawn as spawnChild, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, isAbsolute, join } from 'node:path'
import type * as NodePty from 'node-pty'
import { IPC } from '../../shared/ipc'
import type { TerminalDataEvent, TerminalExitEvent, TerminalInfo } from '../../shared/types'
import { ctx } from '../context'
import { settingsService } from './settings'
import { getCurrentWorkspace } from './workspace'

const RING_BUFFER_CHARS = 200 * 1024
const DATA_BATCH_MS = 8
const MAX_EXITED_KEPT = 20
const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

// ─────────────────────────────────────────────────────────────────────────────
// Environment & shell resolution (cleanProcessEnv is shared with git.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** `process.env` without Electron-internal variables, safe to hand to user processes. */
export function cleanProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    const upper = key.toUpperCase()
    if (upper.startsWith('ELECTRON_') || upper === 'CLAUDE_AGENT_SDK_CLIENT_APP' || upper.startsWith('ATOM_CAPTURE')) continue
    env[key] = value
  }
  return env
}

function terminalEnv(): Record<string, string> {
  const env = cleanProcessEnv()
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'atom-code'
  env.TERM_PROGRAM_VERSION = app.getVersion()
  // Apps launched from the macOS Dock / Linux launchers often have no locale, which breaks UTF-8 in shells.
  if (!IS_WIN && !env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LANG = 'en_US.UTF-8'
  return env
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** Resolve an executable name against PATH (and PATHEXT on Windows). Returns null when not found. */
function resolveExecutable(name: string, env: Record<string, string>): string | null {
  if (isAbsolute(name)) return isFile(name) ? name : null
  if (name.includes('/') || name.includes('\\')) return null
  const pathVar = env.PATH ?? env.Path ?? env.path ?? ''
  const exts = IS_WIN
    ? ['', ...(env.PATHEXT ?? env.Pathext ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase())]
    : ['']
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, name.toLowerCase().endsWith(ext) ? name : name + ext)
      if (isFile(candidate)) return candidate
    }
  }
  return null
}

function defaultShell(): string {
  if (IS_WIN) return 'powershell.exe'
  if (process.env.SHELL) return process.env.SHELL
  if (IS_MAC && existsSync('/bin/zsh')) return '/bin/zsh'
  return existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh'
}

function shellName(shell: string): string {
  return basename(shell).toLowerCase().replace(/\.(exe|cmd|bat)$/, '')
}

const LOGIN_SHELLS = new Set(['bash', 'zsh', 'sh', 'fish', 'ksh', 'dash', 'mksh', 'ash', 'tcsh', 'csh'])
const INTERACTIVE_FLAG_SHELLS = new Set(['bash', 'zsh', 'sh', 'fish', 'ksh', 'dash', 'mksh', 'ash'])

function shellArgs(shell: string, isPty: boolean): string[] {
  const name = shellName(shell)
  if (IS_WIN) return name === 'powershell' || name === 'pwsh' ? ['-NoLogo'] : []
  const args: string[] = []
  // macOS terminals start login shells so ~/.zprofile / ~/.bash_profile (PATH from Homebrew etc.) are loaded.
  if (IS_MAC && LOGIN_SHELLS.has(name)) args.push('-l')
  // Without a TTY, shells only print prompts when forced into interactive mode. Line editing is disabled
  // for bash because it would echo every line a second time (input is echoed locally in pipe mode).
  if (!isPty && name === 'bash') args.push('--noediting')
  if (!isPty && INTERACTIVE_FLAG_SHELLS.has(name)) args.push('-i')
  return args
}

// ─────────────────────────────────────────────────────────────────────────────
// Process backends: node-pty (preferred) and a pipe-based fallback
// ─────────────────────────────────────────────────────────────────────────────

interface ShellProcess {
  readonly pid: number
  readonly isPty: boolean
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: (exitCode: number) => void): void
}

type PtyModule = typeof NodePty
let ptyModulePromise: Promise<PtyModule | null> | null = null

/** node-pty is a native module: load it lazily so a missing/mismatched binary only disables real PTYs. */
function loadPty(): Promise<PtyModule | null> {
  if (!ptyModulePromise) {
    ptyModulePromise = import('node-pty')
      .then((mod: unknown): PtyModule | null => {
        const m = mod as { spawn?: unknown; default?: { spawn?: unknown } }
        if (typeof m.spawn === 'function') return m as PtyModule
        if (m.default && typeof m.default.spawn === 'function') return m.default as PtyModule
        return null
      })
      .catch(() => null)
  }
  return ptyModulePromise
}

function spawnPty(pty: PtyModule, file: string, args: string[], cwd: string, env: Record<string, string>, cols: number, rows: number): ShellProcess {
  const p = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env })
  return {
    pid: p.pid,
    isPty: true,
    write: (data) => p.write(data),
    resize: (c, r) => {
      try {
        p.resize(c, r)
      } catch {
        /* the process may have exited */
      }
    },
    kill: () => {
      try {
        p.kill()
      } catch {
        /* already gone */
      }
    },
    onData: (cb) => {
      p.onData(cb)
    },
    onExit: (cb) => {
      p.onExit(({ exitCode }) => cb(exitCode))
    }
  }
}

/** Remove terminal escape sequences from user input (arrow keys etc. have no meaning without a PTY). */
function stripInputEscapes(data: string): string {
  return data.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1bO[@-~]|\x1b[\s\S]?/g, '')
}

async function spawnPipe(file: string, args: string[], cwd: string, env: Record<string, string>): Promise<ShellProcess> {
  const child: ChildProcessWithoutNullStreams = spawnChild(file, args, {
    cwd,
    env,
    stdio: 'pipe',
    windowsHide: true,
    // Own process group on Unix so Ctrl+C can reach the running command.
    detached: !IS_WIN
  })
  await new Promise<void>((resolveSpawn, rejectSpawn) => {
    child.once('spawn', () => resolveSpawn())
    child.once('error', (err) => rejectSpawn(err))
  })

  // Output/exit may arrive before the caller subscribes: buffer until then.
  const dataListeners: ((data: string) => void)[] = []
  let early: string[] = []
  const emit = (data: string): void => {
    if (dataListeners.length === 0) early.push(data)
    else for (const l of dataListeners) l(data)
  }
  let exitCode: number | null = null
  const exitListeners: ((code: number) => void)[] = []
  // 'close' (not 'exit') fires after stdout/stderr are drained, so no output is lost.
  child.once('close', (code, signal) => {
    exitCode = code ?? (signal ? 128 : 0)
    for (const l of exitListeners) l(exitCode)
  })
  // Without a PTY there is no line discipline: emulate echo, backspace, Enter and Ctrl+C/D locally.
  let line = ''
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      if (!IS_WIN && child.pid) process.kill(-child.pid, signal)
      else child.kill(signal)
    } catch {
      /* gone */
    }
  }

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (d: string) => emit(d.replace(/\r?\n/g, '\r\n')))
  child.stderr.on('data', (d: string) => emit(d.replace(/\r?\n/g, '\r\n')))
  child.stdin.on('error', () => undefined)

  return {
    pid: child.pid ?? 0,
    isPty: false,
    write: (data) => {
      for (const ch of stripInputEscapes(data)) {
        if (ch === '\r' || ch === '\n') {
          emit('\r\n')
          if (child.stdin.writable) child.stdin.write(`${line}${IS_WIN ? '\r\n' : '\n'}`)
          line = ''
        } else if (ch === '\x7f' || ch === '\x08') {
          if (line) {
            line = Array.from(line).slice(0, -1).join('')
            emit('\x08 \x08')
          }
        } else if (ch === '\x03') {
          emit('^C\r\n')
          line = ''
          signalGroup('SIGINT')
        } else if (ch === '\x04') {
          if (child.stdin.writable) child.stdin.end()
        } else if (ch === '\t' || ch >= ' ') {
          line += ch
          emit(ch)
        }
      }
    },
    resize: () => undefined,
    kill: () => {
      signalGroup('SIGHUP')
      if (child.exitCode === null) {
        try {
          child.kill()
        } catch {
          /* gone */
        }
      }
    },
    onData: (cb) => {
      dataListeners.push(cb)
      const buffered = early
      early = []
      for (const d of buffered) cb(d)
    },
    onExit: (cb) => {
      if (exitCode !== null) cb(exitCode)
      else exitListeners.push(cb)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Terminal registry
// ─────────────────────────────────────────────────────────────────────────────

interface TerminalRecord {
  info: TerminalInfo
  proc: ShellProcess
  /** Ring buffer of recent output (raw, with ANSI sequences). */
  output: string
  pending: string
  flushTimer: NodeJS.Timeout | null
  lastActive: number
  exited: boolean
}

const terminals = new Map<string, TerminalRecord>()
let terminalCounter = 0

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(Math.max(n, min), max)
}

function resolveCwd(raw: unknown): string {
  const candidates = [typeof raw === 'string' ? raw : '', getCurrentWorkspace()?.path ?? '', homedir()]
  for (const c of candidates) if (c && isAbsolute(c) && isDirectory(c)) return c
  return process.cwd()
}

function flushNow(rec: TerminalRecord): void {
  if (rec.flushTimer) {
    clearTimeout(rec.flushTimer)
    rec.flushTimer = null
  }
  if (!rec.pending) return
  const payload: TerminalDataEvent = { id: rec.info.id, data: rec.pending }
  rec.pending = ''
  ctx.send(IPC.terminalDataEvent, payload)
}

function appendOutput(rec: TerminalRecord, data: string): void {
  rec.output += data
  // Trim lazily (25 % slack) so we do not copy the buffer on every chunk.
  if (rec.output.length > RING_BUFFER_CHARS * 1.25) rec.output = rec.output.slice(-RING_BUFFER_CHARS)
}

function pruneExited(): void {
  const exited = [...terminals.values()].filter((t) => t.exited).sort((a, b) => a.lastActive - b.lastActive)
  while (exited.length > MAX_EXITED_KEPT) {
    const oldest = exited.shift()
    if (oldest) terminals.delete(oldest.info.id)
  }
}

async function createTerminal(raw: unknown): Promise<TerminalInfo> {
  const opts = isRecord(raw) ? raw : {}
  const cols = clampInt(opts.cols, 80, 2, 1000)
  const rows = clampInt(opts.rows, 24, 1, 500)
  const cwd = resolveCwd(opts.cwd)
  const env = terminalEnv()
  const requested =
    (typeof opts.shell === 'string' && opts.shell.trim()) || settingsService.get().terminal.shell.trim() || defaultShell()
  const shell = resolveExecutable(requested, env)
  if (!shell) throw new Error(`Shell not found: ${requested}. Check Settings → Terminal → Shell.`)

  let proc: ShellProcess
  const pty = await loadPty()
  try {
    if (pty) {
      try {
        proc = spawnPty(pty, shell, shellArgs(shell, true), cwd, env, cols, rows)
      } catch {
        // A broken native binary can throw at spawn time — fall back to pipes rather than failing.
        proc = await spawnPipe(shell, shellArgs(shell, false), cwd, env)
      }
    } else {
      proc = await spawnPipe(shell, shellArgs(shell, false), cwd, env)
    }
  } catch (err) {
    throw new Error(`Could not start ${requested}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const id = `term-${++terminalCounter}`
  const info: TerminalInfo = { id, title: shellName(shell), shell, cwd, pid: proc.pid, isPty: proc.isPty }
  const rec: TerminalRecord = { info, proc, output: '', pending: '', flushTimer: null, lastActive: Date.now(), exited: false }
  terminals.set(id, rec)

  if (!proc.isPty) {
    const notice = '\x1b[2m[ATOM Code] Native terminal support (node-pty) is unavailable — using a basic pipe-based shell.\x1b[0m\r\n'
    appendOutput(rec, notice)
    rec.pending += notice
    rec.flushTimer = setTimeout(() => flushNow(rec), DATA_BATCH_MS)
  }
  proc.onData((data) => {
    appendOutput(rec, data)
    rec.pending += data
    if (!rec.flushTimer) rec.flushTimer = setTimeout(() => flushNow(rec), DATA_BATCH_MS)
  })
  proc.onExit((exitCode) => {
    flushNow(rec)
    rec.exited = true
    const payload: TerminalExitEvent = { id, exitCode }
    ctx.send(IPC.terminalExitEvent, payload)
    pruneExited()
  })

  return info
}

function getTerminal(id: unknown): TerminalRecord {
  if (typeof id !== 'string') throw new Error('Terminal id is required')
  const rec = terminals.get(id)
  if (!rec) throw new Error(`Terminal not found: ${id}`)
  return rec
}

function killTerminal(id: unknown): void {
  if (typeof id !== 'string') return
  const rec = terminals.get(id)
  if (!rec) return
  terminals.delete(id)
  if (rec.flushTimer) clearTimeout(rec.flushTimer)
  rec.flushTimer = null
  if (!rec.exited) rec.proc.kill()
}

// ─────────────────────────────────────────────────────────────────────────────
// Output for the agent (atom-ide get_terminal_output)
// ─────────────────────────────────────────────────────────────────────────────

/** Strip ANSI/VT escape sequences and resolve carriage returns/backspaces into plain text. */
export function stripAnsi(input: string): string {
  let s = input
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '') // OSC (titles, hyperlinks, shell integration)
    .replace(/\x1b[P^_][\s\S]*?\x1b\\/g, '') // DCS / PM / APC
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '') // CSI (colors, cursor movement)
    .replace(/\x1b[()*+][0-9A-Za-z]/g, '') // character set selection
    .replace(/\x1b[@-Z\\^_=>78]/g, '') // other two-character sequences
    .replace(/\x9b[0-?]*[ -/]*[@-~]/g, '') // 8-bit CSI
  // Carriage returns overwrite the line (progress bars): keep what was written last.
  s = s
    .replace(/\r+\n/g, '\n')
    .split('\n')
    .map((line) => {
      const i = line.lastIndexOf('\r')
      return i === -1 ? line : line.slice(i + 1)
    })
    .join('\n')
  if (s.includes('\x08')) {
    const out: string[] = []
    for (const ch of s) {
      if (ch === '\x08') {
        if (out.length > 0 && out[out.length - 1] !== '\n') out.pop()
      } else out.push(ch)
    }
    s = out.join('')
  }
  return s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
}

/** Plain-text tail of the most recently active terminal (ANSI stripped), or '' when there is none. */
export function getTerminalOutput(maxChars = 8000): string {
  let best: TerminalRecord | null = null
  for (const rec of terminals.values()) if (!best || rec.lastActive > best.lastActive) best = rec
  if (!best) return ''
  const limit = clampInt(maxChars, 8000, 1, RING_BUFFER_CHARS)
  const text = stripAnsi(best.output.slice(-RING_BUFFER_CHARS))
  return text.length > limit ? text.slice(-limit) : text
}

export function disposeTerminals(): void {
  for (const id of [...terminals.keys()]) killTerminal(id)
  terminals.clear()
}

export function registerTerminalIpc(): void {
  ipcMain.handle(IPC.terminalCreate, (_e, options: unknown) => createTerminal(options))
  ipcMain.handle(IPC.terminalWrite, (_e, id: unknown, data: unknown) => {
    if (typeof data !== 'string') throw new Error('Terminal input must be a string')
    const rec = getTerminal(id)
    if (rec.exited) return
    rec.lastActive = Date.now()
    rec.proc.write(data)
  })
  ipcMain.handle(IPC.terminalResize, (_e, id: unknown, cols: unknown, rows: unknown) => {
    const rec = getTerminal(id)
    if (rec.exited) return
    rec.proc.resize(clampInt(cols, 80, 2, 1000), clampInt(rows, 24, 1, 500))
  })
  ipcMain.handle(IPC.terminalKill, (_e, id: unknown) => killTerminal(id))
}
