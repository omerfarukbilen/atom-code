/**
 * A small, dependency-free YAML frontmatter parser/serializer for SKILL.md, subagent and slash-command files.
 *
 * Supported YAML subset (everything Claude Code skill/agent/command files use in practice):
 * - `key: value` pairs at the top level (keys may contain `-`, `_`, `.`; quoted keys are accepted)
 * - plain, 'single-quoted' and "double-quoted" scalars (including escapes and multi-line folding)
 * - booleans `true` / `false` (any case); `null` / `~` / empty values become ''
 * - flow sequences `[a, "b, c", 'd']` (may span several lines) and block sequences (`- item`)
 * - block scalars `|` and `>` with chomping (`-`, `+`) and indentation indicators
 * - comments (`# …`) and blank lines
 *
 * Nested mappings are not modelled: their (dedented) source text is kept as a string so nothing is lost.
 * This module is pure (no imports) so it can be unit-tested with `node --test --experimental-strip-types`.
 */

export type FrontmatterValue = string | string[] | boolean

export interface ParsedFrontmatter {
  data: Record<string, FrontmatterValue>
  body: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────────────

const OPEN_RE = /^---[ \t]*(?:\r?\n|$)/
const CLOSE_RE = /^(?:---|\.\.\.)[ \t]*$/
const KEY_RE = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([A-Za-z0-9_$][^:#\s]*(?:[ \t]+[^:#\s]+)*))[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/

/**
 * Split a markdown document into its YAML frontmatter (`data`) and the remaining `body`.
 * Documents without a (properly closed) frontmatter block return `{ data: {}, body: markdown }`.
 */
export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const text = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown
  const open = OPEN_RE.exec(text)
  if (!open) return { data: {}, body: text }

  // Find the closing delimiter line while keeping track of raw offsets so the body is returned verbatim.
  let offset = open[0].length
  const yamlLines: string[] = []
  let bodyStart = -1
  while (offset <= text.length) {
    const nl = text.indexOf('\n', offset)
    const end = nl === -1 ? text.length : nl
    const line = text.slice(offset, end).replace(/\r$/, '')
    if (CLOSE_RE.test(line)) {
      bodyStart = nl === -1 ? text.length : nl + 1
      break
    }
    yamlLines.push(line)
    if (nl === -1) break
    offset = nl + 1
  }
  if (bodyStart === -1) return { data: {}, body: text }

  return { data: parseYamlMapping(yamlLines), body: text.slice(bodyStart) }
}

function indentOf(line: string): number {
  const m = /^[ \t]*/.exec(line)
  return m ? m[0].length : 0
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function isComment(line: string): boolean {
  return /^[ \t]*#/.test(line)
}

function parseYamlMapping(lines: string[]): Record<string, FrontmatterValue> {
  const data: Record<string, FrontmatterValue> = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line) || isComment(line) || indentOf(line) > 0) {
      // Stray indented lines without a parent key are ignored.
      i++
      continue
    }
    const m = KEY_RE.exec(line)
    if (!m) {
      i++
      continue
    }
    const key = m[1] !== undefined ? unescapeDouble(m[1]) : m[2] !== undefined ? m[2].replace(/''/g, "'") : m[3]
    const rest = (m[4] ?? '').trim()
    const result = parseValue(rest, lines, i + 1)
    data[key] = result.value
    i = result.next
  }
  return data
}

interface ValueResult {
  value: FrontmatterValue
  /** Index of the first line not consumed. */
  next: number
}

function parseValue(rest: string, lines: string[], start: number): ValueResult {
  // Block scalar: | or > with optional chomping / indentation indicators, optional trailing comment.
  const block = /^([|>])([+-]?)([1-9]?)([+-]?)[ \t]*(?:#.*)?$/.exec(rest)
  if (block) {
    const chomp = (block[2] || block[4]) as '' | '+' | '-'
    const explicitIndent = block[3] ? Number(block[3]) : 0
    return parseBlockScalar(lines, start, block[1] === '>', chomp, explicitIndent)
  }

  if (rest.startsWith('"') || rest.startsWith("'")) {
    return parseQuotedValue(rest, lines, start)
  }

  if (rest.startsWith('[')) {
    return parseFlowSequenceValue(rest, lines, start)
  }

  const plain = stripComment(rest)
  if (plain === '') {
    return parseNestedValue(lines, start)
  }

  // Plain scalar, possibly continued on more-indented lines.
  const parts = [plain]
  let i = start
  let pendingNewlines = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      pendingNewlines++
      i++
      continue
    }
    if (indentOf(line) === 0) break
    const content = stripComment(line.trim())
    if (content === '') {
      i++
      continue
    }
    parts.push(pendingNewlines > 0 ? '\n'.repeat(pendingNewlines) : ' ')
    parts.push(content)
    pendingNewlines = 0
    i++
  }
  const joined = parts.join('')
  return { value: parts.length === 1 ? scalarFromPlain(joined) : joined, next: i }
}

