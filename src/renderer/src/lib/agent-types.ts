/**
 * ATOM Code — renderer chat model for the agent panel.
 *
 * The main process forwards every Claude Agent SDK message plus a few ATOM events (`AgentEvent` in
 * `@shared/types`). `lib/agent-reducer.ts` folds those events into the `ChatState` below, and
 * `stores/agent.ts` keeps one `ChatState` per chat tab. UI components only read these types.
 *
 * Shape overview
 * ──────────────
 *   ChatState.items: TranscriptItem[]  (chronological)
 *     ├─ UserItem        a prompt the user sent (optimistic until the CLI accepts it)
 *     ├─ AssistantItem   ONE API message (`message.id`). A turn with tool use produces several
 *     │                  consecutive AssistantItems — render consecutive ones as one visual turn.
 *     │    blocks: AssistantBlock[] = TextBlock | ThinkingBlock | ToolCall (in stream order)
 *     │      ToolCall.children: AssistantBlock[]  subagent transcript (Agent/Task tool), recursive
 *     ├─ NoticeItem      compaction divider, API retry banner, errors, mode switches, /command output …
 *     └─ ResultItem      turn footer: duration, turns, cost, tokens, error text
 *
 * Every object is treated as immutable: the reducer returns new objects along the changed path, so
 * React components can rely on reference equality (`memo`) for blocks and items.
 *
 * Helpers for UI code (lib/agent-reducer.ts): `isRunning(chat)`, `isToolActive(tool)`,
 * `pendingRequestForTool(chat, toolUseId)` (→ show "awaiting approval" on a running tool card),
 * `findToolCall`, `walkToolCalls`, `todoProgress(todos)`, `flattenToolResultContent`, `parsePartialJson`.
 * Store + hooks (stores/agent.ts): `useAgentStore`, `useActiveChat`, `useChat`, `useAvailableModels`,
 * `useAgentModes`, `useActiveMode`, `useRunningChatCount`, `useAwaitingChatCount`.
 */
import type {
  AgentCapabilities,
  AgentRunStatus,
  ContextAttachment,
  ContextUsageInfo,
  EffortLevel,
  ImageAttachment,
  PermissionPolicy,
  PermissionRequest,
  RateLimitInfo,
  SessionInitInfo
} from '@shared/types'

export type { AgentRunStatus, ContextAttachment, ImageAttachment, PermissionPolicy, PermissionRequest, EffortLevel }

/** Title of a chat that has not been named yet (defined in the reducer, which must stay type-import only). */
export { DEFAULT_CHAT_TITLE } from './agent-reducer'

// ─────────────────────────────────────────────────────────────────────────────
// Assistant content blocks
// ─────────────────────────────────────────────────────────────────────────────

export interface TextBlock {
  kind: 'text'
  /** Stable id (React key): `<messageId>:<index>` for streamed blocks. */
  id: string
  /** API message id (`msg_…`) this block belongs to. */
  messageId?: string
  /** SDK message uuid of the complete `assistant` frame that confirmed this block (used for retractions). */
  uuid?: string
  /** Markdown text (grows while streaming). */
  text: string
  /** True while `text_delta`s are still arriving. */
  streaming: boolean
  /** True once the complete `assistant` message confirmed the block (internal reconciliation flag). */
  final?: boolean
}

export interface ThinkingBlock {
  kind: 'thinking'
  id: string
  messageId?: string
  uuid?: string
  /** Thinking text (summarized thinking). Empty when thinking display is omitted or redacted. */
  text: string
  streaming: boolean
  /** Redacted thinking (encrypted, nothing to show). */
  redacted?: boolean
  /** Unix ms — used for "Thought for Ns". */
  startedAt: number
  endedAt?: number
  final?: boolean
}

/**
 * Lifecycle of a tool call:
 *  - `streaming`: the model is still generating the input JSON (`inputJson` grows, `input` is a lenient parse)
 *  - `running`: input complete; waiting for permission or executing (check `pendingRequests` for a prompt)
 *  - `success` / `error`: a `tool_result` arrived
 *  - `denied`: the user (or a rule / classifier) rejected it
 *  - `interrupted`: the turn ended (interrupt, crash, error) before a result arrived
 */
export type ToolCallStatus = 'streaming' | 'running' | 'success' | 'error' | 'denied' | 'interrupted'

