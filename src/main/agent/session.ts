/**
 * AgentSession — one ATOM Code chat backed by one long-lived Claude Agent SDK `query()` in
 * streaming-input mode (see docs/ARCHITECTURE.md §5).
 *
 * The prompt is an async push queue that stays open for the life of the query, so follow-up
 * messages, interrupts and every control request (permission mode, model, effort, rewind, context
 * usage, capabilities, MCP status, task stop) work live. Closing the queue ends the query.
 */
import { randomUUID, type UUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { AbortError, USAGE_LIMIT_ERROR_PREFIXES, query } from '@anthropic-ai/claude-agent-sdk'
import type {
  AccountInfo,
  AgentInfo,
  CanUseTool,
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  ModelInfo,
  Options,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKAssistantMessage,
  SDKControlGetContextUsageResponse,
  SDKMessage,
  SDKRateLimitInfo,
  SDKResultMessage,
  SDKUserMessage,
  SlashCommand
} from '@anthropic-ai/claude-agent-sdk'
import { DEFAULT_MODE_ID, PERMISSION_POLICIES, findMode, normalizeModelValue } from '../../shared/modes'
import type {
  AgentCapabilities,
  AgentEvent,
  AgentModeDefinition,
  AgentRunStatus,
  ContextUsageInfo,
  CreateChatOptions,
  EffortLevel,
  ModelOption,
  OutgoingUserMessage,
  PermissionPolicy,
  PermissionRequest,
  PermissionResponse,
  RateLimitInfo,
  RewindResult,
  SdkMessageLike,
  SessionInitInfo,
  SlashCommandInfo
} from '../../shared/types'
import type { McpServerStatusInfo } from '../../shared/ipc'
import { settingsService } from '../services/settings'
import {
  FILE_EDIT_TOOLS,
  buildQueryOptions,
  computeConfigSignature,
  readProjectRules,
  resolveEffort,
  resolveModel,
  resolvePermissionMode
} from './options'
import { renderUserPrompt } from './prompt'

export type AgentErrorKind = Extract<AgentEvent, { type: 'error' }>['kind']

export interface AgentSessionDeps {
  /** Deliver an event for this chat to the renderer. */
  emit: (event: AgentEvent) => void
  /** Called once per session with the account the CLI is signed in with. */
  onAccountInfo?: (info: AccountInfo) => void
}

const EFFORT_VALUES: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']
const POLICY_VALUES: readonly PermissionPolicy[] = PERMISSION_POLICIES.map((p) => p.id)
const STDERR_FLUSH_INTERVAL_MS = 100
const STDERR_MAX_BUFFER = 64_000
const RESTART_GRACE_MS = 2500

// ─────────────────────────────────────────────────────────────────────────────
// Push queue (streaming input)
// ─────────────────────────────────────────────────────────────────────────────

/** Unbounded async queue: `push()` from anywhere, consumed once as an AsyncIterable. */
export class PushQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private ended = false

  get closed(): boolean {
    return this.ended
  }

  push(item: T): void {
    if (this.ended) throw new Error('The agent input stream is closed.')
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value: item, done: false })
    else this.items.push(item)
  }

  /** End the stream. Items already queued are still delivered before `done`. */
  close(): void {
    if (this.ended) return
    this.ended = true
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true })
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.items.length > 0) return Promise.resolve({ value: this.items.shift() as T, done: false })
        if (this.ended) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolveNext) => this.waiters.push(resolveNext))
      },
      return: (): Promise<IteratorResult<T>> => {
        this.close()
        return Promise.resolve({ value: undefined, done: true })
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for reuse/testing)
// ─────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  if (typeof err === 'string') return err
  if (isRecord(err) && typeof err.message === 'string') return err.message
  try {
    return JSON.stringify(err) ?? String(err)
  } catch {
    return String(err)
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof AbortError || (err instanceof Error && err.name === 'AbortError')
}

/**
 * Deep-copy a value into something structured-clone/JSON safe for IPC: drops functions and symbols,
 * stringifies bigints, converts Dates/Errors/Maps/Sets/typed arrays and breaks cycles.
 */
export function toIpcSafe(value: unknown, depth = 0, path: WeakSet<object> = new WeakSet()): unknown {
  if (value === null) return null
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value
    case 'number':
      return Number.isFinite(value) ? value : null
    case 'bigint':
      return value.toString()
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined
  }
  const obj = value as object
  if (depth > 64) return '[max depth]'
  if (path.has(obj)) return '[circular]'
  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? null : obj.toISOString()
  if (obj instanceof Error) return { name: obj.name, message: obj.message }
  if (ArrayBuffer.isView(obj)) return Buffer.from(obj.buffer, obj.byteOffset, obj.byteLength).toString('base64')
  if (obj instanceof ArrayBuffer) return Buffer.from(obj).toString('base64')
  path.add(obj)
  try {
    if (Array.isArray(obj) || obj instanceof Set) {
      return Array.from(obj as Iterable<unknown>, (v) => {
        const safe = toIpcSafe(v, depth + 1, path)
        return safe === undefined ? null : safe
      })
    }
    const entries: Iterable<[unknown, unknown]> = obj instanceof Map ? obj.entries() : Object.entries(obj)
    const out: Record<string, unknown> = {}
    for (const [k, v] of entries) {
      const safe = toIpcSafe(v, depth + 1, path)
      if (safe !== undefined) out[String(k)] = safe
    }
    return out
  } finally {
    path.delete(obj)
  }
}

const AUTH_PATTERNS = [
  /authentication_failed/i,
  /\b401\b/,
  /invalid api key/i,
  /not logged in/i,
  /please run \/login/i,
  /oauth token (?:has )?(?:expired|been revoked)/i,
  /invalid (?:bearer|x-api-key)/i
]
const PROCESS_PATTERNS = [
  /process exited with code/i,
  /terminated by signal/i,
  /executable not found/i,
  /native binary not found/i,
  /\bspawn\b/i,
  /\bENOENT\b/,
  /\bEACCES\b/,
  /\bEPERM\b/,
  /initialization did not complete/i
]