/** Value on the following lines: a block sequence, a multi-line plain scalar, or a nested mapping. */
function parseNestedValue(lines: string[], start: number): ValueResult {
  let i = start
  // Skip blank / comment lines to find the first content line.
  while (i < lines.length && (isBlank(lines[i]) || isComment(lines[i]))) i++
  if (i >= lines.length) return { value: '', next: i }

  const first = lines[i]
  const firstIndent = indentOf(first)
  const firstTrimmed = first.trim()

  if (/^-(?:[ \t]|$)/.test(firstTrimmed)) {
    // Block sequence (items may sit at the key's indentation, which YAML allows).
    const items: string[] = []
    while (i < lines.length) {
      const line = lines[i]
      if (isBlank(line) || isComment(line)) {
        i++
        continue
      }
      const ind = indentOf(line)
      const trimmed = line.trim()
      if (ind < firstIndent || (ind === 0 && !/^-(?:[ \t]|$)/.test(trimmed))) break
      if (ind === firstIndent && /^-(?:[ \t]|$)/.test(trimmed)) {
        items.push(parseSequenceItem(trimmed.replace(/^-[ \t]*/, '')))
        i++
        continue
      }
      if (ind > firstIndent && items.length > 0) {
        // Continuation of a plain multi-line item.
        const content = stripComment(trimmed)
        if (content) items[items.length - 1] = `${items[items.length - 1]} ${content}`.trim()
        i++
        continue
      }
      break
    }
    return { value: items, next: i }
  }

  if (firstIndent === 0) return { value: '', next: start }

  // Indented block: nested mapping (kept as raw dedented text) or a plain multi-line scalar.
  const collected: string[] = []
  let j = i
  while (j < lines.length) {
    const line = lines[j]
    if (!isBlank(line) && indentOf(line) === 0) break
    collected.push(line)
    j++
  }
  while (collected.length > 0 && isBlank(collected[collected.length - 1])) collected.pop()
  const looksLikeMapping = collected.some((l) => /^[ \t]*[^\s#][^:]*:(?:[ \t]|$)/.test(l))
  if (looksLikeMapping) {
    const minIndent = Math.min(...collected.filter((l) => !isBlank(l)).map(indentOf))
    return { value: collected.map((l) => (isBlank(l) ? '' : l.slice(minIndent))).join('\n'), next: j }
  }
  const folded = foldPlainLines(collected.map((l) => stripComment(l.trim())))
  return { value: folded, next: j }
}

function foldPlainLines(lines: string[]): string {
  let out = ''
  let pendingNewlines = 0
  for (const line of lines) {
    if (line === '') {
      pendingNewlines++
      continue
    }
    if (out !== '') out += pendingNewlines > 0 ? '\n'.repeat(pendingNewlines) : ' '
    out += line
    pendingNewlines = 0
  }
  return out
}

function parseSequenceItem(raw: string): string {
  const text = raw.trim()
  if (text.startsWith('"') || text.startsWith("'")) {
    const q = readQuoted(text, 0)
    if (q) return q.value
  }
  return stripComment(text)
}

function parseBlockScalar(
  lines: string[],
  start: number,
  folded: boolean,
  chomp: '' | '+' | '-',
  explicitIndent: number
): ValueResult {
  let indent = explicitIndent
  if (!indent) {
    for (let k = start; k < lines.length; k++) {
      if (isBlank(lines[k])) continue
      indent = indentOf(lines[k])
      break
    }
  }
  if (indent === 0) return { value: '', next: start }

  const content: string[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line) && line.length <= indent) {
      content.push('')
      i++
      continue
    }
    if (indentOf(line) < indent) break
    content.push(line.slice(indent))
    i++
  }

  let trailing = 0
  while (content.length > 0 && content[content.length - 1] === '') {
    content.pop()
    trailing++
  }

  let result = ''
  let emptyLines = 0
  let atStart = true
  let prevMoreIndented = false
  for (const line of content) {
    if (line === '') {
      emptyLines++
      continue
    }
    const moreIndented = /^[ \t]/.test(line)
    if (atStart) {
      result += '\n'.repeat(emptyLines)
    } else if (folded) {
      if (moreIndented || prevMoreIndented) result += '\n'.repeat(1 + emptyLines)
      else result += emptyLines === 0 ? ' ' : '\n'.repeat(emptyLines)
    } else {
      result += '\n'.repeat(1 + emptyLines)
    }
    result += line
    emptyLines = 0
    atStart = false
    prevMoreIndented = moreIndented
  }

  if (chomp === '-') return { value: result, next: i }
  if (chomp === '+') return { value: atStart ? '\n'.repeat(trailing) : `${result}\n${'\n'.repeat(trailing)}`, next: i }
  return { value: atStart ? '' : `${result}\n`, next: i }
}