/** Live info about a subagent / background task started by this tool call (from `task_*` SDK messages). */
export interface SubagentInfo {
  taskId?: string
  /** e.g. "general-purpose", "atom:code-reviewer". */
  subagentType?: string
  description?: string
  /** Latest one-line progress summary (agentProgressSummaries) or the final summary. */
  summary?: string
  /**
   * `running` while the task works (also for background agents whose tool call already returned
   * `async_launched`), then `completed` / `failed` / `stopped`.
   */
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'paused'
  lastToolName?: string
  totalTokens?: number
  toolUses?: number
  durationMs?: number
  /** True when the task runs in the background (the tool call returns before the task ends). */
  backgrounded?: boolean
  error?: string
}

export interface ToolCall {
  kind: 'tool'
  /** The `tool_use_id`. */
  id: string
  messageId?: string
  uuid?: string
  /** Tool name: "Bash", "Edit", "Agent", "mcp__atom-ide__get_diagnostics", … */
  name: string
  /** Parsed input. While streaming this is a lenient parse of the partial JSON (may be incomplete). */
  input: Record<string, unknown>
  /** Raw (partial) input JSON accumulated from `input_json_delta`s. */
  inputJson: string
  status: ToolCallStatus
  /** Flattened tool_result content (text blocks joined; images noted as "[image]"). */
  result?: { text: string; isError: boolean }
  /** `tool_use_result` — the tool's structured Output object (see sdk-tools.d.ts *Output types). */
  structured?: unknown
  /** `tool_use_id` of the Agent/Task tool whose subagent made this call, null for the main thread. */
  parentToolUseId: string | null
  startedAt: number
  endedAt?: number
  /** From `tool_progress` heartbeats. */
  elapsedSeconds?: number
  /** Subagent transcript (messages whose `parent_tool_use_id` is this call's id). */
  children: AssistantBlock[]
  subagent?: SubagentInfo
}

export type AssistantBlock = TextBlock | ThinkingBlock | ToolCall

// ─────────────────────────────────────────────────────────────────────────────
// Transcript items
// ─────────────────────────────────────────────────────────────────────────────

export interface UserItem {
  kind: 'user'
  /** Same as `uuid`. */
  id: string
  /** Client uuid sent with the message — the checkpoint id for `rewind()`. */
  uuid: string
  text: string
  attachments: ContextAttachment[]
  imageCount: number
  /** Small `data:` URLs for image previews (may be filled asynchronously). */
  thumbnails: string[]
  /** Files can be restored to the state before this message (file checkpointing enabled). */
  checkpoint: boolean
  /** Optimistic: not yet accepted by the CLI (`user-sent` clears it). */
  pending: boolean
  /** Sent while a turn was running; waiting to be folded into / run after the current turn. */
  queued: boolean
  /**
   * Typed while a turn was running and kept by ATOM (not sent to the CLI yet) until that turn ends, so Stop can
   * withdraw it. Held messages always trail the transcript; they are also `queued`.
   */
  held?: boolean
  /** Sending failed with this error. */
  failed?: string
  /** Loaded from session history rather than sent in this app session. */
  fromHistory?: boolean
  createdAt: number
}

export interface AssistantItem {
  kind: 'assistant'
  /** API message id (`msg_…`). */
  id: string
  model?: string
  blocks: AssistantBlock[]
  /** API stop reason once known (`end_turn`, `tool_use`, `max_tokens`, `refusal`, …). */
  stopReason?: string | null
  /** SDK assistant error code (`rate_limit`, `authentication_failed`, `billing_error`, …). */
  error?: string
  /** The response was cut short by an interrupt. */
  aborted?: boolean
  createdAt: number
}

export type NoticeVariant = 'compact' | 'retry' | 'info' | 'error' | 'interrupted' | 'mode' | 'command-output'

export interface NoticeItem {
  kind: 'notice'
  id: string
  variant: NoticeVariant
  /** One-line, human readable text. */
  text: string
  /** Optional longer text (command output, error details) — render as preformatted/markdown. */
  detail?: string
  /** info: `detail` is Markdown written by ATOM itself (e.g. /help) and renders formatted. */
  detailMarkdown?: boolean
  createdAt: number
  // variant specific (all optional):
  /** compact: what triggered it and the token counts. */
  compactTrigger?: 'manual' | 'auto'
  preTokens?: number
  postTokens?: number
  /** retry: attempt counters (repeated retries collapse into one notice). */
  attempt?: number
  maxRetries?: number
  retryDelayMs?: number
  errorStatus?: number | null
  /** error: classification from the `error` event. */
  errorKind?: 'auth' | 'rate-limit' | 'process' | 'usage-limit' | 'unknown'
  /** mode: the new mode / permission (resolve the display name with `findMode`). */
  modeId?: string
  permission?: PermissionPolicy | 'plan'
}

