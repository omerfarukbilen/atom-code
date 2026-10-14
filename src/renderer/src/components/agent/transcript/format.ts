/**
 * Small, dependency-free formatting and narrowing helpers for the chat transcript.
 */

export type Obj = Record<string, unknown>

export function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

export function bool(v: unknown): boolean {
  return v === true
}

/** "12.4s", "48s", "3m 05s", "1h 12m". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  if (ms < 1000) return `${Math.max(0.1, Math.round(ms / 100) / 10)}s`
  const s = ms / 1000
  if (s < 10) return `${(Math.round(s * 10) / 10).toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(Math.round(s % 60)).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** Whole seconds for live timers: "7s", "1m 05s". */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** "842", "1.2k", "14.2k", "128k", "1.4M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 100_000) return `${(Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(Math.round(n / 100_000) / 10).toFixed(1).replace(/\.0$/, '')}M`
}

/** "≈$0.08", "<$0.01", "≈$1.24". */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0.00'
  if (usd < 0.01) return '<$0.01'
  return `≈$${usd.toFixed(2)}`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, Math.max(0, max - 1)).trimEnd() + '…' : s
}

/** First line of a string, trimmed. */
export function firstLine(s: string): string {
  const t = s.trim()
  const i = t.indexOf('\n')
  return i === -1 ? t : t.slice(0, i).trim()
}

// ESC [ … final byte  |  ESC ] … BEL / ST  |  two-char ESC sequences  |  stray C1 CSI
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]|\u009b[0-?]*[ -/]*[@-~]/g

/** Remove ANSI escape sequences (colors, cursor movement, OSC links) and normalize line endings. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '').replace(/\r\n/g, '\n').replace(/\r(?!\n)/g, '\n')
}

/** Pretty JSON for display (strings that contain JSON are parsed first). */
export function prettyJson(value: unknown): string {
  if (typeof value === 'string') {
    const t = value.trim()
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try {
        return JSON.stringify(JSON.parse(t), null, 2)
      } catch {
        return value
      }
    }
    return value
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

export function countLines(s: string): number {
  if (!s) return 0
  let n = 1
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++
  return s.endsWith('\n') ? n - 1 : n
}

/** Host + path of a URL without the protocol ("example.com/docs"). */
export function shortUrl(url: string, max = 60): string {
  try {
    const u = new URL(url)
    const path = u.pathname === '/' ? '' : u.pathname
    return truncate(u.host + path + (u.search ? u.search : ''), max)
  } catch {
    return truncate(url, max)
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Local clock time for a unix ms timestamp ("3:05 PM"). */
export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** "in 2h 10m" / "in 4m" for a future unix ms timestamp. */
export function relativeFuture(ms: number, now = Date.now()): string {
  const diff = Math.max(0, ms - now)
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'in less than a minute'
  if (mins < 60) return `in ${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 48) return `in ${h}h ${String(mins % 60).padStart(2, '0')}m`
  return `in ${Math.round(h / 24)} days`
}
