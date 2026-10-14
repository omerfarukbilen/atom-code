import { ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC } from '../../shared/ipc'
import { relativePath } from '../../shared/paths'
import type { SearchFileResult, SearchMatch, SearchResult } from '../../shared/types'
import { unpackedPath } from '../context'
import { assertAbsolutePath, errorMessage, friendlyFsError, onFsChanges } from './fs'
import { settingsService } from './settings'

const FILE_LIST_CAP = 50_000
const FILE_LIST_TTL_MS = 5_000
const FILE_LIST_TIMEOUT_MS = 30_000
const SEARCH_TIMEOUT_MS = 60_000
const DEFAULT_MAX_RESULTS = 2_000
const MAX_RESULTS_LIMIT = 50_000
const PREVIEW_MAX = 300
const PREVIEW_CONTEXT_BEFORE = 60

// ─────────────────────────────────────────────────────────────────────────────
// ripgrep binary & shared arguments
// ─────────────────────────────────────────────────────────────────────────────

let rgPathPromise: Promise<string> | null = null

/** Bundled ripgrep (outside app.asar when packaged); falls back to `rg` on PATH. */
function getRgPath(): Promise<string> {
  if (!rgPathPromise) {
    rgPathPromise = (async () => {
      try {
        // Lazy import: @vscode/ripgrep throws at import time when its platform package is missing.
        const mod = await import('@vscode/ripgrep')
        const p = unpackedPath(mod.rgPath)
        if (existsSync(p)) return p
      } catch {
        /* fall through to PATH lookup */
      }
      return process.platform === 'win32' ? 'rg.exe' : 'rg'
    })()
  }
  return rgPathPromise
}

/** Flags shared by file listing and text search: hidden files, .gitignore aware, no .git, honour filesExclude. */
function commonArgs(): string[] {
  const args = ['--hidden', '--no-config', '--no-messages', '--no-require-git', '--glob', '!.git']
  for (const raw of settingsService.get().filesExclude) {
    const g = raw.trim()
    if (g && g !== '.git' && !g.startsWith('!')) args.push('--glob', `!${g}`)
  }
  return args
}

async function assertDirectory(root: string): Promise<void> {
  try {
    const st = await stat(root)
    if (!st.isDirectory()) throw new Error(`Not a directory: ${root}`)
  } catch (err) {
    throw friendlyFsError(err, root, 'Search')
  }
}

function spawnRg(rg: string, args: string[], cwd: string): ChildProcess {
  return spawn(rg, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
}

function killChild(child: ChildProcess): void {
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }
}

