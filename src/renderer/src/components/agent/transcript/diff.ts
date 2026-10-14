/**
 * Diff helpers for edit tool cards: hunks from strings (diff package) or from the SDK's structuredPatch,
 * add/delete counts, flattening into display rows and per-line syntax highlighting.
 */
import { structuredPatch } from 'diff'
import hljs from 'highlight.js/lib/common'
import { languageForPath } from '@shared/paths'
import { arr, isObj, num, str } from './format'

export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export type DiffRowKind = 'add' | 'del' | 'ctx' | 'hunk' | 'note'

export interface DiffRow {
  kind: DiffRowKind
  text: string
  oldNo?: number
  newNo?: number
}

/** Line diff of two strings as unified hunks (3 lines of context). Large inputs are capped for responsiveness. */
export function hunksFromStrings(oldStr: string, newStr: string, context = 3): Hunk[] {
  if (oldStr === newStr) return []
  const MAX = 400_000
  const a = oldStr.length > MAX ? oldStr.slice(0, MAX) : oldStr
  const b = newStr.length > MAX ? newStr.slice(0, MAX) : newStr
  try {
    return structuredPatch('a', 'b', a, b, '', '', { context }).hunks
  } catch {
    return []
  }
}

/** Validate the SDK's `structuredPatch` (FileEditOutput / FileWriteOutput) into hunks. */
export function hunksFromStructured(value: unknown): Hunk[] | null {
  if (!Array.isArray(value)) return null
  const out: Hunk[] = []
  for (const h of value) {
    if (!isObj(h)) return null
    const lines = arr(h.lines).filter((l): l is string => typeof l === 'string')
    out.push({
      oldStart: num(h.oldStart) ?? 1,
      oldLines: num(h.oldLines) ?? 0,
      newStart: num(h.newStart) ?? 1,
      newLines: num(h.newLines) ?? 0,
      lines
    })
  }
  return out
}

export function countChanges(hunks: Hunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.startsWith('+')) added++
      else if (l.startsWith('-')) removed++
    }
  }
  return { added, removed }
}

/**
 * Flatten hunks into rows with line numbers. `lineOffset` shifts snippet-relative hunks to real file lines
 * (when the snippet's position in the file is known). Hunks after the first are preceded by a separator row.
 */
export function rowsFromHunks(hunks: Hunk[], lineOffset = 0): DiffRow[] {
  const rows: DiffRow[] = []
  hunks.forEach((h, i) => {
    if (i > 0) rows.push({ kind: 'hunk', text: `@@ -${h.oldStart + lineOffset},${h.oldLines} +${h.newStart + lineOffset},${h.newLines} @@` })
    let o = h.oldStart + lineOffset
    let n = h.newStart + lineOffset
    for (const line of h.lines) {
      const sign = line[0]
      const text = line.slice(1)
      if (sign === '+') rows.push({ kind: 'add', text, newNo: n++ })
      else if (sign === '-') rows.push({ kind: 'del', text, oldNo: o++ })
      else if (sign === '\\') rows.push({ kind: 'note', text: line.slice(2) })
      else rows.push({ kind: 'ctx', text, oldNo: o++, newNo: n++ })
    }
  })
  return rows
}

/** Apply a single Edit (first occurrence, or all) without `String.replace` pattern semantics. */
export function applyEdit(source: string, oldString: string, newString: string, replaceAll: boolean): string {
  if (!oldString) return source
  if (replaceAll) return source.split(oldString).join(newString)
  const i = source.indexOf(oldString)
  return i === -1 ? source : source.slice(0, i) + newString + source.slice(i + oldString.length)
}

export interface EditSpec {
  oldString: string
  newString: string
  replaceAll: boolean
}

/** Edit specs from an Edit / MultiEdit input. */
export function editsFromInput(name: string, input: Record<string, unknown>): EditSpec[] {
  if (name === 'MultiEdit') {
    return arr(input.edits)
      .filter(isObj)
      .map((e) => ({ oldString: str(e.old_string) ?? '', newString: str(e.new_string) ?? '', replaceAll: e.replace_all === true }))
  }
  if (input.old_string === undefined && input.new_string === undefined) return []
  return [{ oldString: str(input.old_string) ?? '', newString: str(input.new_string) ?? '', replaceAll: input.replace_all === true }]
}

/** Hunks for a list of edits applied to snippets (not anchored to real file lines). */
export function hunksFromEdits(edits: EditSpec[]): Hunk[] {
  const out: Hunk[] = []
  for (const e of edits) out.push(...hunksFromStrings(e.oldString, e.newString))
  return out
}

// ── Syntax highlighting (per line; good enough for diff previews) ─────────────────────────────────────

const HLJS_ALIASES: Record<string, string> = {
  shell: 'bash',
  powershell: 'powershell',
  html: 'xml',
  plaintext: '',
  ignore: '',
  hcl: '',
  protobuf: '',
  elixir: '',
  clojure: '',
  haskell: '',
  dart: '',
  scala: ''
}

/** highlight.js language for a file path, or '' when none is registered. */
export function highlightLanguageFor(path: string): string {
  const monacoId = languageForPath(path)
  const lang = monacoId in HLJS_ALIASES ? HLJS_ALIASES[monacoId] : monacoId
  return lang && hljs.getLanguage(lang) ? lang : ''
}

const lineCache = new Map<string, string>()

/** Highlighted HTML for one line (escaped by highlight.js), or null when it should be rendered as text. */
export function highlightLine(text: string, language: string): string | null {
  if (!language || !text.trim() || text.length > 400) return null
  const key = language + '\u0000' + text
  const cached = lineCache.get(key)
  if (cached !== undefined) return cached
  let html: string
  try {
    html = hljs.highlight(text, { language, ignoreIllegals: true }).value
  } catch {
    return null
  }
  if (lineCache.size > 4000) lineCache.clear()
  lineCache.set(key, html)
  return html
}
