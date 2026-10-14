import { ipcMain, shell } from 'electron'
import { watch, type FSWatcher } from 'chokidar'
import type { Stats } from 'node:fs'
import { cp, lstat, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { IPC } from '../../shared/ipc'
import { isImagePath } from '../../shared/paths'
import type { FileContent, FileEntry, FileStat, FsChangeEvent, FsChangeKind, TextEncodingId } from '../../shared/types'
import { ctx } from '../context'
import { settingsService } from './settings'
import { decodeText, encodeText } from './text-encoding'

/** Text files larger than this are not loaded into the editor. */
const TEXT_LIMIT = 5 * 1024 * 1024
/** Images up to this size are returned as base64. */
const IMAGE_LIMIT = 10 * 1024 * 1024
/** Bytes inspected for NUL characters when detecting binary files. */
const BINARY_SNIFF_BYTES = 8192
const WATCH_BATCH_MS = 100

const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin'

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers (also used by workspace.ts, search.ts, git.ts and library.ts)
// ─────────────────────────────────────────────────────────────────────────────

function errorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

/** Map a Node fs error to a short, user-facing Error. */
export function friendlyFsError(err: unknown, path: string, action = 'Operation'): Error {
  switch (errorCode(err)) {
    case 'ENOENT':
      return new Error(`File not found: ${path}`)
    case 'EACCES':
    case 'EPERM':
      return new Error(`Permission denied: ${path}`)
    case 'EEXIST':
      return new Error(`A file or folder named '${basename(path)}' already exists`)
    case 'ENOTDIR':
      return new Error(`Not a directory: ${path}`)
    case 'EISDIR':
      return new Error(`Is a directory: ${path}`)
    case 'ENOTEMPTY':
      return new Error(`Folder is not empty: ${path}`)
    case 'EBUSY':
      return new Error(`File is busy or locked: ${path}`)
    case 'EROFS':
      return new Error(`Read-only file system: ${path}`)
    case 'ENOSPC':
      return new Error(`No space left on device while writing ${path}`)
    case 'EMFILE':
    case 'ENFILE':
      return new Error('Too many open files — close some files or folders and try again')
    case 'ENAMETOOLONG':
      return new Error(`File name too long: ${path}`)
    case 'ELOOP':
      return new Error(`Too many symbolic links: ${path}`)
    default:
      // Errors we created ourselves are already friendly.
      if (err instanceof Error && !errorCode(err)) return err
      return new Error(`${action} failed for ${path}: ${errorMessage(err)}`)
  }
}

/** Validate an IPC-supplied path: must be a non-empty absolute path. Returns it normalized. */
export function assertAbsolutePath(value: unknown, label = 'Path'): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`)
  if (value.includes('\0')) throw new Error(`${label} contains an invalid character`)
  if (!isAbsolute(value)) throw new Error(`${label} must be absolute: ${value}`)
  return resolve(value)
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

/** True when `target` equals `root` or lies inside it (platform-aware). */
export function isPathInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Move a file or folder to the OS trash; falls back to a permanent delete when no trash is available. */
export async function trashPath(p: string): Promise<void> {
  try {
    await shell.trashItem(p)
  } catch {
    try {
      await rm(p, { recursive: true, force: false, maxRetries: 2 })
    } catch (err) {
      throw friendlyFsError(err, p, 'Delete')
    }
  }
}

/** Refuse destructive operations on filesystem roots and the home folder. */
function assertNotProtected(p: string): void {
  const home = homedir()
  const same = (a: string, b: string): boolean => (CASE_INSENSITIVE_FS ? a.toLowerCase() === b.toLowerCase() : a === b)
  if (same(p, parse(p).root) || same(p, home)) throw new Error(`Refusing to modify protected location: ${p}`)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.+^$()|\\]/g, '\\$&')
}

/** Convert a simple glob (`*`, `?`, `[abc]`, `{a,b}`) for a single path segment into a RegExp. */
function globSegmentToRegExp(glob: string): RegExp {
  let re = ''
  let inGroup = false
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') re += '[^/\\\\]*'
    else if (ch === '?') re += '[^/\\\\]'
    else if (ch === '{') {
      re += '(?:'
      inGroup = true
    } else if (ch === '}' && inGroup) {
      re += ')'
      inGroup = false
    } else if (ch === ',' && inGroup) re += '|'
    else if (ch === '[') {
      const close = glob.indexOf(']', i + 1)
      if (close === -1) re += '\\['
      else {
        re += `[${glob.slice(i + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`
        i = close
      }
    } else if (ch === ']') re += '\\]'
    else re += escapeRegExp(ch)
  }
  if (inGroup) re += ')'
  return new RegExp(`^${re}$`, CASE_INSENSITIVE_FS ? 'i' : '')
}

/**
 * Build a predicate that tells whether a file/folder *name* matches one of the `settings.filesExclude`
 * patterns. Patterns like `**\/name` or `name/**` are reduced to `name`; patterns with other slashes are ignored.
 */
export function createNameExcluder(patterns: readonly string[]): (name: string) => boolean {
  const exact = new Set<string>()
  const regexps: RegExp[] = []
  for (const raw of patterns) {
    const p = raw
      .trim()
      .replace(/^(\*\*\/)+/, '')
      .replace(/(\/\*\*)+$/, '')
      .replace(/\/+$/, '')
    if (!p || p.includes('/')) continue
    if (/[*?[{]/.test(p)) regexps.push(globSegmentToRegExp(p))
    else exact.add(CASE_INSENSITIVE_FS ? p.toLowerCase() : p)
  }
  return (name: string) => exact.has(CASE_INSENSITIVE_FS ? name.toLowerCase() : name) || regexps.some((r) => r.test(name))
}

function toFileStat(p: string, st: Stats): FileStat {
  return { path: p, exists: true, isDirectory: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs }
}

function isBinaryBuffer(buf: Buffer): boolean {
  const n = Math.min(buf.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

async function readHead(p: string, bytes: number): Promise<Buffer> {
  const handle = await open(p, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Text encodings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Files that were read with an encoding other than plain UTF-8 (UTF-8 with BOM, Windows-1252), keyed by
 * path: the renderer saves plain strings, and main writes them back in the encoding they came in.
 */
const textEncodings = new Map<string, TextEncodingId>()

function encodingKey(p: string): string {
  return CASE_INSENSITIVE_FS ? p.toLowerCase() : p
}

function rememberEncoding(p: string, encoding: TextEncodingId): void {
  if (encoding === 'utf8') textEncodings.delete(encodingKey(p))
  else textEncodings.set(encodingKey(p), encoding)
}

/** Keep remembered encodings with their files across a rename/move (folders included). */
function moveEncodings(from: string, to: string): void {
  const fromKey = encodingKey(from)
  for (const [key, encoding] of [...textEncodings]) {
    if (key === fromKey) {
      textEncodings.delete(key)
      textEncodings.set(encodingKey(to), encoding)
    } else if (key.startsWith(fromKey + sep)) {
      textEncodings.delete(key)
      textEncodings.set(encodingKey(to) + key.slice(fromKey.length), encoding)
    }
  }
}

function forgetEncodings(p: string): void {
  const key = encodingKey(p)
  for (const k of [...textEncodings.keys()]) if (k === key || k.startsWith(key + sep)) textEncodings.delete(k)
}

// ─────────────────────────────────────────────────────────────────────────────
// Operations
// ─────────────────────────────────────────────────────────────────────────────

export async function readDirectory(dir: string): Promise<FileEntry[]> {
  let dirents
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    throw friendlyFsError(err, dir, 'Reading folder')
  }
  const excluded = createNameExcluder(settingsService.get().filesExclude)
  const entries = await Promise.all(
    dirents
      .filter((d) => !excluded(d.name))
      .map(async (d): Promise<FileEntry> => {
        const full = join(dir, d.name)
        const isSymlink = d.isSymbolicLink()
        let isDirectory = d.isDirectory()
        let size: number | undefined
        let mtimeMs: number | undefined
        try {
          // stat() follows symlinks so linked folders are expandable.
          const st = await stat(full)
          isDirectory = st.isDirectory()
          size = st.isDirectory() ? undefined : st.size
          mtimeMs = st.mtimeMs
        } catch {
          /* broken symlink or permission problem: keep dirent info */
        }
        return { name: d.name, path: full, isDirectory, isSymlink: isSymlink || undefined, size, mtimeMs }
      })
  )
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.name.localeCompare(b.name)
  })
  return entries
}

export async function readFileContent(p: string): Promise<FileContent> {
  try {
    const st = await stat(p)
    if (st.isDirectory()) throw new Error(`Is a directory: ${p}`)
    if (!st.isFile()) throw new Error(`Not a regular file: ${p}`)
    const base = { path: p, size: st.size, mtimeMs: st.mtimeMs }

    if (isImagePath(p)) {
      if (st.size > IMAGE_LIMIT) return { ...base, content: '', encoding: 'base64', isBinary: true, tooLarge: true }
      const buf = await readFile(p)
      return { ...base, content: buf.toString('base64'), encoding: 'base64', isBinary: true }
    }
    if (st.size > TEXT_LIMIT) {
      const head = await readHead(p, BINARY_SNIFF_BYTES)
      return { ...base, content: '', encoding: 'utf8', isBinary: isBinaryBuffer(head), tooLarge: true }
    }
    const buf = await readFile(p)
    if (isBinaryBuffer(buf)) return { ...base, content: '', encoding: 'utf8', isBinary: true }
    // Strict UTF-8 (BOM remembered); anything else is read as Windows-1252 so it can be saved back unchanged.
    const { text, encoding } = decodeText(buf)
    rememberEncoding(p, encoding)
    return { ...base, content: text, encoding: 'utf8', isBinary: false, textEncoding: encoding }
  } catch (err) {
    throw friendlyFsError(err, p, 'Reading file')
  }
}

export async function writeTextFile(p: string, content: string): Promise<FileStat> {
  if (typeof content !== 'string') throw new Error('File content must be a string')
  // Same encoding (and BOM) the file was read with; throws before touching the file when a character
  // cannot be stored in it.
  const data = encodeText(content, textEncodings.get(encodingKey(p)) ?? 'utf8')
  try {
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, data)
    return toFileStat(p, await stat(p))
  } catch (err) {
    throw friendlyFsError(err, p, 'Saving file')
  }
}

async function createFile(p: string, content: unknown): Promise<void> {
  const text = content === undefined || content === null ? '' : content
  if (typeof text !== 'string') throw new Error('File content must be a string')
  try {
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, text, { encoding: 'utf8', flag: 'wx' })
    forgetEncodings(p)
  } catch (err) {
    throw friendlyFsError(err, p, 'Creating file')
  }
}

async function createDir(p: string): Promise<void> {
  if (await pathExists(p)) throw new Error(`A file or folder named '${basename(p)}' already exists`)
  try {
    await mkdir(p, { recursive: true })
  } catch (err) {
    throw friendlyFsError(err, p, 'Creating folder')
  }
}

function sameEntry(a: Stats, b: Stats): boolean {
  return a.ino !== 0 && a.ino === b.ino && a.dev === b.dev
}

async function renamePath(from: string, to: string): Promise<void> {
  if (from === to) return
  assertNotProtected(from)
  // relative() is '' for a case-only rename on Windows (case-insensitive comparison) — that is allowed.
  if (relative(from, to) !== '' && isPathInside(from, to)) throw new Error(`Cannot move '${basename(from)}' into itself`)
  let src: Stats
  try {
    src = await lstat(from)
  } catch (err) {
    throw friendlyFsError(err, from, 'Rename')
  }
  const dest = await lstat(to).catch(() => null)
  // A destination that is the same inode is a case-only rename on a case-insensitive file system.
  if (dest && !sameEntry(src, dest)) throw new Error(`A file or folder named '${basename(to)}' already exists`)
  try {
    await mkdir(dirname(to), { recursive: true })
    await rename(from, to)
    moveEncodings(from, to)
  } catch (err) {
    if (errorCode(err) === 'EXDEV') {
      // Moving across devices: copy then delete.
      try {
        await cp(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true })
        await rm(from, { recursive: true, force: true })
        moveEncodings(from, to)
        return
      } catch (copyErr) {
        throw friendlyFsError(copyErr, to, 'Move')
      }
    }
    throw friendlyFsError(err, errorCode(err) === 'ENOENT' ? from : to, 'Rename')
  }
}

async function deletePath(p: string): Promise<void> {
  assertNotProtected(p)
  try {
    await lstat(p)
  } catch (err) {
    throw friendlyFsError(err, p, 'Delete')
  }
  await trashPath(p)
  forgetEncodings(p)
}

async function statPath(p: string): Promise<FileStat> {
  try {
    return toFileStat(p, await stat(p))
  } catch (err) {
    const code = errorCode(err)
    if (code === 'ENOENT' || code === 'ENOTDIR') return { path: p, exists: false, isDirectory: false, size: 0, mtimeMs: 0 }
    throw friendlyFsError(err, p, 'Stat')
  }
}

async function copyPath(from: string, to: string): Promise<void> {
  if (from === to) throw new Error(`Cannot copy '${basename(from)}' onto itself`)
  if (isPathInside(from, to)) throw new Error(`Cannot copy '${basename(from)}' into itself`)
  try {
    await lstat(from)
  } catch (err) {
    throw friendlyFsError(err, from, 'Copy')
  }
  if (await pathExists(to)) throw new Error(`A file or folder named '${basename(to)}' already exists`)
  try {
    await mkdir(dirname(to), { recursive: true })
    await cp(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true })
  } catch (err) {
    throw friendlyFsError(err, to, 'Copy')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Watcher
// ─────────────────────────────────────────────────────────────────────────────

const WATCH_IGNORED_DIRS = new Set(['node_modules', 'dist', 'out', '.next', 'target', '__pycache__'])
/** Noisy folders inside `.git` (refs, HEAD and index stay watched so git views can refresh). */
const WATCH_IGNORED_GIT_DIRS = new Set(['objects', 'logs', 'lfs'])
const FS_KINDS = new Set<FsChangeKind>(['add', 'change', 'unlink', 'addDir', 'unlinkDir'])

let watcher: FSWatcher | null = null
let watchRoot: string | null = null
let watchGeneration = 0
let pending = new Map<string, FsChangeKind>()
let flushTimer: NodeJS.Timeout | null = null
let watcherErrorReported = false
const changeListeners = new Set<(root: string, events: FsChangeEvent[]) => void>()

/** Subscribe to batched workspace change events inside the main process. */
export function onFsChanges(cb: (root: string, events: FsChangeEvent[]) => void): () => void {
  changeListeners.add(cb)
  return () => changeListeners.delete(cb)
}

function isFsKind(v: string): v is FsChangeKind {
  return FS_KINDS.has(v as FsChangeKind)
}

/** Coalesce a new event with a pending one for the same path. Returns null when they cancel out. */
function coalesce(prev: FsChangeKind | undefined, next: FsChangeKind): FsChangeKind | null {
  if (!prev) return next
  if (prev === 'add' && next === 'change') return 'add'
  if (prev === 'add' && next === 'unlink') return null
  if (prev === 'addDir' && next === 'unlinkDir') return null
  if (prev === 'unlink' && next === 'add') return 'change'
  return next
}

function flush(generation: number): void {
  flushTimer = null
  if (generation !== watchGeneration || pending.size === 0 || !watchRoot) {
    pending.clear()
    return
  }
  const events: FsChangeEvent[] = []
  for (const [path, kind] of pending) events.push({ kind, path })
  pending = new Map()
  ctx.send(IPC.fsChangeEvent, events)
  for (const listener of changeListeners) {
    try {
      listener(watchRoot, events)
    } catch {
      /* listeners must not break the watcher */
    }
  }
}

function createIgnoredMatcher(root: string, extraNames: Set<string>): (p: string) => boolean {
  return (p: string) => {
    const rel = relative(root, p)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false
    const parts = rel.split(/[\\/]/)
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (WATCH_IGNORED_DIRS.has(part) || extraNames.has(part)) return true
      if (part === '.git' && i + 1 < parts.length && WATCH_IGNORED_GIT_DIRS.has(parts[i + 1])) return true
    }
    return false
  }
}

/** Watch `root` recursively and push batched `IPC.fsChangeEvent`s. Replaces any previous watcher. */
export function startWatching(root: string): void {
  stopWatching()
  const absRoot = resolve(root)
  const generation = ++watchGeneration
  watchRoot = absRoot
  watcherErrorReported = false

  // Plain names from filesExclude are hidden in the explorer anyway — no need to watch them (.git stays watched).
  const extraNames = new Set(
    settingsService
      .get()
      .filesExclude.map((p) => p.trim())
      .filter((p) => p && p !== '.git' && !/[*?[{/\\]/.test(p))
  )

  try {
    const w = watch(absRoot, {
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      ignorePermissionErrors: true,
      ignored: createIgnoredMatcher(absRoot, extraNames)
    })
    w.on('all', (event, path) => {
      if (generation !== watchGeneration || !isFsKind(event)) return
      const next = coalesce(pending.get(path), event)
      if (next === null) pending.delete(path)
      else pending.set(path, next)
      if (!flushTimer) flushTimer = setTimeout(() => flush(generation), WATCH_BATCH_MS)
    })
    w.on('error', (err) => {
      if (generation !== watchGeneration || watcherErrorReported) return
      watcherErrorReported = true
      console.warn(`[fs] file watcher error in ${absRoot}: ${errorMessage(err)}`)
    })
    watcher = w
  } catch (err) {
    watcher = null
    console.warn(`[fs] could not watch ${absRoot}: ${errorMessage(err)}`)
  }
}

export function stopWatching(): void {
  watchGeneration++
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  pending.clear()
  watchRoot = null
  const w = watcher
  watcher = null
  if (w) void w.close().catch(() => undefined)
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC
// ─────────────────────────────────────────────────────────────────────────────

export function registerFsIpc(): void {
  ipcMain.handle(IPC.fsReadDir, (_e, path: unknown) => readDirectory(assertAbsolutePath(path)))
  ipcMain.handle(IPC.fsReadFile, (_e, path: unknown) => readFileContent(assertAbsolutePath(path)))
  ipcMain.handle(IPC.fsWriteFile, (_e, path: unknown, content: unknown) =>
    writeTextFile(assertAbsolutePath(path), content as string)
  )
  ipcMain.handle(IPC.fsCreateFile, (_e, path: unknown, content?: unknown) => createFile(assertAbsolutePath(path), content))
  ipcMain.handle(IPC.fsCreateDir, (_e, path: unknown) => createDir(assertAbsolutePath(path)))
  ipcMain.handle(IPC.fsRename, (_e, from: unknown, to: unknown) =>
    renamePath(assertAbsolutePath(from, 'Source path'), assertAbsolutePath(to, 'Target path'))
  )
  ipcMain.handle(IPC.fsDelete, (_e, path: unknown) => deletePath(assertAbsolutePath(path)))
  ipcMain.handle(IPC.fsStat, (_e, path: unknown) => statPath(assertAbsolutePath(path)))
  ipcMain.handle(IPC.fsCopy, (_e, from: unknown, to: unknown) =>
    copyPath(assertAbsolutePath(from, 'Source path'), assertAbsolutePath(to, 'Target path'))
  )
}
