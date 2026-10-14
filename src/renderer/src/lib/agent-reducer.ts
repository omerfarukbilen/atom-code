/**
 * ATOM Code — pure reducer that turns agent events into the renderer chat model (`lib/agent-types.ts`).
 *
 * IMPORTANT: this module must only use `import type` imports. It is unit-tested directly with
 * `node --test --experimental-strip-types`, which cannot resolve extensionless runtime imports.
 *
 * Event sources (see `AgentEvent` in @shared/types):
 *  - raw SDK messages (`{type:'sdk'}`): stream_event deltas, complete assistant frames (one per content block,
 *    sharing `message.id`), user frames carrying tool_result blocks, result, system/* notices, task_*, …
 *  - ATOM events: status, init, capabilities, permission-request/resolved, user-sent, context-usage, …
 *
 * Reconciliation rules (streamed blocks vs. complete `assistant` frames):
 *  - tool_use blocks are matched by tool_use_id anywhere in the transcript;
 *  - text / thinking blocks are matched by API message id + order: a complete block confirms the first
 *    not-yet-confirmed block of the same kind in that message, otherwise it is appended — text is never duplicated.
 *  - frames with `parent_tool_use_id` belong to a subagent and are routed into that Agent/Task tool's `children`.
 */
import type {
  AgentEvent,
  AgentRunStatus,
  ContextAttachment,
  PermissionPolicy,
  PermissionRequest,
  RateLimitInfo,
  SessionInitInfo,
  SlashCommandInfo,
  StoredSessionMessage
} from '@shared/types'
import type {
  AssistantBlock,
  AssistantItem,
  ChatState,
  CreateChatStateInit,
  NoticeItem,
  ResultItem,
  StreamCursor,
  SubagentInfo,
  TextBlock,
  ThinkingBlock,
  TodoItem,
  ToolCall,
  ToolCallStatus,
  TranscriptItem,
  UserItem
} from './agent-types'

export const DEFAULT_CHAT_TITLE = 'New chat'

const STDERR_TAIL_MAX = 8000
const MAX_HISTORY_THUMBNAIL_CHARS = 400_000

// ─────────────────────────────────────────────────────────────────────────────
// Narrowing helpers for untyped SDK payloads
// ─────────────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function strings(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === 'string')
}

interface Ctx {
  now: number
  /** Converting stored session history: user prompts come from the transcript instead of the composer. */
  history: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Construction
// ─────────────────────────────────────────────────────────────────────────────

export function createChatState(init: CreateChatStateInit): ChatState {
  const now = init.now ?? Date.now()
  const sessionId = init.sessionId ?? init.resumeSessionId ?? null
  return {
    id: init.id,
    title: init.title?.trim() || DEFAULT_CHAT_TITLE,
    titleEdited: init.titleEdited ?? false,
    workspace: init.workspace ?? '',
    sessionId,
    resumeSessionId: init.resumeSessionId,
    started: false,
    status: 'idle',
    modeId: init.modeId,
    permission: init.permission,
    model: init.model,
    effort: init.effort,
    sdkPermissionMode: null,
    items: [],
    pendingRequests: [],
    todos: null,
    editedFiles: [],
    contextUsage: null,
    capabilities: null,
    init: null,
    composer: { text: '', attachments: [], images: [] },
    queuedCount: 0,
    totalCostUsd: 0,
    rateLimit: null,
    error: null,
    suggestion: null,
    compacting: false,
    turnStartedAt: null,
    historyLoaded: !sessionId,
    historyLoading: false,
    stderrTail: '',
    streams: {},
    seq: 0,
    createdAt: now,
    updatedAt: now
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public helpers
// ─────────────────────────────────────────────────────────────────────────────

/** True while a turn is starting, running or blocked on the user. */
export function isRunning(chat: Pick<ChatState, 'status'>): boolean {
  return chat.status === 'running' || chat.status === 'starting' || chat.status === 'awaiting-input'
}

export function isAwaitingInput(chat: Pick<ChatState, 'status' | 'pendingRequests'>): boolean {
  return chat.status === 'awaiting-input' || chat.pendingRequests.length > 0
}

/** A tool call that still shows activity: running, or its (background) subagent is still working. */
export function isToolActive(tool: ToolCall): boolean {
  return tool.status === 'running' || tool.status === 'streaming' || tool.subagent?.status === 'running'
}

/** The pending permission / plan / question request for a tool call, if any. */
export function pendingRequestForTool(chat: Pick<ChatState, 'pendingRequests'>, toolUseId: string): PermissionRequest | undefined {
  return chat.pendingRequests.find((r) => r.toolUseId === toolUseId)
}

function findToolInBlocks(blocks: AssistantBlock[], pred: (t: ToolCall) => boolean): ToolCall | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    if (b.kind !== 'tool') continue
    if (pred(b)) return b
    if (b.children.length) {
      const found = findToolInBlocks(b.children, pred)
      if (found) return found
    }
  }
  return undefined
}

function findToolWhere(items: TranscriptItem[], pred: (t: ToolCall) => boolean): ToolCall | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind !== 'assistant') continue
    const found = findToolInBlocks(it.blocks, pred)
    if (found) return found
  }
  return undefined
}

/** Find a tool call by tool_use_id anywhere in the transcript, including subagent children. */
export function findToolCall(source: ChatState | TranscriptItem[], toolUseId: string): ToolCall | undefined {
  const items = Array.isArray(source) ? source : source.items
  return findToolWhere(items, (t) => t.id === toolUseId)
}

/** Visit every tool call (depth-first, transcript order). */
export function walkToolCalls(items: TranscriptItem[], visit: (tool: ToolCall, depth: number) => void): void {
  const walk = (blocks: AssistantBlock[], depth: number): void => {
    for (const b of blocks) {
      if (b.kind !== 'tool') continue
      visit(b, depth)
      if (b.children.length) walk(b.children, depth + 1)
    }
  }
  for (const it of items) if (it.kind === 'assistant') walk(it.blocks, 0)
}

export function todoProgress(todos: TodoItem[] | null): { total: number; completed: number; current: TodoItem | null } {
  const list = todos ?? []
  return {
    total: list.length,
    completed: list.filter((t) => t.status === 'completed').length,
    current: list.find((t) => t.status === 'in_progress') ?? null
  }
}

/** Chat title derived from a prompt (first line, collapsed whitespace, ≤ max chars). */
export function titleFromPrompt(text: string, max = 40): string {
  const line = text.replace(/<atom_context>[\s\S]*?<\/atom_context>/g, '').trim().split('\n')[0] ?? ''
  const clean = line.replace(/\s+/g, ' ').trim()
  if (!clean) return DEFAULT_CHAT_TITLE
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean
}

/** Remove the IDE context block ATOM prepends to prompts (for displaying stored prompts). */
export function stripAtomContext(text: string): string {
  return text.replace(/<atom_context>[\s\S]*?<\/atom_context>\s*/g, '').trim()
}

/** Flatten tool_result content (string or content blocks) into display text. */
export function flattenToolResultContent(content: unknown): string {
  let text = ''
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    text = content
      .map((c) => {
        if (!isObj(c)) return ''
        if (c.type === 'text') return str(c.text) ?? ''
        if (c.type === 'image') return '[image]'
        if (c.type === 'document') return '[document]'
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  const m = /^\s*<tool_use_error>([\s\S]*?)<\/tool_use_error>\s*$/.exec(text)
  return m ? m[1].trim() : text
}

/**
 * Lenient JSON parse for partial tool input (`input_json_delta` accumulation): closes open strings and
 * brackets and drops dangling keys / partial literals. Returns undefined when nothing sensible parses.
 */
export function parsePartialJson(src: string): unknown {
  const s = src.trim()
  if (!s) return undefined
  try {
    return JSON.parse(s)
  } catch {
    // fall through to repair
  }
  let t = s
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = completeJson(t)
    if (candidate !== null) {
      try {
        return JSON.parse(candidate)
      } catch {
        // strip one more dangling token below
      }
    }
    const stripped = stripDangling(t)
    if (stripped === t || !stripped) return undefined
    t = stripped
  }
  return undefined
}

function completeJson(t: string): string | null {
  let inStr = false
  let esc = false
  const stack: string[] = []
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return null
    }
  }
  let out = t
  if (inStr) {
    if (esc) out = out.slice(0, -1)
    // a dangling unicode escape (\u12) cannot be closed
    out = out.replace(/\\u[0-9a-fA-F]{0,3}$/, '')
    out += '"'
  }
  out = out.replace(/[\s,]+$/, '')
  return out + stack.reverse().join('')
}