/** True when `tail` (text after a closed quote / flow sequence) is only whitespace or a comment. */
function isCleanTail(tail: string): boolean {
  const t = tail.trim()
  return t === '' || t.startsWith('#')
}

function parseQuotedValue(rest: string, lines: string[], start: number): ValueResult {
  let text = rest
  let i = start
  let q = readQuoted(text, 0)
  // Multi-line quoted scalar: keep consuming lines until the closing quote shows up.
  while (!q && i < lines.length) {
    text += `\n${lines[i]}`
    i++
    q = readQuoted(text, 0)
  }
  if (!q) return { value: stripComment(rest), next: start }
  // `"foo" bar` is not valid YAML; keep the raw text like a lenient parser would.
  if (i === start && !isCleanTail(text.slice(q.end))) return { value: stripComment(rest), next: start }
  return { value: q.value, next: i }
}

function parseFlowSequenceValue(rest: string, lines: string[], start: number): ValueResult {
  let text = rest
  let i = start
  let seq = readFlowSequence(text)
  while (!seq && i < lines.length) {
    text += `\n${lines[i]}`
    i++
    seq = readFlowSequence(text)
  }
  if (!seq) return { value: stripComment(rest), next: start }
  // e.g. `argument-hint: [pr-number] [priority]` — not a sequence, keep the raw text.
  if (i === start && !isCleanTail(text.slice(seq.end))) return { value: stripComment(rest), next: start }
  return { value: seq.items, next: i }
}

/** Parse `[a, "b", 'c']` starting at text[0] === '['. Returns null when the closing bracket is missing. */
function readFlowSequence(text: string): { items: string[]; end: number } | null {
  const items: string[] = []
  let pos = 1
  let current = ''
  let hasItem = false
  while (pos < text.length) {
    const ch = text[pos]
    if (ch === '"' || ch === "'") {
      if (current.trim() === '') {
        const q = readQuoted(text, pos)
        if (!q) return null
        current = ''
        items.push(q.value)
        hasItem = false
        pos = q.end
        // Skip to the next separator.
        while (pos < text.length && text[pos] !== ',' && text[pos] !== ']') pos++
        if (text[pos] === ',') pos++
        else if (text[pos] === ']') return { items, end: pos + 1 }
        continue
      }
      current += ch
      hasItem = true
      pos++
      continue
    }
    if (ch === ',') {
      if (hasItem && current.trim() !== '') items.push(current.trim().replace(/\s+/g, ' '))
      current = ''
      hasItem = false
      pos++
      continue
    }
    if (ch === ']') {
      if (hasItem && current.trim() !== '') items.push(current.trim().replace(/\s+/g, ' '))
      return { items, end: pos + 1 }
    }
    if (ch === '#' && /\s/.test(text[pos - 1] ?? ' ')) {
      // Comment inside a multi-line flow sequence: skip to end of line.
      const nl = text.indexOf('\n', pos)
      if (nl === -1) return null
      pos = nl
      continue
    }
    current += ch
    if (!/\s/.test(ch)) hasItem = true
    pos++
  }
  return null
}

/** Read a quoted scalar starting at text[start]. Returns null when it is not terminated. */
function readQuoted(text: string, start: number): { value: string; end: number } | null {
  const quote = text[start]
  let pos = start + 1
  let raw = ''
  while (pos < text.length) {
    const ch = text[pos]
    if (quote === "'") {
      if (ch === "'") {
        if (text[pos + 1] === "'") {
          raw += "''"
          pos += 2
          continue
        }
        return { value: foldQuotedNewlines(raw, false).replace(/''/g, "'"), end: pos + 1 }
      }
    } else {
      if (ch === '\\' && pos + 1 < text.length) {
        raw += ch + text[pos + 1]
        pos += 2
        continue
      }
      if (ch === '"') return { value: unescapeDouble(foldQuotedNewlines(raw, true)), end: pos + 1 }
    }
    raw += ch
    pos++
  }
  return null
}

