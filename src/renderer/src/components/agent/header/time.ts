/** Relative time helpers for chat history ("just now", "5m ago", "Yesterday", "Mar 4"). */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function relativeTime(ms: number, now: number = Date.now()): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const diff = Math.max(0, now - ms)
  if (diff < 45_000) return 'just now'
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))}m ago`
  const today = startOfDay(now)
  if (ms >= today) return `${Math.round(diff / HOUR)}h ago`
  if (ms >= today - DAY) return 'Yesterday'
  if (ms >= today - 6 * DAY) return `${Math.ceil((today - ms) / DAY)}d ago`
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' })
}

export function fullDate(ms: number): string {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleString() : ''
}

export type HistoryGroup = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older'

export const HISTORY_GROUPS: HistoryGroup[] = ['Today', 'Yesterday', 'Previous 7 days', 'Older']

export function historyGroup(ms: number, now: number = Date.now()): HistoryGroup {
  const today = startOfDay(now)
  if (ms >= today) return 'Today'
  if (ms >= today - DAY) return 'Yesterday'
  if (ms >= today - 7 * DAY) return 'Previous 7 days'
  return 'Older'
}

/** Clock time for rate-limit resets, e.g. "3:40 PM" (or a date when it is not today). */
export function resetTime(ms: number, now: number = Date.now()): string {
  const d = new Date(ms)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return ms - now < DAY && d.getDate() === new Date(now).getDate() ? time : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`
}