function stripDangling(t: string): string {
  const trimmed = t.replace(/\s+$/, '')
  if (/[,:]$/.test(trimmed)) return trimmed.slice(0, -1)
  // dangling `"key":` or `"key": partial` inside an object
  const keyVal = /[{,]\s*"(?:[^"\\]|\\.)*"\s*:\s*[^,{}[\]"]*$/.exec(trimmed)
  if (keyVal) return trimmed.slice(0, keyVal.index + 1)
  // dangling `"key"` (or open string) right after `{` or `,`
  const key = /[{,]\s*"(?:[^"\\]|\\.)*"?$/.exec(trimmed)
  if (key) return trimmed.slice(0, key.index + 1)
  // partial literal / number at the end of an array
  const lit = /[[,]\s*[-\w.+]+$/.exec(trimmed)
  if (lit) return trimmed.slice(0, lit.index + 1)
  return trimmed.slice(0, -1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Immutable update helpers
// ─────────────────────────────────────────────────────────────────────────────

function updateToolInBlocks(
  blocks: AssistantBlock[],
  id: string,
  fn: (t: ToolCall) => ToolCall
): AssistantBlock[] | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    if (b.kind !== 'tool') continue
    if (b.id === id) {
      const nb = fn(b)
      if (nb === b) return blocks
      const copy = blocks.slice()
      copy[i] = nb
      return copy
    }
    if (b.children.length) {
      const nc = updateToolInBlocks(b.children, id, fn)
      if (nc) {
        if (nc === b.children) return blocks
        const copy = blocks.slice()
        copy[i] = { ...b, children: nc }
        return copy
      }
    }
  }
  return null
}

/** Update a tool call (deep) by id. Returns the same chat when not found / unchanged. */
function updateTool(chat: ChatState, id: string, fn: (t: ToolCall) => ToolCall): ChatState {
  const items = chat.items
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind !== 'assistant') continue
    const nb = updateToolInBlocks(it.blocks, id, fn)
    if (nb) {
      if (nb === it.blocks) return chat
      const copy = items.slice()
      copy[i] = { ...it, blocks: nb }
      return { ...chat, items: copy }
    }
  }
  return chat
}

function mapItems(chat: ChatState, fn: (it: TranscriptItem) => TranscriptItem): ChatState {
  let changed = false
  const items = chat.items.map((it) => {
    const n = fn(it)
    if (n !== it) changed = true
    return n
  })
  return changed ? { ...chat, items } : chat
}

/** Locally generated item id, unique per chat (history conversion uses its own chat id, so ids never collide). */
function nextId(chat: ChatState, prefix: string): [string, ChatState] {
  const seq = chat.seq + 1
  return [`${prefix}-${chat.id.slice(0, 8)}-${seq}`, { ...chat, seq }]
}

function lastItem(chat: ChatState): TranscriptItem | undefined {
  return chat.items[chat.items.length - 1]
}

/** Retry banners are transient: drop a trailing one as soon as real content arrives. */
function dropTrailingRetry(chat: ChatState): ChatState {
  const last = lastItem(chat)
  if (last?.kind === 'notice' && last.variant === 'retry') return { ...chat, items: chat.items.slice(0, -1) }
  return chat
}

type NoticeInit = Omit<NoticeItem, 'kind' | 'id' | 'createdAt'>

/** Append a notice to the transcript (pure). */
export function addNotice(chat: ChatState, notice: NoticeInit, now: number = Date.now()): ChatState {
  const [id, next] = nextId(chat, 'notice')
  const item: NoticeItem = { kind: 'notice', id, createdAt: now, ...notice }
  return { ...next, items: [...next.items, item], updatedAt: now }
}

/** Replace the trailing notice of the same variant, or append a new one. */
function upsertTrailingNotice(chat: ChatState, notice: NoticeInit, now: number): ChatState {
  const last = lastItem(chat)
  if (last?.kind === 'notice' && last.variant === notice.variant) {
    const items = chat.items.slice(0, -1)
    items.push({ ...last, ...notice, createdAt: last.createdAt })
    return { ...chat, items }
  }
  return addNotice(chat, notice, now)
}

export interface NewUserMessage {
  uuid: string
  text: string
  attachments?: ContextAttachment[]
  imageCount?: number
  thumbnails?: string[]
  checkpoint?: boolean
  /** Sent while a turn is running. */
  queued?: boolean
  pending?: boolean
  fromHistory?: boolean
}

/** Append a user prompt to the transcript (used optimistically by the store). Clears the prompt suggestion. */
export function addUserMessage(chat: ChatState, msg: NewUserMessage, now: number = Date.now()): ChatState {
  if (chat.items.some((i) => i.kind === 'user' && i.uuid === msg.uuid)) return chat
  const item: UserItem = {
    kind: 'user',
    id: msg.uuid,
    uuid: msg.uuid,
    text: msg.text,
    attachments: msg.attachments ?? [],
    imageCount: msg.imageCount ?? msg.thumbnails?.length ?? 0,
    thumbnails: msg.thumbnails ?? [],
    checkpoint: msg.checkpoint ?? false,
    pending: msg.pending ?? true,
    queued: msg.queued ?? false,
    fromHistory: msg.fromHistory || undefined,
    createdAt: now
  }
  return { ...chat, items: [...chat.items, item], suggestion: null, updatedAt: now }
}

/** Patch a user item by uuid (thumbnails ready, send failed, …). */
export function patchUserItem(chat: ChatState, uuid: string, patch: Partial<Omit<UserItem, 'kind' | 'id' | 'uuid'>>): ChatState {
  return mapItems(chat, (it) => (it.kind === 'user' && it.uuid === uuid ? { ...it, ...patch } : it))
}

function markUserConsumed(chat: ChatState, uuids: string[]): ChatState {
  if (!uuids.length) return chat
  const set = new Set(uuids)
  let consumed = 0
  const next = mapItems(chat, (it) => {
    if (it.kind === 'user' && set.has(it.uuid) && (it.queued || it.pending)) {
      if (it.queued) consumed++
      return { ...it, queued: false, pending: false }
    }
    return it
  })
  return consumed ? { ...next, queuedCount: Math.max(0, next.queuedCount - consumed) } : next
}

function clearQueuedFlags(chat: ChatState): ChatState {
  return mapItems(chat, (it) => (it.kind === 'user' && it.queued ? { ...it, queued: false } : it))
}

/** Stop streaming text/thinking and mark running tools interrupted (optionally sparing background subagents). */
function interruptBlocks(blocks: AssistantBlock[], now: number, includeBackground: boolean): AssistantBlock[] {
  let changed = false
  const out = blocks.map((b): AssistantBlock => {
    if (b.kind === 'text') {
      if (!b.streaming) return b
      changed = true
      return { ...b, streaming: false }
    }
    if (b.kind === 'thinking') {
      if (!b.streaming) return b
      changed = true
      return { ...b, streaming: false, endedAt: b.endedAt ?? now }
    }
    let t: ToolCall = b
    const backgroundRunning = !!t.subagent?.backgrounded && t.subagent.status === 'running'
    if (t.children.length && (includeBackground || !backgroundRunning)) {
      const c = interruptBlocks(t.children, now, includeBackground)
      if (c !== t.children) t = { ...t, children: c }
    }
    if (t.status === 'running' || t.status === 'streaming') {
      if (includeBackground || !backgroundRunning) t = { ...t, status: 'interrupted', endedAt: now }
    }
    if (includeBackground && t.subagent && (t.subagent.status === 'running' || t.subagent.status === 'pending')) {
      t = { ...t, subagent: { ...t.subagent, status: 'stopped' } }
    }
    if (t !== b) changed = true
    return t
  })
  return changed ? out : blocks
}

function interruptRunning(chat: ChatState, now: number, includeBackground: boolean): ChatState {
  return mapItems(chat, (it) => {
    if (it.kind !== 'assistant') return it
    const blocks = interruptBlocks(it.blocks, now, includeBackground)
    return blocks === it.blocks ? it : { ...it, blocks }
  })
}

/** A subagent that finished (or the Agent tool that returned its report) has no live steps left. */
function settleSubagentChildren(t: ToolCall, now: number): ToolCall {
  if (!t.children.length) return t
  const children = interruptBlocks(t.children, now, true)
  return children === t.children ? t : { ...t, children }
}

const TERMINAL_SUBAGENT_STATUSES = new Set<SubagentInfo['status']>(['completed', 'failed', 'stopped'])

/**
 * An API retry restarts the request: blocks streamed for the failed attempt that no complete `assistant`
 * frame confirmed would otherwise stay next to the retried copy (duplicated text). Drop them.
 */
function dropUnconfirmedStream(chat: ChatState): ChatState {
  const cursor = chat.streams['']
  if (!cursor) return chat
  const streams = { ...chat.streams }
  delete streams['']
  const next: ChatState = { ...chat, streams }
  const idx = next.items.findIndex((it) => it.kind === 'assistant' && it.id === cursor.messageId)
  if (idx === -1) return next
  const item = next.items[idx] as AssistantItem
  const streamed = new Set(Object.values(cursor.blocks))
  const awaiting = new Set(next.pendingRequests.map((r) => r.toolUseId).filter((id): id is string => !!id))
  const blocks = item.blocks.filter((b) => {
    if (!streamed.has(b.id)) return true
    if (b.kind === 'tool') return !!b.uuid || b.result !== undefined || awaiting.has(b.id)
    return !!b.final
  })
  if (blocks.length === item.blocks.length && blocks.length > 0) return next
  const items = next.items.slice()
  if (blocks.length) items[idx] = { ...item, blocks }
  else items.splice(idx, 1)
  return { ...next, items }
}

