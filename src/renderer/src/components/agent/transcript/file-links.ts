/**
 * File references in agent output: detection ("src/app.ts:42", "./lib/x.py", "app.ts#L10-L20"),
 * resolution against the chat workspace (exact match, then a unique suffix match among the workspace's files)
 * and opening in the editor.
 */
import { basename, joinPath, normalizeSlashes, relativePath } from '@shared/paths'
import { useEditorStore } from '../../../stores/editor'
import { useWorkspaceStore } from '../../../stores/workspace'
import { errorMessage, toast } from '../../../stores/toast'

export interface FileRef {
  path: string
  line?: number
  column?: number
  endLine?: number
}

const LINE_SUFFIX_RE = /(?::(\d+)(?::(\d+))?(?:-(\d+))?|#L(\d+)(?:-L?(\d+))?)$/
const SINGLE_LETTER_EXTS = new Set(['c', 'h', 'r', 'm', 's', 'v', 'd'])
const EXTENSIONLESS_NAMES = new Set(['dockerfile', 'makefile', 'gemfile', 'rakefile', 'procfile', 'license', 'readme'])
const DOMAIN_START_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|ai|app|co|edu|gov|me|sh|so|xyz|info|cloud)\//i

function toInt(v: string | undefined): number | undefined {
  if (!v) return undefined
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Split "path:line:col", "path:10-20" or "path#L10-L20" into a FileRef (no validation). */
export function parseFileRef(raw: string): FileRef {
  let s = raw.trim().replace(/^file:\/\//, '')
  try {
    if (/%[0-9a-f]{2}/i.test(s)) s = decodeURIComponent(s)
  } catch {
    /* keep as is */
  }
  const m = LINE_SUFFIX_RE.exec(s)
  if (!m) return { path: s }
  const path = s.slice(0, m.index)
  if (m[4]) return { path, line: toInt(m[4]), endLine: toInt(m[5]) }
  return { path, line: toInt(m[1]), column: toInt(m[2]), endLine: toInt(m[3]) }
}

export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')
}

/** Heuristic: does this token look like a file path (has an extension or a well-known name, not a URL / version)? */
export function looksLikeFilePath(p: string): boolean {
  if (!p || p.length > 400 || /\s/.test(p)) return false
  if (p.includes('://') || /^www\./i.test(p) || p.startsWith('@')) return false
  if (/^v?\d+(?:\.\d+)+$/.test(p)) return false
  if (DOMAIN_START_RE.test(p) && !p.startsWith('.')) return false
  const name = basename(p)
  if (!name || name === '.' || name === '..') return false
  if (EXTENSIONLESS_NAMES.has(name.toLowerCase())) return true
  const dot = name.lastIndexOf('.')
  if (dot <= 0 && !name.startsWith('.')) return false
  if (name.startsWith('.') && dot === 0) return name.length > 2 && /^[.\w-]+$/.test(name) // dotfiles like .env, .gitignore
  const ext = name.slice(dot + 1)
  if (!/^[A-Za-z0-9_-]{1,12}$/.test(ext) || !/[A-Za-z]/.test(ext)) return false
  if (ext.length === 1 && !SINGLE_LETTER_EXTS.has(ext.toLowerCase())) return false
  return true
}

/** Normalize "./a/../b" segments and resolve a relative path against the workspace. */
export function resolvePath(p: string, workspace: string): string {
  const raw = normalizeSlashes(p)
  if (isAbsolutePath(raw) || !workspace) return raw
  const parts = normalizeSlashes(joinPath(workspace, raw)).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '.' || (part === '' && out.length > 0)) continue
    if (part === '..') {
      if (out.length > 1) out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/') || raw
}

// ── Workspace file index (lazily built from the workspace store's file list) ─────────────────────────

let indexedFiles: string[] | null = null
let exactIndex: Map<string, string> = new Map()
const suffixCache = new Map<string, string | null>()

function fileIndex(): Map<string, string> | null {
  const files = useWorkspaceStore.getState().files
  if (!files.length) return null
  if (files !== indexedFiles) {
    indexedFiles = files
    exactIndex = new Map(files.map((f) => [normalizeSlashes(f).toLowerCase(), f]))
    suffixCache.clear()
  }
  return exactIndex
}

/**
 * Absolute path of a known workspace file for `p` (exact, or the single file whose path ends with `/p`).
 * Returns `null` when the index is loaded but nothing matches, `undefined` when there is no index yet.
 */
export function findKnownFile(p: string, workspace: string): string | null | undefined {
  const index = fileIndex()
  if (!index) return undefined
  const resolved = resolvePath(p, workspace)
  const exact = index.get(resolved.toLowerCase())
  if (exact) return exact
  if (isAbsolutePath(p)) return null
  const rel = normalizeSlashes(p).replace(/^(?:\.\/)+/, '').replace(/^(?:\.\.\/)+/, '').toLowerCase()
  if (!rel) return null
  const key = `${workspace}\u0000${rel}`
  const cached = suffixCache.get(key)
  if (cached !== undefined) return cached
  const needle = '/' + rel
  let found: string | null = null
  let count = 0
  for (const [lower, original] of index) {
    if (lower.endsWith(needle)) {
      found = original
      if (++count > 1) break
    }
  }
  const result = count === 1 ? found : null
  if (suffixCache.size > 2000) suffixCache.clear()
  suffixCache.set(key, result)
  return result
}

/** Best absolute path for a reference: a known workspace file, else the path resolved against the workspace. */
export function locateFile(p: string, workspace: string): string {
  return findKnownFile(p, workspace) || resolvePath(p, workspace)
}

/**
 * Should a token found in plain prose become a file link? Requires a slash or a line suffix, and — once the
 * workspace file list is loaded — a file that actually exists (absolute paths are trusted).
 */
export function isLinkableProsePath(token: string, workspace: string): FileRef | null {
  const ref = parseFileRef(token)
  if (!looksLikeFilePath(ref.path)) return null
  const hasSlash = ref.path.includes('/')
  if (!hasSlash && ref.line === undefined) return null
  if (isAbsolutePath(ref.path)) return ref
  const known = findKnownFile(ref.path, workspace)
  return known === null ? null : ref
}

/** Should an inline `code` span become a file link? Paths with a slash always do; bare names must exist. */
export function isLinkableCodePath(text: string, workspace: string): FileRef | null {
  const token = text.trim()
  if (!token || token.length !== text.length || /\s/.test(token)) return null
  const ref = parseFileRef(token)
  if (!looksLikeFilePath(ref.path)) return null
  if (ref.path.includes('/') || isAbsolutePath(ref.path)) return ref
  const known = findKnownFile(ref.path, workspace)
  if (known) return ref
  return known === undefined && ref.line !== undefined ? ref : null
}

export interface PathMatch {
  start: number
  end: number
  text: string
  ref: FileRef
}

const TOKEN_RE = /[A-Za-z0-9_.~+\-/@[\]]+(?:(?::\d+(?::\d+)?(?:-\d+)?)|(?:#L\d+(?:-L?\d+)?))?/g

/** Find linkable file paths in a run of plain text. */
export function findPathsInText(text: string, workspace: string): PathMatch[] {
  if (!text.includes('.')) return []
  const out: PathMatch[] = []
  TOKEN_RE.lastIndex = 0
  for (let m = TOKEN_RE.exec(text); m; m = TOKEN_RE.exec(text)) {
    let token = m[0]
    let start = m.index
    // Skip URL tails ("https://x.y/z") and e-mail like tokens.
    const prev = start > 0 ? text[start - 1] : ''
    if (prev === ':' || prev === '/' || prev === '\\' || token.includes('@')) continue
    // Trim leading/trailing punctuation that is part of the sentence.
    while (token.length && /^[[(]/.test(token)) {
      token = token.slice(1)
      start++
    }
    while (token.length && /[.,;:)\]!?'"-]$/.test(token) && !/:\d+$/.test(token)) token = token.slice(0, -1)
    if (token.length < 3) continue
    const ref = isLinkableProsePath(token, workspace)
    if (ref) out.push({ start, end: start + token.length, text: token, ref })
  }
  return out
}

/** Short display label for a path: relative to the workspace when inside it. */
export function displayPath(p: string, workspace: string): string {
  if (!p) return ''
  if (!workspace) return normalizeSlashes(p)
  const rel = relativePath(workspace, p)
  return rel || basename(p)
}

/** Open a file reference in the editor (relative paths are resolved against the chat workspace). */
export function openFileRef(ref: FileRef, workspace: string): void {
  const path = locateFile(ref.path, workspace)
  void useEditorStore
    .getState()
    .openFile(path, { line: ref.line, column: ref.column, endLine: ref.endLine })
    .catch((err: unknown) => toast.error(`Could not open ${basename(path)}`, errorMessage(err)))
}

export function openPath(path: string, workspace: string, line?: number, endLine?: number): void {
  openFileRef({ path, line, endLine }, workspace)
}

/** "L10–40" style label for a line range. */
export function lineRangeLabel(start?: number, end?: number): string {
  if (!start) return ''
  return end && end > start ? `L${start}–${end}` : `L${start}`
}
