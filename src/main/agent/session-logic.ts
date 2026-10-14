/**
 * Pure bookkeeping helpers for AgentSession (no runtime imports, unit tested in tests/session-logic.test.ts).
 */
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'

// ─────────────────────────────────────────────────────────────────────────────
// Outstanding sends
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retire the sends a `result` answered. With `user_message_uuid(s)` the answered sends are known
 * exactly. Without them (meta turns such as a background-task notification, older CLIs) the oldest
 * sends are retired by count — but never below `queuedTurnCount`, the sends the CLI reports as still
 * waiting: retiring one of those would report the chat idle while the CLI still has work queued.
 */
export function reconcileOutstanding(
  outstanding: Set<string>,
  answered: readonly string[] | null | undefined,
  queuedTurnCount: number | null | undefined
): void {
  if (answered && answered.length > 0) {
    for (const uuid of answered) outstanding.delete(uuid)
    return
  }
  const keep = typeof queuedTurnCount === 'number' && Number.isFinite(queuedTurnCount) ? Math.max(0, Math.floor(queuedTurnCount)) : 0
  while (outstanding.size > keep) {
    const oldest = outstanding.values().next()
    if (oldest.done) break
    outstanding.delete(oldest.value)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// "Allow for this chat" grants
// ─────────────────────────────────────────────────────────────────────────────

/** `Bash` or `Bash(npm test:*)` — the rule syntax of `allowedTools`. */
export function ruleString(rule: { toolName: string; ruleContent?: string }): string | null {
  const tool = typeof rule.toolName === 'string' ? rule.toolName.trim() : ''
  if (!tool) return null
  const content = typeof rule.ruleContent === 'string' ? rule.ruleContent : ''
  return content ? `${tool}(${content})` : tool
}

/**
 * Fold the `session`-destination permission updates the user approved into the chat's grants. The CLI
 * keeps session rules in memory only (a resumed process starts without them), so the session
 * re-applies these as `allowedTools` / `additionalDirectories` on every launch.
 */
export function applySessionGrants(rules: Set<string>, directories: Set<string>, updates: readonly PermissionUpdate[]): void {
  for (const update of updates) {
    if (update.destination !== 'session') continue
    switch (update.type) {
      case 'addRules':
      case 'replaceRules': {
        if (update.behavior !== 'allow') break
        if (update.type === 'replaceRules') rules.clear()
        for (const rule of update.rules ?? []) {
          const r = ruleString(rule)
          if (r) rules.add(r)
        }
        break
      }
      case 'removeRules':
        if (update.behavior !== 'allow') break
        for (const rule of update.rules ?? []) {
          const r = ruleString(rule)
          if (r) rules.delete(r)
        }
        break
      case 'addDirectories':
        for (const dir of update.directories ?? []) if (typeof dir === 'string' && dir.trim()) directories.add(dir)
        break
      case 'removeDirectories':
        for (const dir of update.directories ?? []) directories.delete(dir)
        break
      default:
        break
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spending
// ─────────────────────────────────────────────────────────────────────────────

export interface CostState {
  /** Estimated spend of the chat across all CLI processes (USD). */
  spent: number
  /** Latest cumulative `total_cost_usd` of the current CLI process. */
  processTotal: number
}

/**
 * Account one `result.total_cost_usd` (cumulative for the CLI process; a resumed process starts from the
 * total its transcript saved, a `/clear` starts over at 0). Zero totals (crash/startup-error results)
 * are ignored so they cannot reset the baseline.
 */
export function accountCost(state: CostState, total: unknown): CostState {
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return state
  const delta = total >= state.processTotal ? total - state.processTotal : total
  return { spent: state.spent + delta, processTotal: total }
}

/** What is left of a per-chat budget for the next CLI launch; null = no limit. */
export function remainingBudget(budget: number | null | undefined, spent: number): number | null {
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) return null
  // The CLI treats a limit <= 0 as "none": keep a tiny positive one (send() refuses when nothing is left).
  return Math.max(budget - spent, 0.01)
}

/** True when a per-chat budget is set and the chat has used it up. */
export function budgetExhausted(budget: number | null | undefined, spent: number): boolean {
  return typeof budget === 'number' && Number.isFinite(budget) && budget > 0 && spent >= budget
}

export function formatUsd(value: number): string {
  return `$${value < 10 ? value.toFixed(2) : value.toFixed(0)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Background tasks
// ─────────────────────────────────────────────────────────────────────────────

export interface BackgroundTaskInfo {
  toolUseId?: string
  description?: string
}

/**
 * Replace the live background-task set with a `background_tasks_changed` payload (REPLACE semantics),
 * skipping ambient entries (watchers that are not activity) and keeping known tool_use ids.
 */
export function replaceBackgroundTasks(
  tasks: Map<string, BackgroundTaskInfo>,
  payload: unknown,
  toolUseIds: ReadonlyMap<string, string>
): void {
  if (!Array.isArray(payload)) return
  const previous = new Map(tasks)
  tasks.clear()
  for (const entry of payload) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as { task_id?: unknown; description?: unknown; ambient?: unknown }
    if (typeof e.task_id !== 'string' || !e.task_id || e.ambient === true) continue
    const info: BackgroundTaskInfo = { ...previous.get(e.task_id) }
    const toolUseId = toolUseIds.get(e.task_id)
    if (toolUseId) info.toolUseId = toolUseId
    if (typeof e.description === 'string' && e.description.trim()) info.description = e.description.trim()
    tasks.set(e.task_id, info)
  }
}

/**
 * The `task_notification` main reports for a background task whose CLI went away (restart, exit, close):
 * the CLI cannot report it any more, and without it the task's card would spin forever.
 */
export function orphanedTaskNotification(
  taskId: string,
  info: BackgroundTaskInfo,
  summary: string,
  sessionId: string,
  uuid: string
): { type: 'system'; subtype: 'task_notification'; [key: string]: unknown } {
  return {
    type: 'system',
    subtype: 'task_notification',
    task_id: taskId,
    ...(info.toolUseId ? { tool_use_id: info.toolUseId } : {}),
    status: 'stopped',
    summary,
    uuid,
    session_id: sessionId
  }
}