/** Stop streaming on main-thread blocks only (end of a turn). */
function finalizeRootStreaming(chat: ChatState, now: number): ChatState {
  const next = mapItems(chat, (it) => {
    if (it.kind !== 'assistant') return it
    let changed = false
    const blocks = it.blocks.map((b): AssistantBlock => {
      if ((b.kind === 'text' || b.kind === 'thinking') && b.streaming) {
        changed = true
        return b.kind === 'thinking' ? { ...b, streaming: false, endedAt: b.endedAt ?? now } : { ...b, streaming: false }
      }
      if (b.kind === 'tool' && b.status === 'streaming') {
        changed = true
        return finishToolInput(b)
      }
      return b
    })
    return changed ? { ...it, blocks } : it
  })
  if (!next.streams['']) return next
  const streams = { ...next.streams }
  delete streams['']
  return { ...next, streams }
}

// ─────────────────────────────────────────────────────────────────────────────
// Containers: main thread items vs. subagent children
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply `fn` to the block list that holds message `messageId`:
 *  - main thread (parent null): the AssistantItem with that id (created when missing);
 *  - subagent (parent = Agent tool id): that tool call's `children` (blocks of several messages).
 */
function withContainer(
  chat: ChatState,
  parent: string | null,
  messageId: string,
  model: string | undefined,
  ctx: Ctx,
  fn: (blocks: AssistantBlock[]) => AssistantBlock[],
  itemPatch?: Partial<AssistantItem>
): ChatState {
  if (parent) {
    return updateTool(chat, parent, (t) => {
      const children = fn(t.children)
      return children === t.children ? t : { ...t, children }
    })
  }
  let next = chat
  let idx = -1
  for (let i = next.items.length - 1; i >= 0; i--) {
    const it = next.items[i]
    if (it.kind === 'assistant' && it.id === messageId) {
      idx = i
      break
    }
  }
  if (idx === -1) {
    next = dropTrailingRetry(next)
    const item: AssistantItem = { kind: 'assistant', id: messageId, model, blocks: [], createdAt: ctx.now }
    next = { ...next, items: [...next.items, item] }
    idx = next.items.length - 1
  }
  const item = next.items[idx] as AssistantItem
  const blocks = fn(item.blocks)
  const patch = itemPatch ? pruneUndefined(itemPatch) : null
  if (blocks === item.blocks && !patch && next === chat) return chat
  const updated: AssistantItem = { ...item, ...(patch ?? {}), blocks, model: item.model ?? model }
  const items = next.items.slice()
  items[idx] = updated
  return { ...next, items }
}

function pruneUndefined<T extends object>(o: T): Partial<T> | null {
  const out: Partial<T> = {}
  let any = false
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) {
      ;(out as Record<string, unknown>)[k] = v
      any = true
    }
  }
  return any ? out : null
}

function updateBlockById(blocks: AssistantBlock[], id: string, fn: (b: AssistantBlock) => AssistantBlock): AssistantBlock[] {
  const idx = blocks.findIndex((b) => b.id === id)
  if (idx === -1) return blocks
  const nb = fn(blocks[idx])
  if (nb === blocks[idx]) return blocks
  const copy = blocks.slice()
  copy[idx] = nb
  return copy
}

function finishToolInput(t: ToolCall): ToolCall {
  let input = t.input
  if (t.inputJson) {
    const parsed = parsePartialJson(t.inputJson)
    if (isObj(parsed)) input = parsed
  }
  return { ...t, input, status: t.status === 'streaming' ? 'running' : t.status }
}

// ─────────────────────────────────────────────────────────────────────────────
// stream_event
// ─────────────────────────────────────────────────────────────────────────────

function reduceStreamEvent(chat: ChatState, msg: Obj, ctx: Ctx): ChatState {
  const ev = msg.event
  if (!isObj(ev)) return chat
  const parent = str(msg.parent_tool_use_id) ?? null
  const key = parent ?? ''
  const cursor: StreamCursor | undefined = chat.streams[key]

  switch (str(ev.type)) {
    case 'message_start': {
      const m = isObj(ev.message) ? ev.message : {}
      let base = chat
      let messageId = str(m.id) ?? str(msg.uuid)
      if (!messageId) [messageId, base] = nextId(chat, 'msg')
      const model = str(m.model)
      let next: ChatState = { ...base, streams: { ...chat.streams, [key]: { messageId, model, blocks: {} } } }
      next = withContainer(next, parent, messageId, model, ctx, (b) => b)
      if (!parent) next = markUserConsumed(next, consumedUuids(msg))
      return next
    }

    case 'content_block_start': {
      if (!cursor) return chat
      const index = num(ev.index) ?? 0
      const cb = isObj(ev.content_block) ? ev.content_block : null
      if (!cb) return chat
      const block = blockFromStart(cb, cursor.messageId, index, parent, ctx.now)
      if (!block) return chat
      const streams = { ...chat.streams, [key]: { ...cursor, blocks: { ...cursor.blocks, [index]: block.id } } }
      if (block.kind === 'tool' && findToolCall(chat.items, block.id)) return { ...chat, streams }
      const next = withContainer(chat, parent, cursor.messageId, cursor.model, ctx, (blocks) =>
        blocks.some((b) => b.id === block.id) ? blocks : [...blocks, block]
      )
      return { ...next, streams }
    }

    case 'content_block_delta': {
      if (!cursor) return chat
      const index = num(ev.index) ?? 0
      const id = cursor.blocks[index]
      const delta = isObj(ev.delta) ? ev.delta : null
      if (!id || !delta) return chat
      const dt = str(delta.type)
      if (dt === 'text_delta') {
        const text = str(delta.text) ?? ''
        if (!text) return chat
        return withContainer(chat, parent, cursor.messageId, cursor.model, ctx, (blocks) =>
          updateBlockById(blocks, id, (b) => (b.kind === 'text' ? { ...b, text: b.text + text } : b))
        )
      }
      if (dt === 'thinking_delta') {
        const text = str(delta.thinking) ?? ''
        if (!text) return chat
        return withContainer(chat, parent, cursor.messageId, cursor.model, ctx, (blocks) =>
          updateBlockById(blocks, id, (b) => (b.kind === 'thinking' ? { ...b, text: b.text + text } : b))
        )
      }
      if (dt === 'input_json_delta') {
        const part = str(delta.partial_json) ?? ''
        if (!part) return chat
        return updateTool(chat, id, (t) => {
          if (t.status !== 'streaming') return t
          const prevLen = t.inputJson.length
          const inputJson = t.inputJson + part
          let input = t.input
          // Re-parse for a live preview, but bounded: every delta while small, then every ~3 KB.
          if (inputJson.length < 6000 || Math.floor(prevLen / 3000) !== Math.floor(inputJson.length / 3000)) {
            const parsed = parsePartialJson(inputJson)
            if (isObj(parsed)) input = parsed
          }
          return { ...t, inputJson, input }
        })
      }
      return chat
    }

    case 'content_block_stop': {
      if (!cursor) return chat
      const index = num(ev.index) ?? 0
      const id = cursor.blocks[index]
      if (!id) return chat
      let next = withContainer(chat, parent, cursor.messageId, cursor.model, ctx, (blocks) =>
        updateBlockById(blocks, id, (b) => {
          if (b.kind === 'text') return b.streaming ? { ...b, streaming: false } : b
          if (b.kind === 'thinking') return b.streaming ? { ...b, streaming: false, endedAt: b.endedAt ?? ctx.now } : b
          return b
        })
      )
      const tool = findToolCall(next.items, id)
      if (tool && tool.status === 'streaming') {
        next = updateTool(next, id, finishToolInput)
        const finished = findToolCall(next.items, id)
        if (finished) next = applyToolInputSideEffects(next, finished)
      }
      return next
    }

    case 'message_delta': {
      if (!cursor || parent) return chat
      const d = isObj(ev.delta) ? ev.delta : {}
      const stopReason = str(d.stop_reason)
      if (!stopReason) return chat
      return withContainer(chat, null, cursor.messageId, cursor.model, ctx, (b) => b, { stopReason })
    }

    case 'message_stop': {
      if (!cursor) return chat
      const ids = new Set(Object.values(cursor.blocks))
      let next = withContainer(chat, parent, cursor.messageId, cursor.model, ctx, (blocks) => {
        let changed = false
        const out = blocks.map((b): AssistantBlock => {
          if (!ids.has(b.id)) return b
          if ((b.kind === 'text' || b.kind === 'thinking') && b.streaming) {
            changed = true
            return b.kind === 'thinking' ? { ...b, streaming: false, endedAt: b.endedAt ?? ctx.now } : { ...b, streaming: false }
          }
          return b
        })
        return changed ? out : blocks
      })
      for (const id of ids) {
        const t = findToolCall(next.items, id)
        if (t && t.status === 'streaming') {
          next = updateTool(next, id, finishToolInput)
          const finished = findToolCall(next.items, id)
          if (finished) next = applyToolInputSideEffects(next, finished)
        }
      }
      const streams = { ...next.streams }
      delete streams[key]
      return { ...next, streams }
    }

    default:
      return chat
  }
}