/** YAML line folding inside quoted scalars: a single line break becomes a space, blank lines become \n. */
function foldQuotedNewlines(raw: string, double: boolean): string {
  if (!raw.includes('\n')) return raw
  const lines = raw.split('\n')
  let out = ''
  let emptyLines = 0
  for (let k = 0; k < lines.length; k++) {
    let line = lines[k].replace(/\r$/, '')
    if (k > 0) line = line.replace(/^[ \t]+/, '')
    if (k < lines.length - 1) line = line.replace(/[ \t]+$/, '')
    if (k > 0 && line === '' && k < lines.length - 1) {
      emptyLines++
      continue
    }
    if (k > 0) {
      // An escaped line break (`\` at the end of the previous line) joins without a space.
      if (double && out.endsWith('\\') && !out.endsWith('\\\\')) {
        out = out.slice(0, -1)
      } else {
        out += emptyLines > 0 ? '\n'.repeat(emptyLines) : ' '
      }
    }
    out += line
    emptyLines = 0
  }
  return out
}

const DOUBLE_ESCAPES: Record<string, string> = {
  '0': '\0',
  a: '\x07',
  b: '\b',
  t: '\t',
  '\t': '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '\x1b',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
  N: '\u0085',
  _: '\u00a0',
  L: '\u2028',
  P: '\u2029'
}

function unescapeDouble(raw: string): string {
  return raw.replace(/\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)/g, (match, esc: string) => {
    if (esc.length > 1) {
      const code = Number.parseInt(esc.slice(1), 16)
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    }
    return DOUBLE_ESCAPES[esc] ?? match
  })
}

/** Remove a trailing ` # comment` from a plain scalar. */
function stripComment(value: string): string {
  const m = /(^|[ \t])#/.exec(value)
  return (m ? value.slice(0, m.index) : value).trim()
}

function scalarFromPlain(value: string): FrontmatterValue {
  if (/^(?:true|True|TRUE)$/.test(value)) return true
  if (/^(?:false|False|FALSE)$/.test(value)) return false
  if (/^(?:null|Null|NULL|~)$/.test(value)) return ''
  return value
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization
// ─────────────────────────────────────────────────────────────────────────────

const PLAIN_KEY_RE = /^[A-Za-z0-9_$][A-Za-z0-9_$.\-]*$/

/**
 * Serialize `data` as a YAML frontmatter block followed by `body`.
 * `undefined` / `null` values are skipped; an empty `data` returns the body unchanged.
 * The output round-trips through `parseFrontmatter`.
 */
export function serializeFrontmatter(
  data: Record<string, FrontmatterValue | null | undefined>,
  body: string
): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue
    const k = PLAIN_KEY_RE.test(key) ? key : quoteDouble(key)
    if (typeof value === 'boolean') {
      lines.push(`${k}: ${value ? 'true' : 'false'}`)
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${k}: []`)
      } else {
        lines.push(`${k}:`)
        for (const item of value) lines.push(`  - ${formatScalar(String(item))}`)
      }
    } else if (canUseLiteralBlock(value)) {
      lines.push(`${k}: ${literalBlock(value)}`)
    } else {
      lines.push(`${k}: ${formatScalar(value)}`)
    }
  }
  if (lines.length === 0) return body
  return `---\n${lines.join('\n')}\n---\n${body}`
}

function canUseLiteralBlock(value: string): boolean {
  return value.includes('\n') && !value.includes('\r') && value.trim() !== '' && !/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
}

function literalBlock(value: string): string {
  const trailing = /\n*$/.exec(value)?.[0].length ?? 0
  const core = value.slice(0, value.length - trailing)
  const chomp = trailing === 0 ? '-' : trailing === 1 ? '' : '+'
  const coreLines = core.split('\n')
  const firstContent = coreLines.find((l) => l !== '') ?? ''
  const indicator = /^[ \t]/.test(firstContent) ? '2' : ''
  const body = coreLines.map((l) => (l === '' ? '' : `  ${l}`))
  // With keep chomping every extra trailing newline is an empty line inside the block.
  for (let n = 1; n < trailing; n++) body.push('')
  return `|${indicator}${chomp}\n${body.join('\n')}`
}

function formatScalar(value: string): string {
  return needsQuotes(value) ? quoteDouble(value) : value
}

function needsQuotes(value: string): boolean {
  if (value === '') return true
  if (value !== value.trim()) return true
  if (/[\0-\x1f\x7f\u0085\u2028\u2029]/.test(value)) return true
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true
  if (/:(?:\s|$)/.test(value) || /\s#/.test(value)) return true
  if (/^(?:true|false|yes|no|on|off|null|~|y|n)$/i.test(value)) return true
  if (/^[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(value)) return true
  if (/^0[xob][0-9a-f]+$/i.test(value)) return true
  if (/^[-+]?\.(?:inf|nan)$/i.test(value)) return true
  return false
}

function quoteDouble(value: string): string {
  let out = '"'
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\r') out += '\\r'
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`
    else if (code === 0x85 || code === 0x2028 || code === 0x2029) out += `\\u${code.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return `${out}"`
}