/** Classify an error text (plus optional SDK error code / HTTP status) for the renderer. */
export function classifyAgentError(text: string, code?: string | null, status?: number | null): AgentErrorKind {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const stripped = lines.map((l) => l.replace(/^(?:API Error:\s*|Error:\s*)/i, ''))
  if (stripped.some((l) => USAGE_LIMIT_ERROR_PREFIXES.some((p) => l.startsWith(p)))) return 'usage-limit'
  if (code === 'authentication_failed' || code === 'oauth_org_not_allowed' || status === 401) return 'auth'
  if (AUTH_PATTERNS.some((re) => re.test(text))) return 'auth'
  if (code === 'rate_limit' || status === 429 || /rate[_ ]limit/i.test(text)) return 'rate-limit'
  if (PROCESS_PATTERNS.some((re) => re.test(text))) return 'process'
  return 'unknown'
}

const ASSISTANT_ERROR_TEXT: Record<string, string> = {
  authentication_failed: 'Authentication failed. Sign in again from the Account settings.',
  oauth_org_not_allowed: 'Your organization does not allow this sign-in method for Claude Code.',
  account_on_hold: 'Your account is on hold. Check your Claude account for details.',
  verification_required: 'Your account needs verification before it can be used.',
  billing_error: 'There is a billing problem with your account.',
  rate_limit: 'Rate limited by the API. Wait a moment and try again.',
  overloaded: 'The API is overloaded right now. Try again shortly.',
  invalid_request: 'The API rejected the request as invalid.',
  model_not_found: 'The selected model is not available for your account.',
  server_error: 'The API returned a server error. Try again shortly.',
  max_output_tokens: 'The response hit the maximum output length.',
  cloud_credential_error: 'Your cloud provider credentials are missing or invalid.'
}