function consumedUuids(msg: Obj): string[] {
  const list = strings(msg.user_message_uuids)
  const one = str(msg.user_message_uuid)
  if (one && !list.includes(one)) list.push(one)
  return list
}

function blockFromStart(cb: Obj, messageId: string, index: number, parent: string | null, now: number): AssistantBlock | null {
  const type = str(cb.type)
  const id = `${messageId}:${index}`
  if (type === 'text') {
    const block: TextBlock = { kind: 'text', id, messageId, text: str(cb.text) ?? '', streaming: true }
    return block
  }
  if (type === 'thinking' || type === 'redacted_thinking') {
    const block: ThinkingBlock = {
      kind: 'thinking',
      id,
      messageId,
      text: str(cb.thinking) ?? '',
      streaming: true,
      redacted: type === 'redacted_thinking' || undefined,
      startedAt: now
    }
    return block
  }
  if (type === 'tool_use' || type === 'server_tool_use' || type === 'mcp_tool_use') {
    const toolId = str(cb.id)
    if (!toolId) return null
    const input = isObj(cb.input) ? cb.input : {}
    return newToolCall(toolId, toolName(cb), input, parent, messageId, now, 'streaming')
  }
  return null
}

function toolName(cb: Obj): string {
  const name = str(cb.name) ?? 'tool'
  if (cb.type === 'mcp_tool_use') {
    const server = str(cb.server_name)
    if (server) return `mcp__${server}__${name}`
  }
  return name
}

function newToolCall(
  id: string,
  name: string,
  input: Obj,
  parent: string | null,
  messageId: string | undefined,
  now: number,
  status: ToolCallStatus
): ToolCall {
  return {
    kind: 'tool',
    id,
    messageId,
    name,
    input,
    inputJson: '',
    status,
    parentToolUseId: parent,
    startedAt: now,
    children: []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Complete assistant frames
// ─────────────────────────────────────────────────────────────────────────────

function reduceAssistantMessage(chat: ChatState, msg: Obj, ctx: Ctx): ChatState {
  const m = isObj(msg.message) ? msg.message : null
  if (!m) return chat
  const parent = str(msg.parent_tool_use_id) ?? null
  const uuid = str(msg.uuid)
  let next = chat

  const supersedes = strings(msg.supersedes)
  if (supersedes.length) next = retractUuids(next, supersedes)

  const [fallbackId, withSeq] = nextId(next, 'msg')
  const messageId = str(m.id) ?? uuid ?? fallbackId
  if (!str(m.id) && !uuid) next = withSeq
  const model = str(m.model)
  const content: unknown[] = Array.isArray(m.content)
    ? m.content
    : typeof m.content === 'string'
      ? [{ type: 'text', text: m.content }]
      : []

  const toolIds: string[] = []
  // Tool calls already present elsewhere (should not happen) are not duplicated.
  const knownTools = new Set<string>()
  for (const cb of content) {
    if (isObj(cb) && (cb.type === 'tool_use' || cb.type === 'server_tool_use' || cb.type === 'mcp_tool_use')) {
      const id = str(cb.id)
      if (!id) continue
      toolIds.push(id)
      if (findToolCall(next.items, id)) knownTools.add(id)
    }
  }

  const stopReason = str(m.stop_reason)
  next = withContainer(
    next,
    parent,
    messageId,
    model,
    ctx,
    (blocks) => {
      let out = blocks
      content.forEach((cb, i) => {
        if (isObj(cb)) out = mergeCompleteBlock(out, cb, { messageId, uuid, index: i, parent, now: ctx.now, knownTools })
      })
      return out
    },
    parent
      ? undefined
      : {
          stopReason: stopReason ?? undefined,
          error: str(msg.error),
          aborted: msg.aborted === true ? true : undefined
        }
  )

  // Tools known from the stream but living in another container: finalize them in place.
  for (const id of knownTools) {
    const cb = content.find((c) => isObj(c) && c.id === id)
    if (!isObj(cb)) continue
    next = updateTool(next, id, (t) => finalizeToolFromBlock(t, cb, messageId, uuid))
  }

  for (const id of toolIds) {
    const t = findToolCall(next.items, id)
    if (t) next = applyToolInputSideEffects(next, t)
  }

  if (!parent) {
    next = dropTrailingRetry(next)
    next = markUserConsumed(next, consumedUuids(msg))
  }
  return next
}

interface MergeInfo {
  messageId: string
  uuid?: string
  index: number
  parent: string | null
  now: number
  knownTools: Set<string>
}

function uniqueBlockId(blocks: AssistantBlock[], base: string): string {
  let id = base
  let n = 1
  while (blocks.some((b) => b.id === id)) id = `${base}~${n++}`
  return id
}

function finalizeToolFromBlock(t: ToolCall, cb: Obj, messageId: string, uuid: string | undefined): ToolCall {
  const input = isObj(cb.input) && Object.keys(cb.input).length ? cb.input : t.input
  return {
    ...t,
    name: toolName(cb) || t.name,
    input,
    inputJson: t.inputJson || JSON.stringify(input),
    messageId: t.messageId ?? messageId,
    uuid: uuid ?? t.uuid,
    status: t.status === 'streaming' ? 'running' : t.status
  }
}

function mergeCompleteBlock(blocks: AssistantBlock[], cb: Obj, info: MergeInfo): AssistantBlock[] {
  const type = str(cb.type)

  if (type === 'text' || type === 'thinking' || type === 'redacted_thinking') {
    const kind = type === 'text' ? 'text' : 'thinking'
    const text = type === 'text' ? (str(cb.text) ?? '') : type === 'thinking' ? (str(cb.thinking) ?? '') : ''
    const idx = blocks.findIndex((b) => b.kind === kind && b.messageId === info.messageId && !b.final)
    if (idx >= 0) {
      const b = blocks[idx] as TextBlock | ThinkingBlock
      const copy = blocks.slice()
      if (b.kind === 'text') copy[idx] = { ...b, text: text || b.text, streaming: false, final: true, uuid: info.uuid }
      else copy[idx] = { ...b, text: text || b.text, streaming: false, final: true, uuid: info.uuid, endedAt: b.endedAt ?? info.now }
      return copy
    }
    // Exact replay of a block we already confirmed: never duplicate text.
    if (text && blocks.some((b) => b.kind === kind && b.messageId === info.messageId && b.text === text)) return blocks
    if (kind === 'text' && !text.trim()) return blocks
    const id = uniqueBlockId(blocks, `${info.uuid ?? info.messageId}:${info.index}`)
    if (kind === 'text') {
      const block: TextBlock = { kind: 'text', id, messageId: info.messageId, uuid: info.uuid, text, streaming: false, final: true }
      return [...blocks, block]
    }
    const block: ThinkingBlock = {
      kind: 'thinking',
      id,
      messageId: info.messageId,
      uuid: info.uuid,
      text,
      streaming: false,
      final: true,
      redacted: type === 'redacted_thinking' || undefined,
      startedAt: info.now,
      endedAt: info.now
    }
    return [...blocks, block]
  }

  if (type === 'tool_use' || type === 'server_tool_use' || type === 'mcp_tool_use') {
    const id = str(cb.id)
    if (!id) return blocks
    const idx = blocks.findIndex((b) => b.kind === 'tool' && b.id === id)
    if (idx >= 0) {
      const copy = blocks.slice()
      copy[idx] = finalizeToolFromBlock(blocks[idx] as ToolCall, cb, info.messageId, info.uuid)
      return copy
    }
    if (info.knownTools.has(id)) return blocks
    const input = isObj(cb.input) ? cb.input : {}
    const tool = newToolCall(id, toolName(cb), input, info.parent, info.messageId, info.now, 'running')
    return [...blocks, { ...tool, uuid: info.uuid, inputJson: JSON.stringify(input) }]
  }

  // Server-side tool results (web search / fetch run by the API) complete their server_tool_use block.
  if (type && type.endsWith('_tool_result')) {
    const id = str(cb.tool_use_id)
    if (!id) return blocks
    const isError = isObj(cb.content) && typeof cb.content.error_code === 'string'
    return (
      updateToolInBlocks(blocks, id, (t) => ({
        ...t,
        status: isError ? 'error' : 'success',
        result: { text: isError ? String((cb.content as Obj).error_code) : '', isError },
        structured: cb.content,
        endedAt: info.now
      })) ?? blocks
    )
  }

  return blocks
}

/** Remove blocks delivered by the given SDK message uuids (refusal fallback retractions / supersedes). */
function retractUuids(chat: ChatState, uuids: string[]): ChatState {
  const set = new Set(uuids)
  const prune = (blocks: AssistantBlock[]): AssistantBlock[] => {
    let changed = false
    const out: AssistantBlock[] = []
    for (const b of blocks) {
      if (b.uuid && set.has(b.uuid)) {
        changed = true
        continue
      }
      if (b.kind === 'tool' && b.children.length) {
        const c = prune(b.children)
        if (c !== b.children) {
          changed = true
          out.push({ ...b, children: c })
          continue
        }
      }
      out.push(b)
    }
    return changed ? out : blocks
  }
  let changed = false
  const items: TranscriptItem[] = []
  for (const it of chat.items) {
    if (it.kind === 'user' && set.has(it.uuid)) {
      changed = true
      continue
    }
    if (it.kind !== 'assistant') {
      items.push(it)
      continue
    }
    const blocks = prune(it.blocks)
    if (blocks === it.blocks) {
      items.push(it)
      continue
    }
    changed = true
    if (blocks.length) items.push({ ...it, blocks })
  }
  return changed ? { ...chat, items } : chat
}

// ─────────────────────────────────────────────────────────────────────────────
// User frames (tool results, CLI-side prompts)
// ─────────────────────────────────────────────────────────────────────────────

const INTERRUPT_RE = /^\[Request interrupted by user/i
const DENIED_RE =
  /doesn't want to proceed|does not want to proceed|tool use was rejected|user (has )?(rejected|denied|declined)|declined this action|permission (was )?denied/i

function errorStatusFor(text: string): ToolCallStatus {
  if (/interrupted by user/i.test(text)) return 'interrupted'
  if (DENIED_RE.test(text)) return 'denied'
  return 'error'
}

function reduceUserMessage(chat: ChatState, msg: Obj, ctx: Ctx): ChatState {
  const m = isObj(msg.message) ? msg.message : null
  if (!m) return chat
  const parent = str(msg.parent_tool_use_id) ?? null
  const blocks: unknown[] = Array.isArray(m.content)
    ? m.content
    : typeof m.content === 'string'
      ? [{ type: 'text', text: m.content }]
      : []

  const toolResults = blocks.filter((b): b is Obj => isObj(b) && b.type === 'tool_result')
  let next = chat
  for (const tr of toolResults) {
    next = applyToolResult(next, tr, toolResults.length === 1 ? msg.tool_use_result : undefined, ctx)
  }

  // Subagent prompts and nested text are not shown as user messages.
  if (parent) return next

  const texts = blocks
    .filter((b): b is Obj => isObj(b) && b.type === 'text')
    .map((b) => str(b.text) ?? '')
    .filter((t) => t.length > 0)
  const images = blocks.filter((b): b is Obj => isObj(b) && b.type === 'image')
  if (!texts.length && !images.length) return next

  const uuid = str(msg.uuid)
  if (uuid && next.items.some((i) => i.kind === 'user' && i.uuid === uuid)) {
    return patchUserItem(next, uuid, { pending: false })
  }

  const text = texts.join('\n')
  const cls = classifyUserText(text)
  const synthetic = msg.isSynthetic === true

  switch (cls.kind) {
    case 'interrupted': {
      const last = lastItem(next)
      if (last?.kind === 'notice' && last.variant === 'interrupted') return next
      return addNotice(next, { variant: 'interrupted', text: 'Interrupted by user' }, ctx.now)
    }
    case 'command-output':
      return cls.text.trim()
        ? addNotice(next, { variant: 'command-output', text: 'Command output', detail: cls.text }, ctx.now)
        : next
    case 'compact-summary': {
      if (!ctx.history) return next
      const last = lastItem(next)
      if (last?.kind === 'notice' && last.variant === 'compact') return next
      return addNotice(next, { variant: 'compact', text: 'Conversation compacted', detail: cls.text }, ctx.now)
    }
    case 'command': {
      if (!ctx.history) return next
      const [genId, withSeq] = nextId(next, 'user')
      return addUserMessage(
        uuid ? next : withSeq,
        { uuid: uuid ?? genId, text: cls.text, pending: false, checkpoint: !!uuid, fromHistory: true },
        ctx.now
      )
    }
    case 'meta':
      return next
    case 'prompt': {
      // Live: our own prompts are added optimistically; other CLI-side text (skill bodies, reminders) is hidden
      // unless it is an explicit replay of a real user message.
      if (synthetic) return next
      if (!ctx.history && msg.isReplay !== true) return next
      const thumbnails = images
        .map((img) => {
          const src = isObj(img.source) ? img.source : null
          const data = src ? str(src.data) : undefined
          const mediaType = src ? str(src.media_type) : undefined
          return data && mediaType && data.length <= MAX_HISTORY_THUMBNAIL_CHARS ? `data:${mediaType};base64,${data}` : ''
        })
        .filter(Boolean)
      const [genId, withSeq] = nextId(next, 'user')
      return addUserMessage(
        uuid ? next : withSeq,
        {
          uuid: uuid ?? genId,
          text: cls.text,
          imageCount: images.length,
          thumbnails,
          checkpoint: !!uuid,
          pending: false,
          fromHistory: ctx.history || undefined
        },
        ctx.now
      )
    }
  }
}

type UserTextClass =
  | { kind: 'interrupted' }
  | { kind: 'command-output'; text: string }
  | { kind: 'command'; text: string }
  | { kind: 'compact-summary'; text: string }
  | { kind: 'meta' }
  | { kind: 'prompt'; text: string }

function classifyUserText(raw: string): UserTextClass {
  const text = raw.trim()
  if (INTERRUPT_RE.test(text)) return { kind: 'interrupted' }
  const out = /<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>/g
  if (out.test(text)) {
    out.lastIndex = 0
    const parts: string[] = []
    for (let mm = out.exec(text); mm; mm = out.exec(text)) parts.push(mm[2])
    return { kind: 'command-output', text: parts.join('\n').trim() }
  }
  const cmd = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)
  if (cmd) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? ''
    const name = cmd[1].trim()
    return { kind: 'command', text: (name.startsWith('/') ? name : '/' + name) + (args ? ' ' + args : '') }
  }
  if (/^This session is being continued from a previous conversation/i.test(text)) return { kind: 'compact-summary', text }
  if (text.startsWith('Caveat: ') || text.startsWith('<command-message>') || text.startsWith('Base directory for this skill')) {
    return { kind: 'meta' }
  }
  const prompt = stripAtomContext(text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ''))
  if (!prompt) return { kind: 'meta' }
  return { kind: 'prompt', text: prompt }
}

