/**
 * Small, dependency-free fuzzy matcher used by the command palette and quick open.
 *
 * Matching is a case-insensitive subsequence test (fzf v1 style: a forward pass finds the first full
 * match, a backward pass tightens the window). Scoring rewards matches at word boundaries, camelCase
 * humps, consecutive runs and early positions, and penalises gaps — good enough to rank file paths and
 * command titles the way VS Code / Cursor users expect.
 */

export interface FuzzyResult {
  score: number
  /** Indices into the matched text, ascending. */
  positions: number[]
}

export interface FuzzyMatch<T> extends FuzzyResult {
  item: T
}

const SEPARATORS = new Set(['/', '\\', '_', '-', '.', ' ', ':', '(', ')', '[', ']', '{', '}', ',', '@'])

function isUpper(c: string): boolean {
  return c >= 'A' && c <= 'Z'
}

function isLower(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, '')
}

/**
 * Scores `text` against `query`. Returns null when the query is not a subsequence of the text.
 * An empty query matches everything with score 0.
 */
export function fuzzyScore(query: string, text: string): FuzzyResult | null {
  const q = normalizeQuery(query)
  if (!q) return { score: 0, positions: [] }
  const m = q.length
  const n = text.length
  if (m > n) return null
  const ql = q.toLowerCase()
  const tl = text.toLowerCase()

  // Forward pass: earliest end of a full subsequence match.
  let qi = 0
  let end = -1
  for (let i = 0; i < n; i++) {
    if (tl.charCodeAt(i) === ql.charCodeAt(qi)) {
      qi++
      if (qi === m) {
        end = i
        break
      }
    }
  }
  if (end < 0) return null

  // Backward pass: latest start that still matches → tightest window ending at `end`.
  qi = m - 1
  let start = 0
  for (let i = end; i >= 0; i--) {
    if (tl.charCodeAt(i) === ql.charCodeAt(qi)) {
      qi--
      if (qi < 0) {
        start = i
        break
      }
    }
  }

  // Positions: greedy inside the window, but prefer a word-boundary occurrence of each character when
  // one exists before the next character would become unreachable.
  const positions: number[] = []
  let ti = start
  for (let k = 0; k < m; k++) {
    const ch = ql.charCodeAt(k)
    let first = -1
    let boundary = -1
    // Last index this character may take so the remaining query still fits before `end`.
    const limit = end - (m - 1 - k)
    for (let i = ti; i <= limit; i++) {
      if (tl.charCodeAt(i) !== ch) continue
      if (first === -1) first = i
      if (isBoundary(text, i)) {
        boundary = i
        break
      }
      // Stop scanning once we passed a consecutive continuation — runs beat far-away boundaries.
      if (positions.length > 0 && i === positions[positions.length - 1] + 1) break
    }
    let pick = first
    if (boundary !== -1 && boundary !== first) {
      const prev = positions[positions.length - 1]
      const firstIsConsecutive = prev !== undefined && first === prev + 1
      if (!firstIsConsecutive && remainingFits(tl, ql, k + 1, boundary + 1, end)) pick = boundary
    }
    if (pick === -1) return null
    positions.push(pick)
    ti = pick + 1
  }

  return { score: scorePositions(text, q, positions), positions }
}

function isBoundary(text: string, i: number): boolean {
  if (i === 0) return true
  const prev = text[i - 1]
  const cur = text[i]
  if (SEPARATORS.has(prev)) return true
  return isUpper(cur) && isLower(prev)
}

function remainingFits(tl: string, ql: string, from: number, ti: number, end: number): boolean {
  let qi = from
  for (let i = ti; i <= end && qi < ql.length; i++) if (tl.charCodeAt(i) === ql.charCodeAt(qi)) qi++
  return qi === ql.length
}

function scorePositions(text: string, query: string, positions: number[]): number {
  let score = 0
  for (let k = 0; k < positions.length; k++) {
    const pos = positions[k]
    let s = 16
    if (pos === 0) s += 12
    else {
      const prev = text[pos - 1]
      if (prev === '/' || prev === '\\') s += 10
      else if (SEPARATORS.has(prev)) s += 8
      else if (isUpper(text[pos]) && isLower(prev)) s += 7
    }
    if (k > 0) {
      const gap = pos - positions[k - 1] - 1
      if (gap === 0) s += 8
      else s -= Math.min(3 + gap, 14)
    }
    if (text[pos] === query[k]) s += 1
    score += s
  }
  // Prefer earlier and shorter matches.
  score -= positions[0] * 0.15
  score -= (text.length - positions.length) * 0.04
  return score
}

/**
 * Path-aware scoring for quick open: a match inside the file name outranks one scattered over the
 * directories, and exact / prefix file-name matches get an extra boost. Positions index into `path`.
 */
export function fuzzyScorePath(query: string, path: string): FuzzyResult | null {
  const q = normalizeQuery(query)
  if (!q) return { score: 0, positions: [] }
  const full = fuzzyScore(q, path)
  if (!full) return null
  if (q.includes('/') || q.includes('\\')) return full

  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const base = path.slice(slash + 1)
  const inBase = fuzzyScore(q, base)
  if (!inBase) return full

  const ql = q.toLowerCase()
  const bl = base.toLowerCase()
  const stem = bl.includes('.') ? bl.slice(0, bl.lastIndexOf('.')) : bl
  let bonus = 24
  if (stem === ql || bl === ql) bonus += 60
  else if (bl.startsWith(ql)) bonus += 36
  else if (bl.includes(ql)) bonus += 18
  const baseScore = inBase.score * 1.4 + bonus - path.length * 0.02
  if (baseScore <= full.score) return full
  const offset = slash + 1
  return { score: baseScore, positions: inBase.positions.map((p) => p + offset) }
}

export interface FuzzyFilterOptions {
  /** Max results (default: all). */
  limit?: number
  /** Use path-aware scoring (quick open). */
  path?: boolean
}

/** Filters and ranks `items` by fuzzy score. With an empty query the input order is kept. */
export function fuzzyFilter<T>(items: readonly T[], query: string, getText: (item: T) => string, options: FuzzyFilterOptions = {}): FuzzyMatch<T>[] {
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  if (!normalizeQuery(query)) {
    const out: FuzzyMatch<T>[] = []
    for (const item of items) {
      if (out.length >= limit) break
      out.push({ item, score: 0, positions: [] })
    }
    return out
  }
  const scorer = options.path ? fuzzyScorePath : fuzzyScore
  const matches: (FuzzyMatch<T> & { len: number })[] = []
  for (const item of items) {
    const text = getText(item)
    const r = scorer(query, text)
    if (r) matches.push({ item, score: r.score, positions: r.positions, len: text.length })
  }
  matches.sort((a, b) => b.score - a.score || a.len - b.len)
  const sliced = Number.isFinite(limit) ? matches.slice(0, limit) : matches
  return sliced.map(({ item, score, positions }) => ({ item, score, positions }))
}

/** Splits `text` into alternating plain / highlighted segments for the given match positions. */
export function highlightSegments(text: string, positions: readonly number[]): { text: string; match: boolean }[] {
  if (positions.length === 0) return [{ text, match: false }]
  const set = new Set(positions)
  const out: { text: string; match: boolean }[] = []
  let cur = ''
  let curMatch = set.has(0)
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i)
    if (m !== curMatch && cur) {
      out.push({ text: cur, match: curMatch })
      cur = ''
    }
    curMatch = m
    cur += text[i]
  }
  if (cur) out.push({ text: cur, match: curMatch })
  return out
}