/** Split a streamed chunk into complete lines, carrying the remainder over. */
function makeLineSplitter(onLine: (line: string) => boolean): { push(chunk: string): void; end(): void } {
  let rest = ''
  let stopped = false
  return {
    push(chunk: string) {
      if (stopped) return
      const parts = (rest + chunk).split('\n')
      rest = parts.pop() ?? ''
      for (const part of parts) {
        const line = part.endsWith('\r') ? part.slice(0, -1) : part
        if (line && !onLine(line)) {
          stopped = true
          rest = ''
          return
        }
      }
    },
    end() {
      if (!stopped && rest) onLine(rest.endsWith('\r') ? rest.slice(0, -1) : rest)
      rest = ''
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// File listing (quick open, @-mentions)
// ─────────────────────────────────────────────────────────────────────────────

const fileListCache = new Map<string, { at: number; promise: Promise<string[]> }>()

/**
 * All files of the workspace as absolute paths (gitignore-aware, hidden files included, `.git` excluded),
 * sorted, capped at 50 000. Results are cached per root for 5 s — treat the returned array as read-only.
 */
export async function listWorkspaceFiles(root: string): Promise<string[]> {
  const absRoot = assertAbsolutePath(root, 'Workspace root')
  const now = Date.now()
  for (const [key, entry] of fileListCache) if (now - entry.at >= FILE_LIST_TTL_MS) fileListCache.delete(key)
  const cached = fileListCache.get(absRoot)
  if (cached) return cached.promise
  const promise = runFileList(absRoot)
  fileListCache.set(absRoot, { at: now, promise })
  promise.catch(() => fileListCache.delete(absRoot))
  return promise
}

async function runFileList(root: string): Promise<string[]> {
  await assertDirectory(root)
  const rg = await getRgPath()
  return new Promise<string[]>((resolvePromise, reject) => {
    const files: string[] = []
    let stderr = ''
    let settled = false
    const child = spawnRg(rg, ['--files', ...commonArgs(), '--', '.'], root)

    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      killChild(child)
      if (err) reject(err)
      else resolvePromise(files.sort())
    }
    const timer = setTimeout(() => finish(), FILE_LIST_TIMEOUT_MS)

    const splitter = makeLineSplitter((line) => {
      files.push(join(root, line))
      if (files.length >= FILE_LIST_CAP) {
        finish()
        return false
      }
      return true
    })
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => splitter.push(chunk))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 4000) stderr += chunk
    })
    child.on('error', (err) => finish(new Error(`Could not run ripgrep (${rg}): ${err.message}`)))
    child.on('close', (code) => {
      splitter.end()
      // 0 = files found, 1 = nothing found, 2 = partial errors (e.g. unreadable folders).
      if (code === 0 || code === 1 || code === null || files.length > 0) finish()
      else finish(new Error(`Listing files failed: ${stderr.trim() || `ripgrep exited with code ${code}`}`))
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Text search
// ─────────────────────────────────────────────────────────────────────────────

interface ActiveSearch {
  child: ChildProcess
  cancel: () => void
}

let activeSearch: ActiveSearch | null = null

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** ripgrep encodes paths/lines as `{text}` or, for invalid UTF-8, as base64 `{bytes}`. */
function rgBytes(v: unknown): Buffer | null {
  if (!isRecord(v)) return null
  if (typeof v.text === 'string') return Buffer.from(v.text, 'utf8')
  if (typeof v.bytes === 'string') return Buffer.from(v.bytes, 'base64')
  return null
}

function rgText(v: unknown): string | null {
  if (!isRecord(v)) return null
  if (typeof v.text === 'string') return v.text
  if (typeof v.bytes === 'string') return Buffer.from(v.bytes, 'base64').toString('utf8')
  return null
}

/** Split a comma separated glob list; bare folder names (no glob chars) match the folder anywhere. */
function globList(value: unknown): string[] {
  if (typeof value !== 'string') return []
  const out: string[] = []
  for (const raw of value.split(',')) {
    const g = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    if (!g) continue
    if (/[*?[{]/.test(g) || /\.[^/]+$/.test(g)) out.push(g)
    else {
      const name = g.replace(/\/+$/, '')
      out.push(`**/${name}`, `**/${name}/**`)
    }
  }
  return out
}

interface NormalizedSearchOptions {
  query: string
  isRegex: boolean
  caseSensitive: boolean
  wholeWord: boolean
  include: string[]
  exclude: string[]
  maxResults: number
}

function normalizeOptions(options: unknown): NormalizedSearchOptions {
  if (!isRecord(options)) throw new Error('Search options are required')
  const query = typeof options.query === 'string' ? options.query : ''
  const max = typeof options.maxResults === 'number' && Number.isFinite(options.maxResults) ? Math.floor(options.maxResults) : DEFAULT_MAX_RESULTS
  return {
    query,
    isRegex: options.isRegex === true,
    caseSensitive: options.caseSensitive === true,
    wholeWord: options.wholeWord === true,
    include: globList(options.include),
    exclude: globList(options.exclude),
    maxResults: Math.min(Math.max(max, 1), MAX_RESULTS_LIMIT)
  }
}

function buildSearchArgs(opts: NormalizedSearchOptions): string[] {
  const args = ['--json']
  args.push(opts.caseSensitive ? '--case-sensitive' : '--ignore-case')
  if (opts.isRegex) args.push('--engine', 'auto')
  else args.push('--fixed-strings')
  if (opts.wholeWord) args.push('--word-regexp')
  // ripgrep gives later globs precedence: includes first, then the exclusions so they always win.
  for (const g of opts.include) args.push('--glob', g)
  args.push(...commonArgs())
  for (const g of opts.exclude) args.push('--glob', `!${g}`)
  args.push('--regexp', opts.query, '--', '.')
  return args
}

/** Convert a byte range of a UTF-8 line to UTF-16 offsets. */
function utf16Range(line: Buffer, ascii: boolean, start: number, end: number): { start: number; length: number } {
  if (ascii) return { start, length: end - start }
  const s = line.subarray(0, start).toString('utf8').length
  const len = line.subarray(start, end).toString('utf8').length
  return { start: s, length: len }
}

/**
 * Build the preview for one match. Lines up to 300 chars are returned whole; longer lines are trimmed to 300
 * chars — windowed around the match (with a leading "…") only when the match would otherwise be cut off.
 * The returned column is relative to the preview, as documented on `SearchMatch`.
 */
function buildPreview(lineText: string, start: number, length: number): { preview: string; column: number } {
  if (lineText.length <= PREVIEW_MAX || start + length <= PREVIEW_MAX) {
    return { preview: lineText.slice(0, PREVIEW_MAX), column: start + 1 }
  }
  const from = Math.max(0, start - PREVIEW_CONTEXT_BEFORE)
  const preview = `…${lineText.slice(from, from + PREVIEW_MAX - 1)}`
  return { preview, column: start - from + 2 }
}

function emptyResult(started: number): SearchResult {
  return { files: [], totalMatches: 0, truncated: false, durationMs: Date.now() - started }
}

async function find(root: string, rawOptions: unknown): Promise<SearchResult> {
  const started = Date.now()
  const opts = normalizeOptions(rawOptions)
  if (!opts.query) return emptyResult(started)
  await assertDirectory(root)
  const rg = await getRgPath()

  // Only one search at a time: a new search cancels (and resolves) the previous one.
  activeSearch?.cancel()

  return new Promise<SearchResult>((resolvePromise, reject) => {
    const byPath = new Map<string, SearchFileResult>()
    let totalMatches = 0
    let truncated = false
    let stderr = ''
    let settled = false
    const child = spawnRg(rg, buildSearchArgs(opts), root)

    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      killChild(child)
      if (activeSearch?.child === child) activeSearch = null
      if (err) {
        reject(err)
        return
      }
      const files = [...byPath.values()].sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0))
      resolvePromise({ files, totalMatches, truncated, durationMs: Date.now() - started })
    }
    const timer = setTimeout(() => {
      truncated = true
      finish()
    }, SEARCH_TIMEOUT_MS)

    activeSearch = {
      child,
      cancel: () => {
        truncated = true
        finish()
      }
    }

    const handleMatch = (data: Record<string, unknown>): boolean => {
      const relPath = rgText(data.path)
      const lineBuf = rgBytes(data.lines)
      const lineNumber = typeof data.line_number === 'number' ? data.line_number : null
      if (relPath === null || lineBuf === null || lineNumber === null) return true
      const absPath = join(root, relPath)
      let file = byPath.get(absPath)
      if (!file) {
        file = { path: absPath, relativePath: relativePath(root, absPath), matches: [] }
        byPath.set(absPath, file)
      }
      const lineText = lineBuf.toString('utf8').replace(/\r?\n$/, '')
      const ascii = !/[^\x00-\x7f]/.test(lineText)
      const submatches = Array.isArray(data.submatches) ? data.submatches : []
      for (const sm of submatches) {
        if (!isRecord(sm) || typeof sm.start !== 'number' || typeof sm.end !== 'number') continue
        const range = utf16Range(lineBuf, ascii, sm.start, sm.end)
        const { preview, column } = buildPreview(lineText, range.start, range.length)
        const match: SearchMatch = { line: lineNumber, column, length: range.length, preview }
        file.matches.push(match)
        totalMatches++
        if (totalMatches >= opts.maxResults) {
          truncated = true
          return false
        }
      }
      return true
    }

    const splitter = makeLineSplitter((line) => {
      let msg: unknown
      try {
        msg = JSON.parse(line)
      } catch {
        return true
      }
      if (!isRecord(msg) || msg.type !== 'match' || !isRecord(msg.data)) return true
      if (handleMatch(msg.data)) return true
      finish()
      return false
    })

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => splitter.push(chunk))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 4000) stderr += chunk
    })
    child.on('error', (err) => finish(new Error(`Could not run ripgrep (${rg}): ${err.message}`)))
    child.on('close', (code) => {
      splitter.end()
      if (settled) return
      if (code === 0 || code === 1 || code === null || totalMatches > 0) {
        finish()
        return
      }
      const detail = stderr.trim()
      if (/regex|parse error|unclosed|unrecognized escape/i.test(detail)) {
        finish(new Error(`Invalid regular expression: ${detail.split('\n').slice(-3).join(' ').trim()}`))
      } else {
        finish(new Error(`Search failed: ${detail || `ripgrep exited with code ${code}`}`))
      }
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC
// ─────────────────────────────────────────────────────────────────────────────

export function registerSearchIpc(): void {
  // Structural changes (files added/removed) invalidate the cached file lists.
  onFsChanges((_root, events) => {
    if (events.some((e) => e.kind !== 'change')) fileListCache.clear()
  })

  ipcMain.handle(IPC.searchFind, async (_e, root: unknown, options: unknown) => {
    try {
      return await find(assertAbsolutePath(root, 'Search root'), options)
    } catch (err) {
      throw err instanceof Error ? err : new Error(errorMessage(err))
    }
  })
  ipcMain.handle(IPC.searchCancel, () => {
    activeSearch?.cancel()
  })
}