function applyToolResult(chat: ChatState, tr: Obj, structured: unknown, ctx: Ctx): ChatState {
  const id = str(tr.tool_use_id)
  if (!id) return chat
  const isError = tr.is_error === true
  const text = flattenToolResultContent(tr.content)
  const status: ToolCallStatus = isError ? errorStatusFor(text) : 'success'
  const next = updateTool(chat, id, (t) => {
    let tool: ToolCall = t.status === 'streaming' ? finishToolInput(t) : t
    tool = {
      ...tool,
      status: tool.status === 'denied' ? 'denied' : status,
      result: { text, isError },
      structured: structured !== undefined ? structured : tool.structured,
      endedAt: tool.endedAt ?? ctx.now
    }
    tool = withSubagentFromResult(tool)
    // A foreground subagent's report ends its run: steps still marked running lost their results.
    const backgroundRunning = !!tool.subagent?.backgrounded && tool.subagent.status === 'running'
    return backgroundRunning ? tool : settleSubagentChildren(tool, ctx.now)
  })
  if (next === chat) return chat
  const tool = findToolCall(next.items, id)
  return tool ? applyToolResultSideEffects(next, tool) : next
}

/** Agent/Task tool results: a backgrounded launch keeps the subagent running; a completed report ends it. */
function withSubagentFromResult(t: ToolCall): ToolCall {
  if (!isObj(t.structured)) return t
  const s = t.structured
  const status = str(s.status)
  if (status === 'async_launched' || status === 'remote_launched') {
    return {
      ...t,
      subagent: {
        ...t.subagent,
        taskId: t.subagent?.taskId ?? str(s.agentId) ?? str(s.taskId),
        description: t.subagent?.description ?? str(s.description),
        status: t.subagent?.status && t.subagent.status !== 'pending' ? t.subagent.status : 'running',
        backgrounded: true
      }
    }
  }
  if (status === 'completed' && (t.name === 'Agent' || t.name === 'Task')) {
    return {
      ...t,
      subagent: {
        ...t.subagent,
        subagentType: t.subagent?.subagentType ?? str(s.agentType),
        status: 'completed',
        totalTokens: num(s.totalTokens) ?? t.subagent?.totalTokens,
        toolUses: num(s.totalToolUseCount) ?? t.subagent?.toolUses,
        durationMs: num(s.totalDurationMs) ?? t.subagent?.durationMs
      }
    }
  }
  return t
}

// ─────────────────────────────────────────────────────────────────────────────
// Todos (TodoWrite, TaskCreate, TaskUpdate, TaskList)
// ─────────────────────────────────────────────────────────────────────────────

function normTodoStatus(v: unknown): TodoItem['status'] {
  return v === 'in_progress' || v === 'completed' ? v : 'pending'
}

function parseTodoList(v: unknown): TodoItem[] | null {
  if (!Array.isArray(v)) return null
  return v
    .filter(isObj)
    .map((t): TodoItem => {
      const item: TodoItem = { content: str(t.content) ?? str(t.subject) ?? '', status: normTodoStatus(t.status) }
      const activeForm = str(t.activeForm)
      const id = str(t.id) ?? (typeof t.id === 'number' ? String(t.id) : undefined)
      if (activeForm) item.activeForm = activeForm
      if (id) item.id = id
      return item
    })
    .filter((t) => t.content.length > 0)
}