const RESULT_ERROR_TEXT: Record<string, string> = {
  error_max_turns: 'The agent stopped after reaching the maximum number of turns.',
  error_max_budget_usd: 'The agent stopped after reaching the spending limit for this chat.',
  error_max_structured_output_retries: 'The agent could not produce valid structured output.',
  error_during_execution: 'The agent hit an error while running.'
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => (isRecord(b) && b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
    .filter(Boolean)
    .join('\n')
}

function asEffortLevels(levels: unknown): EffortLevel[] | undefined {
  if (!Array.isArray(levels)) return undefined
  const out = levels.filter((l): l is EffortLevel => typeof l === 'string' && (EFFORT_VALUES as readonly string[]).includes(l))
  return out.length > 0 ? out : undefined
}

/** Map the SDK's commands/models/agents into the renderer's AgentCapabilities. */
export function mapCapabilities(
  commands: readonly SlashCommand[] | undefined,
  models: readonly ModelInfo[] | undefined,
  agents: readonly AgentInfo[] | undefined
): AgentCapabilities {
  const commandMap = new Map<string, SlashCommandInfo>()
  for (const c of commands ?? []) {
    if (!c || typeof c.name !== 'string' || !c.name) continue
    const info: SlashCommandInfo = {
      name: c.name,
      description: typeof c.description === 'string' ? c.description : '',
      argumentHint: typeof c.argumentHint === 'string' ? c.argumentHint : ''
    }
    if (c.builtin) info.builtin = true
    const existing = commandMap.get(c.name)
    // Rows can share a name; the built-in row is the one `/name` runs.
    if (!existing || (info.builtin && !existing.builtin)) commandMap.set(c.name, info)
  }

  const modelMap = new Map<string, ModelOption>()
  for (const m of models ?? []) {
    if (!m || typeof m.value !== 'string') continue
    const value = normalizeModelValue(m.value)
    if (modelMap.has(value)) continue
    const option: ModelOption = { value, label: m.displayName || m.value || 'Default' }
    if (m.description) option.description = m.description
    if (m.supportsEffort !== undefined) option.supportsEffort = m.supportsEffort
    const levels = asEffortLevels(m.supportedEffortLevels)
    if (levels) option.supportedEffortLevels = levels
    modelMap.set(value, option)
  }

  const agentList: { name: string; description: string }[] = []
  const seenAgents = new Set<string>()
  for (const a of agents ?? []) {
    if (!a || typeof a.name !== 'string' || !a.name || seenAgents.has(a.name)) continue
    seenAgents.add(a.name)
    agentList.push({ name: a.name, description: typeof a.description === 'string' ? a.description : '' })
  }

  return { commands: [...commandMap.values()], models: [...modelMap.values()], agents: agentList }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Map the SDK's context-usage control response to ContextUsageInfo. */
export function mapContextUsage(res: SDKControlGetContextUsageResponse | null | undefined): ContextUsageInfo | null {
  if (!isRecord(res)) return null
  const total = finiteNumber(res.totalTokens)
  if (total === null) return null
  const max = finiteNumber(res.maxTokens) ?? finiteNumber(res.rawMaxTokens) ?? 0
  let percentage = finiteNumber(res.percentage)
  if (percentage === null) percentage = max > 0 ? (total / max) * 100 : 0
  const usage: ContextUsageInfo = {
    totalTokens: Math.max(0, Math.round(total)),
    maxTokens: Math.max(0, Math.round(max)),
    percentage: Math.max(0, Math.round(percentage * 10) / 10)
  }
  if (Array.isArray(res.categories)) {
    const categories = res.categories
      .filter((c) => isRecord(c) && c.kind !== 'free' && c.kind !== 'deferred')
      .map((c) => ({ name: String(c.name), tokens: finiteNumber(c.tokens) ?? 0 }))
      .filter((c) => c.tokens > 0)
    if (categories.length > 0) usage.categories = categories
  }
  return usage
}

/** Map an SDK rate-limit payload to RateLimitInfo (resetsAt normalized to Unix ms). */
export function mapRateLimit(info: SDKRateLimitInfo): RateLimitInfo {
  const out: RateLimitInfo = { raw: toIpcSafe(info) }
  if (info.rateLimitType) out.window = info.rateLimitType
  if (info.status) out.status = info.status
  const resetsAt = finiteNumber(info.resetsAt)
  if (resetsAt !== null) out.resetsAt = resetsAt < 1e12 ? resetsAt * 1000 : resetsAt
  const utilization = finiteNumber(info.utilization)
  if (utilization !== null) out.utilization = utilization
  return out
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: unknown): value is UUID {
  return typeof value === 'string' && UUID_RE.test(value)
}

function editedPath(toolInput: unknown, cwd: string): string | null {
  if (!isRecord(toolInput)) return null
  const raw =
    typeof toolInput.file_path === 'string'
      ? toolInput.file_path
      : typeof toolInput.notebook_path === 'string'
        ? toolInput.notebook_path
        : null
  if (!raw) return null
  return isAbsolute(raw) ? raw : resolve(cwd, raw)
}

/**
 * Create the SDK query. Resolves to a wrapper object (never the Query itself) so a Query-like proxy
 * that answers every property — including `then` — cannot hijack the await.
 */
async function createQuery(params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }): Promise<{ q: Query }> {
  // Developer aid: a scripted stand-in for the SDK so the UI can be exercised without signing in.
  if (process.env['ATOM_FAKE_AGENT'] === '1') {
    const { createFakeQuery } = await import('./fake-query')
    return { q: createFakeQuery(params) }
  }
  return { q: query(params) }
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentSession
// ─────────────────────────────────────────────────────────────────────────────

interface PendingPermission {
  request: PermissionRequest
  input: Record<string, unknown>
  suggestions: PermissionUpdate[]
  /** The CLI forbids a persistent rule for this ask (it would grant more than this action). */
  suppressAlways: boolean
  settle: (result: PermissionResult) => void
}

export class AgentSession {
  readonly chatId: string
  readonly workspace: string

  private modeId: string
  private model: string
  private effort: EffortLevel | 'auto'
  private permission: PermissionPolicy
  private sessionId: string | null
  private forkPending: boolean
  private readonly title: string | undefined

  private q: Query | null = null
  private input: PushQueue<SDKUserMessage> | null = null
  private generation = 0
  private pumpDone: Promise<void> = Promise.resolve()
  private starting: Promise<void> | null = null
  private restarting: Promise<void> | null = null
  private restartPending = false
  private disposed = false

  private status: AgentRunStatus = 'closed'
  private runningSignature: string | null = null
  private bypassAllowed = false
  private projectRules: string | null = null
  private capabilities: AgentCapabilities | null = null
  private capabilitiesGeneration = -1
  private contextUsage: ContextUsageInfo | null = null
  private contextUsageInFlight: Promise<void> | null = null
  private accountFetched = false
  private interruptRequested = false
  private readonly turnErrors = new Set<string>()
  private lastError: string | null = null
  private planExitPermission: PermissionPolicy | null = null
  private readonly pending = new Map<string, PendingPermission>()
  /** Uuids of sent user messages whose turn has not produced a `result` yet (oldest first). */
  private readonly outstanding = new Set<string>()

  private stderrBuffer = ''
  private stderrTimer: ReturnType<typeof setTimeout> | null = null
  private lastStderrFlush = 0

  constructor(
    options: CreateChatOptions,
    private readonly deps: AgentSessionDeps
  ) {
    this.chatId = options.chatId
    this.workspace = options.workspace
    this.modeId = options.modeId
    this.model = normalizeModelValue(options.model)
    this.effort = options.effort
    this.permission = options.permission
    this.sessionId = options.resumeSessionId?.trim() || null
    this.forkPending = Boolean(this.sessionId && options.forkSession)
    this.title = options.title
  }

  // ── public state ──────────────────────────────────────────────────────────

  getSessionId(): string | null {
    return this.sessionId
  }

  getStatus(): AgentRunStatus {
    return this.status
  }

  getModeId(): string {
    return this.modeId
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  /** Spawn the CLI (idempotent while a launch is in flight). Failures are reported as events. */
  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('This chat has been closed.'))
    if (this.starting) return this.starting
    const launch = this.launch().finally(() => {
      if (this.starting === launch) this.starting = null
    })
    this.starting = launch
    return launch
  }

  /** Stop the CLI for good. Pending permission prompts are denied. */
  async close(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.restartPending = false
    const q = this.q
    const input = this.input
    this.generation++
    this.q = null
    this.input = null
    this.denyAllPending('The chat was closed.', true)
    input?.close()
    try {
      q?.close()
    } catch {
      /* already gone */
    }
    this.flushStderr()
    this.setStatus('closed')
  }

  /**
   * Stop the CLI and forget the SDK session (e.g. after its transcript was deleted) so the next
   * message starts a fresh conversation instead of resuming.
   */
  async forgetSession(): Promise<void> {
    if (this.disposed) return
    if (this.starting) await this.starting.catch(() => undefined)
    await this.stopCurrent()
    this.sessionId = null
    this.forkPending = false
    this.setStatus('closed')
  }

  // ── messaging ─────────────────────────────────────────────────────────────

  async send(msg: OutgoingUserMessage): Promise<void> {
    if (!isRecord(msg) || typeof msg.text !== 'string') throw new Error('Invalid message payload.')
    const images = (Array.isArray(msg.images) ? msg.images : []).filter(
      (img) => isRecord(img) && typeof img.data === 'string' && img.data.length > 0 && typeof img.mediaType === 'string'
    )
    const settings = settingsService.get()
    const text = renderUserPrompt(msg, {
      workspace: this.workspace,
      includeActiveEditor: settings.agent.autoIncludeActiveFile
    })
    if (!text.trim() && images.length === 0) throw new Error('Cannot send an empty message.')

    await this.ensureRunning()
    const input = this.input
    if (!input) throw new Error(this.lastError ?? 'The agent is not running.')

    const content: SDKUserMessage['message']['content'] =
      images.length > 0
        ? [
            ...images.map((img) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.mediaType, data: img.data }
            })),
            ...(text.trim() ? [{ type: 'text' as const, text }] : [])
          ]
        : text

    const uuid: UUID = isUuid(msg.uuid) ? msg.uuid : randomUUID()
    const busy = this.isBusy()
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      uuid,
      session_id: '',
      origin: { kind: 'human' }
    }
    if (busy && msg.priority) message.priority = msg.priority
    if (!busy) {
      this.turnErrors.clear()
      this.interruptRequested = false
    }

    this.outstanding.add(uuid)
    try {
      input.push(message)
    } catch (err) {
      this.outstanding.delete(uuid)
      throw err
    }
    this.emit({ type: 'user-sent', uuid, text, images: images.length })
    if (!busy) this.setStatus('running')
  }

  async interrupt(): Promise<void> {
    const q = this.q
    const busy = this.isBusy()
    this.denyAllPending('The user interrupted the agent.', true)
    if (!q || !busy) return
    this.interruptRequested = true
    try {
      await q.interrupt()
    } catch (err) {
      if (this.q === q) throw new Error(`Could not interrupt the agent: ${errorMessage(err)}`)
    }
  }

  async respondPermission(requestId: string, response: PermissionResponse): Promise<void> {
    const pending = this.pending.get(requestId)
    // Already settled (cancelled, interrupted or answered twice): nothing left to do.
    if (!pending) return
    if (!isRecord(response) || (response.behavior !== 'allow' && response.behavior !== 'deny')) {
      throw new Error('Invalid permission response.')
    }

    if (response.behavior === 'deny') {
      if (response.interrupt) this.interruptRequested = true
      this.settlePermission(requestId, {
        behavior: 'deny',
        message: response.message?.trim() || 'The user declined this action.',
        ...(response.interrupt ? { interrupt: true } : {}),
        decisionClassification: 'user_reject'
      })
      return
    }

    const { kind, toolName } = pending.request
    const updatedInput = isRecord(response.updatedInput)
      ? kind === 'tool'
        ? response.updatedInput
        : { ...pending.input, ...response.updatedInput }
      : pending.input

    const result: PermissionResult = {
      behavior: 'allow',
      updatedInput,
      decisionClassification: response.scope === 'always' ? 'user_permanent' : 'user_temporary'
    }

    let sessionMode: PermissionPolicy | null = null
    if (kind === 'tool' && response.scope !== 'once' && pending.suggestions.length > 0) {
      // The renderer cannot see `suppressAlwaysAllowRule`: downgrade "always" to this chat only.
      const persistent = response.scope === 'always' && !pending.suppressAlways
      const updates: PermissionUpdate[] = []
      for (const s of pending.suggestions) {
        if (s.type === 'setMode') {
          // Never persist a default mode into the project's settings — apply it to this chat only.
          if ((POLICY_VALUES as readonly string[]).includes(s.mode)) sessionMode = s.mode as PermissionPolicy
          updates.push({ ...s, destination: 'session' })
        } else {
          updates.push({ ...s, destination: persistent ? 'localSettings' : 'session' })
        }
      }
      result.updatedPermissions = updates
    }

    // Approving ExitPlanMode always leaves plan mode in the CLI; without an explicit policy keep the
    // chat's current one so ATOM's mode never stays "plan" while the CLI runs the plan.
    const nextPermission =
      kind === 'plan'
        ? response.nextPermission && (POLICY_VALUES as readonly string[]).includes(response.nextPermission)
          ? response.nextPermission
          : this.permission
        : undefined
    if (nextPermission) this.planExitPermission = nextPermission

    this.settlePermission(requestId, result)

    if (nextPermission) {
      await this.applyPlanApproval(nextPermission)
    } else if (sessionMode && this.currentMode().forcedPermissionMode !== 'plan') {
      this.permission = sessionMode
      this.emitModeChanged()
    } else if (toolName === 'EnterPlanMode') {
      this.emit({ type: 'mode-changed', modeId: this.modeId, permission: 'plan' })
    }
  }

  // ── live configuration ────────────────────────────────────────────────────

  async setMode(modeId: string): Promise<void> {
    if (typeof modeId !== 'string' || !modeId) throw new Error('Invalid mode id.')
    const settings = settingsService.get()
    const previous = this.currentMode()
    const next = findMode(modeId, settings.customModes)
    this.modeId = next.id
    this.emitModeChanged()

    if (this.starting) await this.starting.catch(() => undefined)
    const q = this.q
    if (!q || this.disposed) return // applied on the next launch

    const signature = computeConfigSignature(next, settings, this.workspace, this.projectRules)
    if (signature !== this.runningSignature) {
      this.scheduleRestart()
      return
    }
    await this.applyLivePermission(this.permission, next)
    const prevModel = resolveModel(this.model, previous)
    const nextModel = resolveModel(this.model, next)
    if (prevModel !== nextModel) await this.control(() => q.setModel(nextModel || undefined), 'switch the model')
    const prevEffort = resolveEffort(this.effort, previous)
    const nextEffort = resolveEffort(this.effort, next)
    if (prevEffort !== nextEffort) {
      await this.control(() => q.applyFlagSettings({ effortLevel: nextEffort ?? null }), 'change the effort level')
    }
  }

  async setPermission(policy: PermissionPolicy): Promise<void> {
    if (!(POLICY_VALUES as readonly string[]).includes(policy)) throw new Error(`Unknown permission policy: ${String(policy)}`)
    this.permission = policy
    this.emitModeChanged()
    if (this.starting) await this.starting.catch(() => undefined)
    if (!this.q || this.disposed) return
    // A plan-mode chat stays in plan mode until the plan is approved.
    if (this.currentMode().forcedPermissionMode === 'plan') return
    await this.applyLivePermission(policy)
  }

  async setModel(model: string): Promise<void> {
    if (typeof model !== 'string') throw new Error('Invalid model.')
    this.model = normalizeModelValue(model.trim())
    if (this.starting) await this.starting.catch(() => undefined)
    const q = this.q
    if (!q || this.disposed) return
    const effective = resolveModel(this.model, this.currentMode())
    await this.control(() => q.setModel(effective || undefined), 'switch the model')
  }

  async setEffort(effort: EffortLevel | 'auto'): Promise<void> {
    if (effort !== 'auto' && !EFFORT_VALUES.includes(effort)) throw new Error(`Unknown effort level: ${String(effort)}`)
    this.effort = effort
    if (this.starting) await this.starting.catch(() => undefined)
    const q = this.q
    if (!q || this.disposed) return
    const effective = resolveEffort(effort, this.currentMode())
    await this.control(() => q.applyFlagSettings({ effortLevel: effective ?? null }), 'change the effort level')
  }

  /** Re-check the running configuration after a settings change; restart (deferred) if it differs. */
  onSettingsChanged(): void {
    if (this.disposed) return
    if (this.starting) {
      // The launch read an earlier snapshot of the settings: compare once it is up.
      void this.starting.then(() => this.onSettingsChanged()).catch(() => undefined)
      return
    }
    if (!this.q) return
    const settings = settingsService.get()
    const signature = computeConfigSignature(this.currentMode(), settings, this.workspace, this.projectRules)
    if (signature !== this.runningSignature) this.scheduleRestart()
  }

  /**
   * Relaunch the CLI (with resume, once the current turn is over) so it picks up state that is
   * fixed at spawn time — e.g. new credentials in its environment after a sign-in change.
   */
  requestRestart(): void {
    if (this.disposed) return
    this.accountFetched = false
    this.scheduleRestart()
  }

  // ── queries ───────────────────────────────────────────────────────────────

  async rewind(userMessageUuid: string, dryRun = false): Promise<RewindResult> {
    if (typeof userMessageUuid !== 'string' || !userMessageUuid) throw new Error('Invalid message id.')
    try {
      await this.ensureRunning()
      const q = this.q
      if (!q) throw new Error(this.lastError ?? 'The agent is not running.')
      const res = await q.rewindFiles(userMessageUuid, { dryRun })
      const out: RewindResult = { canRewind: Boolean(res?.canRewind) }
      if (res?.error) out.error = res.error
      if (Array.isArray(res?.filesChanged)) out.filesChanged = res.filesChanged
      if (typeof res?.insertions === 'number') out.insertions = res.insertions
      if (typeof res?.deletions === 'number') out.deletions = res.deletions
      if (!dryRun && out.canRewind && out.filesChanged) {
        for (const file of out.filesChanged) {
          this.emit({ type: 'file-changed', path: isAbsolute(file) ? file : resolve(this.workspace, file), tool: 'rewind' })
        }
      }
      return out
    } catch (err) {
      return { canRewind: false, error: errorMessage(err) }
    }
  }

  async getContextUsage(): Promise<ContextUsageInfo | null> {
    const q = this.q
    if (q && !this.starting) await this.refreshContextUsage(q, this.generation)
    return this.contextUsage
  }

  async getCapabilities(): Promise<AgentCapabilities | null> {
    const q = this.q
    if (!this.capabilities && q && !this.starting) await this.refreshCapabilities(q, this.generation)
    return this.capabilities
  }

  async stopTask(taskId: string): Promise<void> {
    if (typeof taskId !== 'string' || !taskId) throw new Error('Invalid task id.')
    const q = this.q
    if (!q) throw new Error('The agent is not running.')
    await this.control(() => q.stopTask(taskId), 'stop the task')
  }

  async mcpStatus(): Promise<McpServerStatusInfo[]> {
    const q = this.q
    if (!q) return []
    const list = await this.control(() => q.mcpServerStatus(), 'read the MCP server status')
    return (Array.isArray(list) ? list : []).map((s) => {
      const info: McpServerStatusInfo = { name: s.name, status: s.status }
      if (s.error) info.error = s.error
      if (Array.isArray(s.tools)) info.tools = s.tools.map((t) => t.name)
      return info
    })
  }

  // ── internals: launch / restart ───────────────────────────────────────────

  private currentMode(): AgentModeDefinition {
    return findMode(this.modeId, settingsService.get().customModes)
  }

  private isBusy(): boolean {
    return this.status === 'running' || this.status === 'awaiting-input'
  }

  private isCurrent(q: Query, gen: number): boolean {
    return !this.disposed && this.generation === gen && this.q === q
  }

  private async ensureRunning(): Promise<void> {
    if (this.disposed) throw new Error('This chat has been closed.')
    if (this.restarting) await this.restarting
    if (this.starting) await this.starting
    // The SDK stopped reading our input (its process is going away): retire that query before
    // launching another, so two CLIs never run for one chat.
    if (this.q && (!this.input || this.input.closed)) await this.stopCurrent()
    if (!this.q || !this.input || this.input.closed) await this.start()
    if (!this.q || !this.input) throw new Error(this.lastError ?? 'The agent could not be started.')
  }

  private async launch(): Promise<void> {
    const gen = ++this.generation
    this.restartPending = false
    this.lastError = null
    this.turnErrors.clear()
    this.setStatus('starting')

    const settings = settingsService.get()
    const mode = this.currentMode()
    if (mode.id !== this.modeId) {
      // The chat's custom mode was deleted: tell the renderer which mode actually runs.
      this.modeId = mode.id
      this.emitModeChanged()
    }
    const permission = this.permission
    const resume = this.sessionId ?? undefined

    let options: Options
    try {
      const projectRules = await readProjectRules(this.workspace)
      if (gen !== this.generation || this.disposed) return
      this.projectRules = projectRules
      options = await buildQueryOptions({
        chatId: this.chatId,
        workspace: this.workspace,
        mode,
        settings,
        model: this.model,
        effort: this.effort,
        permission,
        projectRules,
        resume,
        forkSession: this.forkPending,
        title: this.title,
        // A query that was replaced or closed must not open prompts the current one would own.
        canUseTool: (toolName, toolInput, toolOptions) =>
          gen === this.generation && !this.disposed
            ? this.canUseTool(toolName, toolInput, toolOptions)
            : Promise.resolve({ behavior: 'deny', message: 'This agent session was restarted or closed.' }),
        hooks: this.buildHooks(),
        onStderr: this.onStderr
      })
    } catch (err) {
      if (gen === this.generation && !this.disposed) this.fail(err, 'process')
      return
    }
    if (gen !== this.generation || this.disposed) return

    this.runningSignature = computeConfigSignature(mode, settings, this.workspace, this.projectRules)
    this.bypassAllowed = options.allowDangerouslySkipPermissions === true

    const input = new PushQueue<SDKUserMessage>()
    let q: Query
    try {
      ;({ q } = await createQuery({ prompt: input, options }))
    } catch (err) {
      if (gen === this.generation && !this.disposed) this.fail(err, 'process')
      return
    }
    if (gen !== this.generation || this.disposed) {
      input.close()
      try {
        q.close()
      } catch {
        /* ignore */
      }
      return
    }
    this.q = q
    this.input = input
    this.pumpDone = this.pump(q, gen)
    void this.afterLaunch(q, gen)
  }

  private async afterLaunch(q: Query, gen: number): Promise<void> {
    try {
      const init = await q.initializationResult()
      if (!this.isCurrent(q, gen)) return
      if (init) {
        this.capabilitiesGeneration = gen
        this.setCapabilities(mapCapabilities(init.commands, init.models, init.agents))
      }
      if (this.status === 'starting') this.setStatus('idle')
      if (!this.accountFetched) {
        this.accountFetched = true
        let account: AccountInfo | undefined = init?.account
        try {
          account = (await q.accountInfo()) ?? account
        } catch {
          /* fall back to the initialize response */
        }
        if (account && this.deps.onAccountInfo) this.deps.onAccountInfo(account)
      }
    } catch (err) {
      // The pump usually observes the same failure; give it a moment to report it first.
      await new Promise((r) => setTimeout(r, 50))
      if (!this.isCurrent(q, gen) || this.status !== 'starting') return
      this.fail(err, 'process')
    }
  }

  private scheduleRestart(): void {
    if (this.disposed) return
    if (!this.q && !this.starting) return // nothing running: the next launch reads the new config
    if (this.isBusy() || !this.isQuiescent() || this.starting) {
      this.restartPending = true
      return
    }
    void this.restart()
  }

  private restart(): Promise<void> {
    if (this.restarting) return this.restarting
    this.restartPending = false
    const run = (async (): Promise<void> => {
      await Promise.resolve()
      if (this.starting) await this.starting.catch(() => undefined)
      if (this.disposed) return
      if (this.q && !this.isQuiescent()) {
        // A message slipped in: never kill a turn, apply the change once it is over.
        this.restartPending = true
        return
      }
      this.setStatus('starting', 'Applying the new configuration…')
      await this.stopCurrent()
      if (this.disposed) return
      await this.start()
    })()
      .catch((err) => {
        if (!this.disposed) this.fail(err, 'process')
      })
      .finally(() => {
        if (this.restarting === run) this.restarting = null
      })
    this.restarting = run
    return run
  }

  /** Gracefully stop the current query (close input, wait briefly, then force close). */
  private async stopCurrent(): Promise<void> {
    const q = this.q
    const input = this.input
    const done = this.pumpDone
    this.generation++
    this.q = null
    this.input = null
    this.denyAllPending('The agent is restarting.')
    this.outstanding.clear()
    input?.close()
    if (!q) return
    let timer: ReturnType<typeof setTimeout> | null = null
    await Promise.race([done, new Promise<void>((r) => (timer = setTimeout(r, RESTART_GRACE_MS)))])
    if (timer) clearTimeout(timer)
    try {
      q.close()
    } catch {
      /* already gone */
    }
  }

  private async pump(q: Query, gen: number): Promise<void> {
    let failure: unknown = null
    try {
      for await (const message of q) {
        if (gen !== this.generation) break
        try {
          this.handleMessage(message, q, gen)
        } catch {
          /* a derived-event bug must never stop the stream */
        }
      }
    } catch (err) {
      failure = err
    }
    if (gen !== this.generation || this.disposed) return
    this.onQueryEnded(failure)
  }

  private onQueryEnded(failure: unknown): void {
    this.q = null
    this.input?.close()
    this.input = null
    this.restartPending = false
    this.outstanding.clear()
    this.denyAllPending('The agent session ended.')
    this.flushStderr()
    if (failure && !isAbortError(failure)) {
      this.fail(failure, 'process')
    } else {
      this.setStatus('closed')
    }
  }

  private fail(err: unknown, fallback: AgentErrorKind): void {
    const message = errorMessage(err) || 'The agent failed unexpectedly.'
    const kind = classifyAgentError(message)
    this.lastError = message
    this.reportError(message, kind === 'unknown' ? fallback : kind)
    this.setStatus('error', message)
  }

  // ── internals: SDK messages ───────────────────────────────────────────────

  private handleMessage(message: SDKMessage, q: Query, gen: number): void {
    this.emit({ type: 'sdk', message: toIpcSafe(message) as SdkMessageLike })

    switch (message.type) {
      case 'system':
        this.handleSystem(message, q, gen)
        break
      case 'assistant':
        this.handleAssistant(message)
        break
      case 'result':
        this.handleResult(message, q, gen)
        break
      case 'rate_limit_event':
        if (message.rate_limit_info) this.emit({ type: 'rate-limit', info: mapRateLimit(message.rate_limit_info) })
        break
      case 'auth_status':
        if (message.error) {
          const kind = classifyAgentError(message.error)
          this.reportError(message.error, kind === 'unknown' ? 'auth' : kind)
        }
        break
      default:
        break
    }
  }

  private handleSystem(message: Extract<SDKMessage, { type: 'system' }>, q: Query, gen: number): void {
    switch (message.subtype) {
      case 'init': {
        if (message.session_id) this.sessionId = message.session_id
        this.forkPending = false
        const info: SessionInitInfo = {
          sessionId: message.session_id ?? '',
          model: message.model ?? '',
          cwd: message.cwd ?? this.workspace,
          tools: message.tools ?? [],
          slashCommands: message.slash_commands ?? [],
          skills: message.skills ?? [],
          agents: message.agents ?? [],
          plugins: (message.plugins ?? []).map((p) => ({ name: p.name, path: p.path })),
          mcpServers: (message.mcp_servers ?? []).map((s) => ({ name: s.name, status: s.status })),
          permissionMode: message.permissionMode ?? '',
          claudeCodeVersion: message.claude_code_version ?? '',
          apiKeySource: message.apiKeySource ?? ''
        }
        this.emit({ type: 'init', info })
        if (this.capabilitiesGeneration !== gen || !this.capabilities) {
          this.capabilitiesGeneration = gen
          void this.refreshCapabilities(q, gen)
        }
        break
      }
      case 'session_state_changed':
        if (message.state === 'running') this.setStatus(this.pending.size > 0 ? 'awaiting-input' : 'running')
        else if (message.state === 'requires_action') this.setStatus('awaiting-input')
        // A late `idle` from the previous turn must not mask a message sent since then.
        else if (message.state === 'idle' && this.isQuiescent()) this.setStatus('idle')
        break
      case 'commands_changed':
        if (Array.isArray(message.commands)) {
          const commands = mapCapabilities(message.commands, [], []).commands
          this.setCapabilities({ ...(this.capabilities ?? { models: [], agents: [] }), commands })
        }
        break
      default:
        break
    }
  }

  private handleAssistant(message: SDKAssistantMessage): void {
    if (!message.error || message.parent_tool_use_id || this.interruptRequested) return
    const content = isRecord(message.message) ? message.message.content : undefined
    const text = textFromContent(content).trim() || ASSISTANT_ERROR_TEXT[message.error] || `API error: ${message.error}`
    this.reportError(text, classifyAgentError(text, message.error))
  }

  private handleResult(message: SDKResultMessage, q: Query, gen: number): void {
    if (message.session_id) {
      this.sessionId = message.session_id
      // The fork (if any) happened: later restarts continue this session instead of forking again.
      this.forkPending = false
    }
    const aborted =
      this.interruptRequested || message.terminal_reason === 'aborted_streaming' || message.terminal_reason === 'aborted_tools'

    if (message.subtype !== 'success') {
      if (!aborted) {
        const errors = Array.isArray(message.errors) ? message.errors.filter((e) => typeof e === 'string' && e.trim()) : []
        const text = errors.join('\n') || RESULT_ERROR_TEXT[message.subtype] || `The turn ended with an error (${message.subtype}).`
        this.reportError(text, classifyAgentError(text))
      }
    } else if (message.is_error && !aborted) {
      const text = (typeof message.result === 'string' && message.result.trim()) || 'The turn ended with an API error.'
      this.reportError(text, classifyAgentError(text, null, message.api_error_status ?? null))
    }

    this.interruptRequested = false
    this.markAnswered(message)
    if (this.isQuiescent()) this.setStatus('idle')
    void this.refreshContextUsage(q, gen)
  }

  /** Retire the sends a result answers (precisely via user_message_uuids when the CLI reports them). */
  private markAnswered(message: SDKResultMessage): void {
    const answered = Array.isArray(message.user_message_uuids)
      ? message.user_message_uuids
      : message.user_message_uuid
        ? [message.user_message_uuid]
        : null
    if (answered && answered.length > 0) {
      for (const uuid of answered) this.outstanding.delete(uuid)
    } else if ((message.queued_turn_count ?? 0) === 0) {
      this.outstanding.clear()
    } else {
      const oldest = this.outstanding.values().next()
      if (!oldest.done) this.outstanding.delete(oldest.value)
    }
  }

  /** No turn running or queued and no prompt waiting for the user. */
  private isQuiescent(): boolean {
    return this.outstanding.size === 0 && this.pending.size === 0
  }

  private reportError(message: string, kind: AgentErrorKind): void {
    const text = message.trim() || 'Unknown error'
    const key = `${kind}\u0000${text}`
    // The same failure often arrives twice (assistant error + result); report it once per turn.
    if (this.turnErrors.has(key)) return
    this.turnErrors.add(key)
    this.lastError = text
    this.emit({ type: 'error', message: text, kind })
  }

  private refreshCapabilities(q: Query, gen: number): Promise<void> {
    return (async () => {
      try {
        const [commands, models, agents] = await Promise.all([q.supportedCommands(), q.supportedModels(), q.supportedAgents()])
        if (!this.isCurrent(q, gen)) return
        this.setCapabilities(mapCapabilities(commands, models, agents))
      } catch {
        /* keep the previous capabilities */
      }
    })()
  }

  private setCapabilities(capabilities: AgentCapabilities): void {
    this.capabilities = capabilities
    this.emit({ type: 'capabilities', capabilities })
  }

  private refreshContextUsage(q: Query, gen: number): Promise<void> {
    if (this.contextUsageInFlight) return this.contextUsageInFlight
    const run = (async () => {
      try {
        const res = await q.getContextUsage({ detail: 'summary' })
        if (!this.isCurrent(q, gen)) return
        const usage = mapContextUsage(res)
        if (usage) {
          this.contextUsage = usage
          this.emit({ type: 'context-usage', usage })
        }
      } catch {
        /* context usage is best effort */
      } finally {
        this.contextUsageInFlight = null
      }
    })()
    this.contextUsageInFlight = run
    return run
  }

  // ── internals: permissions ────────────────────────────────────────────────

  private readonly canUseTool: CanUseTool = (toolName, input, options) => {
    if (this.disposed) return Promise.resolve({ behavior: 'deny', message: 'The chat was closed.' })
    if (options.signal.aborted) return Promise.resolve({ behavior: 'deny', message: 'The request was cancelled.' })

    const requestId = randomUUID()
    const kind: PermissionRequest['kind'] =
      toolName === 'ExitPlanMode' ? 'plan' : toolName === 'AskUserQuestion' ? 'question' : 'tool'
    const suggestions = Array.isArray(options.suggestions) ? options.suggestions : []
    const request: PermissionRequest = {
      requestId,
      chatId: this.chatId,
      kind,
      toolName,
      input: (toIpcSafe(input) as Record<string, unknown> | undefined) ?? {},
      createdAt: Date.now()
    }
    if (options.toolUseID) request.toolUseId = options.toolUseID
    if (options.title) request.title = options.title
    if (options.displayName) request.displayName = options.displayName
    const reason = [options.decisionReason, options.description].filter((s): s is string => Boolean(s?.trim()))
    if (reason.length > 0) request.decisionReason = reason.join(' — ')
    if (options.blockedPath) request.blockedPath = options.blockedPath
    if (suggestions.length > 0) request.suggestions = toIpcSafe(suggestions) as unknown[]

    return new Promise<PermissionResult>((resolvePermission) => {
      const onAbort = (): void => {
        this.settlePermission(requestId, { behavior: 'deny', message: 'The request was cancelled.' })
      }
      this.pending.set(requestId, {
        request,
        input,
        suggestions,
        suppressAlways: options.suppressAlwaysAllowRule === true,
        settle: (result) => {
          options.signal.removeEventListener('abort', onAbort)
          resolvePermission(result)
        }
      })
      options.signal.addEventListener('abort', onAbort, { once: true })
      this.emit({ type: 'permission-request', request })
      this.setStatus('awaiting-input')
    })
  }

  private settlePermission(requestId: string, result: PermissionResult): boolean {
    const pending = this.pending.get(requestId)
    if (!pending) return false
    this.pending.delete(requestId)
    pending.settle(result)
    this.emit({ type: 'permission-resolved', requestId, behavior: result.behavior })
    if (this.pending.size === 0 && this.status === 'awaiting-input' && this.q) this.setStatus('running')
    return true
  }

  private denyAllPending(message: string, interrupt = false): void {
    for (const requestId of [...this.pending.keys()]) {
      this.settlePermission(requestId, { behavior: 'deny', message, ...(interrupt ? { interrupt: true } : {}) })
    }
  }

  /** Plan approved: leave plan mode with the chosen policy and switch the chat to the build mode. */
  private async applyPlanApproval(next: PermissionPolicy): Promise<void> {
    const settings = settingsService.get()
    const current = this.currentMode()
    this.permission = next
    if (current.forcedPermissionMode === 'plan') {
      const preferred = findMode(settings.agent.defaultModeId, settings.customModes)
      this.modeId = preferred.forcedPermissionMode === 'plan' ? DEFAULT_MODE_ID : preferred.id
    }
    // Set the mode right away; the PostToolUse hook re-applies it once ExitPlanMode has run,
    // because the tool itself restores the pre-plan mode when it executes.
    await this.applyLivePermission(next)
    this.emitModeChanged()
    this.onSettingsChanged()
  }

  /** Apply a permission policy to the running query (plan if the mode forces it). */
  private async applyLivePermission(policy: PermissionPolicy, mode: AgentModeDefinition = this.currentMode()): Promise<void> {
    const q = this.q
    if (!q) return
    let target: PermissionMode = resolvePermissionMode(mode, policy)
    if (target === 'bypassPermissions' && !this.bypassAllowed) {
      // The CLI only allows bypass when launched with it: use the closest mode now, restart when idle.
      target = 'acceptEdits'
      this.scheduleRestart()
    }
    await this.control(() => q.setPermissionMode(target), 'change the permission mode')
  }

  private emitModeChanged(): void {
    const mode = this.currentMode()
    this.emit({
      type: 'mode-changed',
      modeId: mode.id,
      permission: mode.forcedPermissionMode === 'plan' ? 'plan' : this.permission
    })
  }

  private buildHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const fileChanged: HookCallback = async (input) => {
      if (input.hook_event_name === 'PostToolUse') {
        const path = editedPath(input.tool_input, input.cwd || this.workspace)
        if (path) this.emit({ type: 'file-changed', path, tool: input.tool_name })
      }
      return { continue: true }
    }
    const planExited: HookCallback = async (input) => {
      if (input.hook_event_name === 'PostToolUse' && this.planExitPermission) {
        const next = this.planExitPermission
        this.planExitPermission = null
        // Defer: never issue a control request while the CLI awaits this hook.
        setTimeout(() => {
          void this.applyLivePermission(next).catch(() => undefined)
        }, 0)
      }
      return { continue: true }
    }
    return {
      PostToolUse: [
        { matcher: FILE_EDIT_TOOLS.join('|'), hooks: [fileChanged] },
        { matcher: 'ExitPlanMode', hooks: [planExited] }
      ]
    }
  }

  // ── internals: misc ───────────────────────────────────────────────────────

  /** Run a control request, turning failures into clear errors. */
  private async control<T>(fn: () => Promise<T>, action: string): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      throw new Error(`Could not ${action}: ${errorMessage(err)}`)
    }
  }

  private setStatus(status: AgentRunStatus, detail?: string): void {
    if (this.status === status && detail === undefined) return
    this.status = status
    this.emit(detail === undefined ? { type: 'status', status } : { type: 'status', status, detail })
    if (status === 'idle' && this.restartPending && !this.disposed) void this.restart()
  }

  private emit(event: AgentEvent): void {
    try {
      this.deps.emit(event)
    } catch {
      /* the window is gone or the payload could not be delivered */
    }
  }

  private readonly onStderr = (data: string): void => {
    if (typeof data !== 'string' || !data) return
    this.stderrBuffer += data
    if (this.stderrBuffer.length > STDERR_MAX_BUFFER) this.stderrBuffer = this.stderrBuffer.slice(-STDERR_MAX_BUFFER)
    if (this.stderrTimer) return
    const wait = Math.max(0, STDERR_FLUSH_INTERVAL_MS - (Date.now() - this.lastStderrFlush))
    this.stderrTimer = setTimeout(() => this.flushStderr(), wait)
  }

  private flushStderr(): void {
    if (this.stderrTimer) {
      clearTimeout(this.stderrTimer)
      this.stderrTimer = null
    }
    if (!this.stderrBuffer) return
    const data = this.stderrBuffer
    this.stderrBuffer = ''
    this.lastStderrFlush = Date.now()
    this.emit({ type: 'stderr', data })
  }
}