export interface ResultItem {
  kind: 'result'
  id: string
  /** SDK result subtype: success | error_during_execution | error_max_turns | error_max_budget_usd | … */
  subtype: string
  durationMs: number
  durationApiMs: number
  numTurns: number
  /** Cost of this turn (difference of the cumulative totals). */
  costUsd: number
  /** Cumulative session cost after this turn. */
  totalCostUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  isError: boolean
  /** The turn was interrupted / aborted. */
  interrupted: boolean
  stopReason: string | null
  terminalReason?: string
  /** Error text for failed turns (API error, max turns, budget, …). */
  errorText?: string
  /** Tool calls auto-denied during the turn. */
  permissionDenials: number
  createdAt: number
}

export type TranscriptItem = UserItem | AssistantItem | NoticeItem | ResultItem

// ─────────────────────────────────────────────────────────────────────────────
// Todos (TodoWrite full lists, TaskCreate/TaskUpdate incremental tasks)
// ─────────────────────────────────────────────────────────────────────────────

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  /** Present continuous label shown while in progress ("Running tests"). */
  activeForm?: string
  /** Task id (TaskCreate/TaskUpdate). */
  id?: string
  /** tool_use_id of the TaskCreate call that created it (internal, makes replays idempotent). */
  sourceToolUseId?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat
// ─────────────────────────────────────────────────────────────────────────────

export interface ComposerState {
  text: string
  attachments: ContextAttachment[]
  images: ImageAttachment[]
}

/** Per parent (`''` = main thread, else the parent tool_use_id) cursor of the message being streamed. Internal. */
export interface StreamCursor {
  messageId: string
  model?: string
  /** content block index → block id */
  blocks: Record<number, string>
}

export interface ChatError {
  message: string
  kind: 'auth' | 'rate-limit' | 'process' | 'usage-limit' | 'unknown'
}

export interface ChatState {
  /** Renderer-generated chat id (also the main-process session key). */
  id: string
  title: string
  /** True once the user renamed the chat (the first prompt no longer sets the title). */
  titleEdited: boolean
  /** Absolute workspace path ('' when created before a folder was opened). */
  workspace: string
  /** SDK session id (from init, or the session being resumed). */
  sessionId: string | null
  /** Session to resume when the CLI is started lazily on first send. */
  resumeSessionId?: string
  /** True once `atom.agent.createChat` succeeded for this chat. */
  started: boolean
  status: AgentRunStatus
  modeId: string
  permission: PermissionPolicy
  /** '' = Claude Code default model. */
  model: string
  effort: EffortLevel | 'auto'
  /** Live SDK permission mode ("default", "plan", "acceptEdits", …) as reported by the CLI. */
  sdkPermissionMode: string | null

  items: TranscriptItem[]
  pendingRequests: PermissionRequest[]
  /** Latest todo list (null until the agent writes one). */
  todos: TodoItem[] | null
  /** Absolute paths the agent edited in this chat (most recent last, unique). */
  editedFiles: string[]

  contextUsage: ContextUsageInfo | null
  capabilities: AgentCapabilities | null
  init: SessionInitInfo | null
  composer: ComposerState
  /** Messages sent while a turn was running that have not started yet. */
  queuedCount: number
  totalCostUsd: number
  rateLimit: RateLimitInfo | null
  error: ChatError | null
  /** Predicted next prompt (prompt suggestions). */
  suggestion: string | null
  /** Context compaction in progress. */
  compacting: boolean
  /** Unix ms when the current turn started (for a live "Working… 12s" timer); null when idle. */
  turnStartedAt: number | null

  historyLoaded: boolean
  historyLoading: boolean
  /** Last ~8 KB of the CLI's stderr (diagnostics). */
  stderrTail: string

  /** Internal: streaming cursors, keyed by parent tool_use_id ('' = main thread). */
  streams: Record<string, StreamCursor>
  /** Internal: id counter for locally generated item ids. */
  seq: number

  createdAt: number
  updatedAt: number
}

export interface CreateChatStateInit {
  id: string
  workspace?: string
  modeId: string
  permission: PermissionPolicy
  model: string
  effort: EffortLevel | 'auto'
  title?: string
  titleEdited?: boolean
  sessionId?: string | null
  resumeSessionId?: string
  now?: number
}