/** Side effects of a tool call whose input is complete (main thread only). Idempotent. */
function applyToolInputSideEffects(chat: ChatState, tool: ToolCall): ChatState {
  if (tool.parentToolUseId) return chat
  const input = tool.input
  switch (tool.name) {
    case 'TodoWrite': {
      const todos = parseTodoList(input.todos)
      return todos ? { ...chat, todos } : chat
    }
    case 'TaskCreate': {
      const subject = str(input.subject)
      if (!subject) return chat
      const list = chat.todos ?? []
      const activeForm = str(input.activeForm)
      const idx = list.findIndex((t) => t.sourceToolUseId === tool.id)
      if (idx >= 0) {
        const cur = list[idx]
        if (cur.content === subject && cur.activeForm === activeForm) return chat
        const copy = list.slice()
        copy[idx] = { ...cur, content: subject, activeForm }
        return { ...chat, todos: copy }
      }
      const item: TodoItem = { content: subject, status: 'pending', sourceToolUseId: tool.id }
      if (activeForm) item.activeForm = activeForm
      return { ...chat, todos: [...list, item] }
    }
    case 'TaskUpdate': {
      const taskId = str(input.taskId) ?? (typeof input.taskId === 'number' ? String(input.taskId) : undefined)
      if (!taskId || !chat.todos) return chat
      const idx = chat.todos.findIndex((t) => t.id === taskId)
      if (idx === -1) return chat
      if (input.status === 'deleted') return { ...chat, todos: chat.todos.filter((_, i) => i !== idx) }
      const cur = chat.todos[idx]
      const updated: TodoItem = {
        ...cur,
        content: str(input.subject) ?? cur.content,
        status: input.status !== undefined ? normTodoStatus(input.status) : cur.status
      }
      const activeForm = str(input.activeForm) ?? cur.activeForm
      if (activeForm) updated.activeForm = activeForm
      if (updated.content === cur.content && updated.status === cur.status && updated.activeForm === cur.activeForm) return chat
      const copy = chat.todos.slice()
      copy[idx] = updated
      return { ...chat, todos: copy }
    }
    default:
      return chat
  }
}

/** Side effects of a tool result (main thread only). */
function applyToolResultSideEffects(chat: ChatState, tool: ToolCall): ChatState {
  if (tool.parentToolUseId || tool.status !== 'success') return chat
  const s = isObj(tool.structured) ? tool.structured : null
  switch (tool.name) {
    case 'TodoWrite': {
      const todos = s ? parseTodoList(s.newTodos) : null
      return todos ? { ...chat, todos } : chat
    }
    case 'TaskCreate': {
      const task = s && isObj(s.task) ? s.task : null
      const taskId =
        (task && (str(task.id) ?? (typeof task.id === 'number' ? String(task.id) : undefined))) ??
        /#\s*([\w-]+)/.exec(tool.result?.text ?? '')?.[1]
      if (!taskId) return chat
      const withItem = applyToolInputSideEffects(chat, tool)
      const list = withItem.todos ?? []
      const idx = list.findIndex((t) => t.sourceToolUseId === tool.id)
      if (idx === -1 || list[idx].id === taskId) return withItem
      const copy = list.slice()
      copy[idx] = { ...list[idx], id: taskId }
      return { ...withItem, todos: copy }
    }
    case 'TaskList': {
      const tasks = s ? parseTodoList(s.tasks) : null
      if (!tasks) return chat
      const prev = chat.todos ?? []
      const merged = tasks.map((t) => {
        const old = prev.find((p) => p.id && p.id === t.id)
        return old?.activeForm && !t.activeForm ? { ...t, activeForm: old.activeForm } : t
      })
      return { ...chat, todos: merged }
    }
    default:
      return chat
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// result
// ─────────────────────────────────────────────────────────────────────────────

const RESULT_SUBTYPE_TEXT: Record<string, string> = {
  error_max_turns: 'Stopped: reached the maximum number of turns.',
  error_max_budget_usd: 'Stopped: reached the budget limit.',
  error_during_execution: 'The turn ended with an error.',
  error_max_structured_output_retries: 'Stopped: structured output retries exhausted.'
}

function reduceResult(chat: ChatState, msg: Obj, ctx: Ctx): ChatState {
  const subtype = str(msg.subtype) ?? 'success'
  const isError = msg.is_error === true || subtype !== 'success'
  const terminalReason = str(msg.terminal_reason)
  const errors = strings(msg.errors)
  const interrupted =
    (terminalReason?.startsWith('aborted') ?? false) ||
    (subtype === 'error_during_execution' && errors.some((e) => /interrupt|abort/i.test(e)))
  const usage = isObj(msg.usage) ? msg.usage : {}
  const total = num(msg.total_cost_usd) ?? chat.totalCostUsd
  const queued = num(msg.queued_turn_count) ?? 0

  let errorText: string | undefined
  if (isError && !interrupted) {
    errorText =
      subtype === 'success'
        ? str(msg.result) || 'The turn ended with an error.'
        : errors.join('\n') || RESULT_SUBTYPE_TEXT[subtype] || `The turn ended (${subtype}).`
  }

  // The error usually already shows as the synthetic assistant text ("API Error: …"): don't repeat it.
  if (errorText && textVisibleInTurn(chat, errorText)) errorText = undefined

  // The result is the turn-complete signal: every tool of the turn has its tool_result by now, so anything
  // still spinning (lost result, interrupt, error) is stale. Background subagents keep running.
  let next = interruptRunning(chat, ctx.now, false)
  next = finalizeRootStreaming(next, ctx.now)

  const [id, withSeq] = nextId(next, 'result')
  const item: ResultItem = {
    kind: 'result',
    id,
    subtype,
    durationMs: num(msg.duration_ms) ?? 0,
    durationApiMs: num(msg.duration_api_ms) ?? 0,
    numTurns: num(msg.num_turns) ?? 0,
    costUsd: Math.max(0, total - chat.totalCostUsd),
    totalCostUsd: total,
    inputTokens: num(usage.input_tokens) ?? 0,
    outputTokens: num(usage.output_tokens) ?? 0,
    cacheReadTokens: num(usage.cache_read_input_tokens) ?? 0,
    cacheCreationTokens: num(usage.cache_creation_input_tokens) ?? 0,
    isError,
    interrupted,
    stopReason: str(msg.stop_reason) ?? null,
    terminalReason,
    errorText,
    permissionDenials: arr(msg.permission_denials).length,
    createdAt: ctx.now
  }
  next = dropTrailingRetry(withSeq)
  const status: AgentRunStatus = queued > 0 ? 'running' : next.pendingRequests.length ? 'awaiting-input' : 'idle'
  next = {
    ...next,
    items: [...next.items, item],
    status,
    totalCostUsd: total,
    queuedCount: queued,
    turnStartedAt: queued > 0 ? ctx.now : null,
    compacting: false
  }
  if (queued === 0) next = clearQueuedFlags(next)
  return next
}

/** True when `text` is already visible in the current turn (assistant text, error notice or result footer). */
function textVisibleInTurn(chat: ChatState, text: string): boolean {
  const needle = text.trim()
  if (!needle) return true
  for (let i = chat.items.length - 1; i >= 0; i--) {
    const it = chat.items[i]
    if (it.kind === 'user') return false
    if (it.kind === 'notice' && it.variant === 'error' && it.text.trim() === needle) return true
    if (it.kind === 'result' && it.errorText?.trim() === needle) return true
    if (it.kind === 'assistant' && it.blocks.some((b) => b.kind === 'text' && b.text.trim() === needle)) return true
  }
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// system/* and other SDK messages
// ─────────────────────────────────────────────────────────────────────────────

function initFromSdk(msg: Obj): SessionInitInfo {
  return {
    sessionId: str(msg.session_id) ?? '',
    model: str(msg.model) ?? '',
    cwd: str(msg.cwd) ?? '',
    tools: strings(msg.tools),
    slashCommands: strings(msg.slash_commands),
    skills: strings(msg.skills),
    agents: strings(msg.agents),
    plugins: arr(msg.plugins)
      .filter(isObj)
      .map((p) => ({ name: str(p.name) ?? '', path: str(p.path) ?? '' })),
    mcpServers: arr(msg.mcp_servers)
      .filter(isObj)
      .map((s) => ({ name: str(s.name) ?? '', status: str(s.status) ?? '' })),
    permissionMode: str(msg.permissionMode) ?? '',
    claudeCodeVersion: str(msg.claude_code_version) ?? '',
    apiKeySource: str(msg.apiKeySource) ?? ''
  }
}

function subagentStatus(v: unknown): SubagentInfo['status'] | undefined {
  switch (v) {
    case 'pending':
    case 'running':
    case 'completed':
    case 'failed':
    case 'stopped':
    case 'paused':
      return v
    case 'killed':
      return 'stopped'
    default:
      return undefined
  }
}

/** Merge task info into the tool call that started the task (by tool_use_id, else by known task id). */
function patchTask(chat: ChatState, msg: Obj, now: number, patch: (prev: SubagentInfo) => SubagentInfo): ChatState {
  const taskId = str(msg.task_id)
  const toolUseId = str(msg.tool_use_id)
  let tool = toolUseId ? findToolCall(chat.items, toolUseId) : undefined
  if (!tool && taskId) tool = findToolWhere(chat.items, (t) => t.subagent?.taskId === taskId)
  if (!tool) return chat
  return updateTool(chat, tool.id, (t) => {
    const prev: SubagentInfo = { ...t.subagent, taskId: t.subagent?.taskId ?? taskId }
    const subagent = pruneUndefined(patch(prev)) ?? prev
    const next: ToolCall = { ...t, subagent }
    // A finished task has no live steps left (their spinners would otherwise never stop).
    return TERMINAL_SUBAGENT_STATUSES.has(subagent.status) ? settleSubagentChildren(next, now) : next
  })
}

function taskUsage(msg: Obj): Partial<SubagentInfo> {
  const u = isObj(msg.usage) ? msg.usage : null
  if (!u) return {}
  return { totalTokens: num(u.total_tokens), toolUses: num(u.tool_uses), durationMs: num(u.duration_ms) }
}

function withDefined(prev: SubagentInfo, patch: Partial<SubagentInfo>): SubagentInfo {
  return { ...prev, ...(pruneUndefined(patch) ?? {}) }
}

function reduceSystemMessage(chat: ChatState, msg: Obj, ctx: Ctx): ChatState {
  switch (str(msg.subtype)) {
    case 'init': {
      if (ctx.history) return chat
      const info = initFromSdk(msg)
      return {
        ...chat,
        sessionId: info.sessionId || chat.sessionId,
        started: true,
        sdkPermissionMode: info.permissionMode || chat.sdkPermissionMode,
        init: chat.init ? { ...chat.init, ...info } : info
      }
    }

    case 'compact_boundary': {
      const meta = isObj(msg.compact_metadata) ? msg.compact_metadata : {}
      const trigger = meta.trigger === 'auto' ? 'auto' : 'manual'
      const preTokens = num(meta.pre_tokens)
      const postTokens = num(meta.post_tokens)
      return addNotice(
        { ...chat, compacting: false },
        {
          variant: 'compact',
          text: trigger === 'auto' ? 'Context auto-compacted' : 'Conversation compacted',
          compactTrigger: trigger,
          preTokens,
          postTokens
        },
        ctx.now
      )
    }

    case 'api_retry': {
      if (ctx.history) return chat
      const attempt = num(msg.attempt) ?? 1
      const maxRetries = num(msg.max_retries)
      const delay = num(msg.retry_delay_ms) ?? 0
      const status = msg.error_status === null ? null : num(msg.error_status)
      const reason = str(msg.error) ?? 'error'
      const label = status ? `${reason} (${status})` : reason
      return upsertTrailingNotice(
        dropUnconfirmedStream(chat),
        {
          variant: 'retry',
          text: `API ${label.replace(/_/g, ' ')} — retrying in ${Math.max(1, Math.round(delay / 1000))}s (attempt ${attempt}${maxRetries ? `/${maxRetries}` : ''})`,
          attempt,
          maxRetries,
          retryDelayMs: delay,
          errorStatus: status ?? null
        },
        ctx.now
      )
    }

    case 'status': {
      if (ctx.history) return chat
      let next: ChatState = { ...chat, compacting: msg.status === 'compacting' }
      const mode = str(msg.permissionMode)
      if (mode) next.sdkPermissionMode = mode
      if (msg.compact_result === 'failed') {
        next = addNotice(
          next,
          { variant: 'error', text: 'Compaction failed', detail: str(msg.compact_error) },
          ctx.now
        )
      }
      return next
    }

    case 'session_state_changed': {
      if (ctx.history) return chat
      const state = str(msg.state)
      const blocked = chat.pendingRequests.length > 0
      const status: AgentRunStatus | null =
        state === 'running'
          ? blocked
            ? 'awaiting-input'
            : 'running'
          : state === 'requires_action'
            ? 'awaiting-input'
            : state === 'idle' && !blocked
              ? 'idle'
              : null
      return status ? setStatus(chat, status, ctx.now) : chat
    }

    case 'task_started':
      return patchTask(chat, msg, ctx.now, (prev) =>
        withDefined(prev, {
          description: str(msg.description),
          subagentType: str(msg.subagent_type),
          status: prev.status === 'completed' || prev.status === 'failed' ? prev.status : 'running',
          backgrounded: msg.is_backgrounded === true ? true : prev.backgrounded
        })
      )

    case 'task_progress':
      return patchTask(chat, msg, ctx.now, (prev) =>
        withDefined(prev, {
          description: str(msg.description),
          subagentType: str(msg.subagent_type),
          summary: str(msg.summary),
          lastToolName: str(msg.last_tool_name),
          status: prev.status === 'pending' || !prev.status ? 'running' : prev.status,
          ...taskUsage(msg)
        })
      )

    case 'task_notification':
      return patchTask(chat, msg, ctx.now, (prev) =>
        withDefined(prev, {
          status: subagentStatus(msg.status),
          summary: str(msg.summary),
          ...taskUsage(msg)
        })
      )

    case 'task_updated': {
      const p = isObj(msg.patch) ? msg.patch : {}
      return patchTask(chat, msg, ctx.now, (prev) =>
        withDefined(prev, {
          status: subagentStatus(p.status),
          description: str(p.description),
          error: str(p.error),
          backgrounded: typeof p.is_backgrounded === 'boolean' ? p.is_backgrounded : undefined
        })
      )
    }

    case 'permission_denied': {
      const id = str(msg.tool_use_id)
      if (!id) return chat
      const message = str(msg.message) ?? str(msg.decision_reason) ?? 'Permission denied'
      return updateTool(chat, id, (t) => ({
        ...(t.status === 'streaming' ? finishToolInput(t) : t),
        status: 'denied',
        result: t.result ?? { text: message, isError: true },
        endedAt: t.endedAt ?? ctx.now
      }))
    }

    case 'local_command_output': {
      const content = str(msg.content) ?? ''
      if (!content.trim()) return chat
      return addNotice(chat, { variant: 'command-output', text: 'Command output', detail: content }, ctx.now)
    }

    case 'informational': {
      if (ctx.history || msg.level === 'info') return chat
      const content = str(msg.content)
      if (!content) return chat
      return addNotice(chat, { variant: 'info', text: content }, ctx.now)
    }

    case 'model_refusal_fallback': {
      let next = retractUuids(chat, strings(msg.retracted_message_uuids))
      const content = str(msg.content)
      const fallback = str(msg.fallback_model)
      next = addNotice(
        next,
        { variant: 'info', text: content || `Retrying with ${fallback ?? 'a fallback model'}` },
        ctx.now
      )
      return next
    }

    case 'model_refusal_no_fallback': {
      const content = str(msg.content)
      return addNotice(chat, { variant: 'error', text: content || 'The model declined to respond.' }, ctx.now)
    }

    case 'commands_changed': {
      if (!chat.capabilities) return chat
      const commands: SlashCommandInfo[] = arr(msg.commands)
        .filter(isObj)
        .map((c) => ({
          name: str(c.name) ?? '',
          description: str(c.description) ?? '',
          argumentHint: str(c.argumentHint) ?? '',
          builtin: c.builtin === true || undefined
        }))
        .filter((c) => c.name)
      return { ...chat, capabilities: { ...chat.capabilities, commands } }
    }

    default:
      return chat
  }
}

function rateLimitFromSdk(info: Obj): RateLimitInfo {
  const resets = num(info.resetsAt)
  return {
    window: str(info.rateLimitType),
    status: str(info.status),
    resetsAt: resets === undefined ? undefined : resets < 1e12 ? resets * 1000 : resets,
    utilization: num(info.utilization),
    raw: info
  }
}

/** Fold one raw SDK message into the chat. */
function reduceSdkMessage(chat: ChatState, raw: unknown, ctx: Ctx): ChatState {
  if (!isObj(raw)) return chat
  switch (str(raw.type)) {
    case 'stream_event':
      return ctx.history ? chat : reduceStreamEvent(chat, raw, ctx)
    case 'assistant':
      return reduceAssistantMessage(chat, raw, ctx)
    case 'user':
      return reduceUserMessage(chat, raw, ctx)
    case 'result':
      return reduceResult(chat, raw, ctx)
    case 'system':
      return reduceSystemMessage(chat, raw, ctx)
    case 'tool_progress': {
      const id = str(raw.tool_use_id)
      const elapsed = num(raw.elapsed_time_seconds)
      if (!id || elapsed === undefined) return chat
      return updateTool(chat, id, (t) =>
        t.elapsedSeconds === elapsed && t.status !== 'streaming'
          ? t
          : { ...(t.status === 'streaming' ? finishToolInput(t) : t), elapsedSeconds: elapsed }
      )
    }
    case 'prompt_suggestion': {
      const s = str(raw.suggestion)?.trim()
      return s ? { ...chat, suggestion: s } : chat
    }
    case 'rate_limit_event':
      return isObj(raw.rate_limit_info) ? { ...chat, rateLimit: rateLimitFromSdk(raw.rate_limit_info) } : chat
    case 'conversation_reset': {
      if (ctx.history) return chat
      return addNotice({ ...chat, todos: null }, { variant: 'info', text: 'Conversation context was cleared' }, ctx.now)
    }
    default:
      return chat
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ATOM events
// ─────────────────────────────────────────────────────────────────────────────

function setStatus(chat: ChatState, status: AgentRunStatus, now: number): ChatState {
  if (status === 'error' || status === 'closed') {
    let next = interruptRunning(chat, now, true)
    next = clearQueuedFlags(next)
    return {
      ...next,
      status,
      streams: {},
      pendingRequests: [],
      turnStartedAt: null,
      compacting: false,
      queuedCount: 0
    }
  }
  if (status === chat.status) return chat
  if (status === 'running' || status === 'starting') return { ...chat, status, turnStartedAt: chat.turnStartedAt ?? now }
  if (status === 'idle') {
    // Main reports idle only when no turn is running or queued: unanswered tools are stale.
    const settled = chat.pendingRequests.length ? chat : interruptRunning(chat, now, false)
    return { ...finalizeRootStreaming(settled, now), status, turnStartedAt: null, compacting: false }
  }
  return { ...chat, status }
}

const PERMISSION_LABEL: Record<string, string> = {
  default: 'ask before changes',
  acceptEdits: 'auto-accept edits',
  auto: 'auto',
  bypassPermissions: 'full auto',
  plan: 'plan'
}

function modeChanged(chat: ChatState, modeId: string, permission: PermissionPolicy | 'plan', now: number): ChatState {
  let next: ChatState = {
    ...chat,
    modeId,
    permission: permission === 'plan' ? chat.permission : permission,
    sdkPermissionMode: permission
  }
  if (!next.items.length) return next
  const name = modeId ? modeId.charAt(0).toUpperCase() + modeId.slice(1) : 'Agent'
  next = upsertTrailingNotice(
    next,
    { variant: 'mode', text: `Switched to ${name} mode · ${PERMISSION_LABEL[permission] ?? permission}`, modeId, permission },
    now
  )
  return next
}

function resolvePermission(chat: ChatState, requestId: string, behavior: 'allow' | 'deny', now: number): ChatState {
  const req = chat.pendingRequests.find((r) => r.requestId === requestId)
  if (!req) return chat
  let next: ChatState = { ...chat, pendingRequests: chat.pendingRequests.filter((r) => r !== req) }
  if (behavior === 'deny' && req.toolUseId) {
    next = updateTool(next, req.toolUseId, (t) => ({ ...t, status: 'denied', endedAt: t.endedAt ?? now }))
  }
  if (!next.pendingRequests.length && next.status === 'awaiting-input') next = { ...next, status: 'running' }
  return next
}

/**
 * Undo an optimistic `permission-resolved` after the answer could not be delivered: show the prompt again and
 * revert the "denied" mark on its tool. No-op once the turn is over (the CLI has settled the request itself).
 */
export function reopenPermissionRequest(chat: ChatState, request: PermissionRequest): ChatState {
  if (chat.pendingRequests.some((r) => r.requestId === request.requestId)) return chat
  if (chat.status !== 'running' && chat.status !== 'awaiting-input') return chat
  let next: ChatState = { ...chat, pendingRequests: [...chat.pendingRequests, request], status: 'awaiting-input' }
  if (request.toolUseId) {
    next = updateTool(next, request.toolUseId, (t) => (t.status === 'denied' && !t.result ? { ...t, status: 'running', endedAt: undefined } : t))
  }
  return next
}

function touch(prev: ChatState, next: ChatState, now: number): ChatState {
  return next === prev || next.updatedAt === now ? next : { ...next, updatedAt: now }
}

/**
 * Fold one agent event into a chat (immutable). Returns the same object when nothing changed.
 * `now` is injectable for deterministic tests.
 */
export function reduceAgentEvent(chat: ChatState, event: AgentEvent, now: number = Date.now()): ChatState {
  const ctx: Ctx = { now, history: false }
  let next: ChatState
  switch (event.type) {
    case 'sdk':
      next = reduceSdkMessage(chat, event.message, ctx)
      break
    case 'status':
      next = setStatus(chat, event.status, now)
      break
    case 'init':
      next = {
        ...chat,
        init: event.info,
        sessionId: event.info.sessionId || chat.sessionId,
        started: true,
        sdkPermissionMode: event.info.permissionMode || chat.sdkPermissionMode
      }
      break
    case 'capabilities':
      next = { ...chat, capabilities: event.capabilities }
      break
    case 'permission-request': {
      const req = event.request
      if (chat.pendingRequests.some((r) => r.requestId === req.requestId)) {
        next = chat
        break
      }
      next = { ...chat, pendingRequests: [...chat.pendingRequests, req], status: 'awaiting-input' }
      if (req.toolUseId) {
        const id = req.toolUseId
        next = updateTool(next, id, (t) => (t.status === 'streaming' ? finishToolInput(t) : t))
      }
      break
    }
    case 'permission-resolved':
      next = resolvePermission(chat, event.requestId, event.behavior, now)
      break
    case 'user-sent': {
      const exists = chat.items.some((i) => i.kind === 'user' && i.uuid === event.uuid)
      next = exists
        ? patchUserItem(chat, event.uuid, { pending: false })
        : addUserMessage(
            chat,
            { uuid: event.uuid, text: stripAtomContext(event.text), imageCount: event.images, pending: false },
            now
          )
      break
    }
    case 'file-changed':
      next = {
        ...chat,
        editedFiles: [...chat.editedFiles.filter((p) => p !== event.path), event.path]
      }
      break
    case 'context-usage':
      next = { ...chat, contextUsage: event.usage }
      break
    case 'rate-limit':
      next = { ...chat, rateLimit: event.info }
      break
    case 'mode-changed':
      next = modeChanged(chat, event.modeId, event.permission, now)
      break
    case 'error': {
      // `chat.error` drives the banner / call to action (e.g. sign in); the transcript gets a notice only when
      // the same text is not already visible in this turn (main reports assistant/result errors again).
      next = { ...chat, error: { message: event.message, kind: event.kind } }
      if (!textVisibleInTurn(next, event.message)) {
        next = addNotice(next, { variant: 'error', text: event.message, errorKind: event.kind }, now)
      }
      break
    }
    case 'stderr': {
      const tail = (chat.stderrTail + event.data).slice(-STDERR_TAIL_MAX)
      next = { ...chat, stderrTail: tail }
      break
    }
    default:
      next = chat
  }
  return touch(chat, next, now)
}

// ─────────────────────────────────────────────────────────────────────────────
// Stored session history
// ─────────────────────────────────────────────────────────────────────────────

export interface HistoryResult {
  items: TranscriptItem[]
  todos: TodoItem[] | null
  sessionId: string | null
}

/** Convert stored session messages (getSessionMessages) into transcript items + the latest todo list. */
export function historyFromStoredMessages(messages: StoredSessionMessage[], now: number = Date.now()): HistoryResult {
  const ctx: Ctx = { now, history: true }
  let chat = createChatState({ id: 'history', modeId: 'agent', permission: 'default', model: '', effort: 'auto', now })
  // ids of generated items look like `notice-history-3`, distinct from a live chat's `notice-<chatId>-3`
  let sessionId: string | null = null
  for (const m of messages) {
    if (!isObj(m)) continue
    sessionId = sessionId ?? (str(m.session_id) || null)
    if (m.type === 'system') {
      const inner = isObj(m.message) ? m.message : null
      if (inner && inner.subtype === 'compact_boundary') chat = reduceSystemMessage(chat, inner, ctx)
      continue
    }
    chat = reduceSdkMessage(
      chat,
      { type: m.type, uuid: m.uuid, session_id: m.session_id, message: m.message, parent_tool_use_id: m.parent_tool_use_id },
      ctx
    )
  }
  chat = interruptRunning(chat, now, true)
  return { items: chat.items, todos: chat.todos, sessionId }
}

/** Transcript items for stored session messages. */
export function transcriptFromStoredMessages(messages: StoredSessionMessage[], now?: number): TranscriptItem[] {
  return historyFromStoredMessages(messages, now).items
}

/**
 * Put loaded history in front of whatever the chat already shows (messages sent before the history arrived
 * stay at the end). Sets `historyLoaded`.
 */
export function applyHistory(chat: ChatState, history: HistoryResult, now: number = Date.now()): ChatState {
  const existing = new Set(history.items.map((i) => i.id))
  const live = chat.items.filter((i) => !existing.has(i.id))
  return {
    ...chat,
    items: [...history.items, ...live],
    todos: chat.todos ?? history.todos,
    sessionId: chat.sessionId ?? history.sessionId,
    historyLoaded: true,
    historyLoading: false,
    updatedAt: now
  }
}
