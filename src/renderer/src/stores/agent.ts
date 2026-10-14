/**
 * Agent chats store (`useAgentStore`).
 *
 * - One `ChatState` per chat tab (see `lib/agent-types.ts`); all agent events are folded in with the pure
 *   `reduceAgentEvent` (lib/agent-reducer.ts). Events are batched per animation frame while streaming.
 * - Chats are created locally; the CLI session is started lazily on the first `send()`.
 * - Tabs (ids, titles, session ids, mode/model/effort/permission, drafts) are persisted per workspace in
 *   localStorage and restored when the workspace changes. Restored chats load their transcript with
 *   `loadHistoryIfNeeded()` and continue the SDK session via `resumeSessionId`.
 *
 * Public API names are relied upon by other areas (editor ⌘L, explorer "Add to chat", status bar, settings).
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import type {
  AgentEventEnvelope,
  AgentModeDefinition,
  ContextAttachment,
  EffortLevel,
  ImageAttachment,
  ModelOption,
  OutgoingUserMessage,
  PermissionPolicy,
  PermissionRequest,
  PermissionResponse,
  RewindResult
} from '@shared/types'
import { FALLBACK_MODELS, findMode, getAllModes, normalizeModelValue } from '@shared/modes'
import { basename } from '@shared/paths'
import { atom } from '../lib/api'
import { uuid } from '../lib/ids'
import {
  DEFAULT_CHAT_TITLE,
  addNotice,
  addUserMessage,
  applyHistory,
  createChatState,
  historyFromStoredMessages,
  isRunning,
  patchUserItem,
  reduceAgentEvent,
  reopenPermissionRequest,
  titleFromPrompt
} from '../lib/agent-reducer'
import type { ChatState } from '../lib/agent-types'
import { useEditorStore } from './editor'
import { useLayoutStore } from './layout'
import { useSettingsStore } from './settings'
import { errorMessage, toast } from './toast'
import { useWorkspaceStore } from './workspace'

export type { ChatState } from '../lib/agent-types'

// ─────────────────────────────────────────────────────────────────────────────
// Store shape
// ─────────────────────────────────────────────────────────────────────────────

export interface NewChatOptions {
  modeId?: string
  /** Make the new chat the active tab (default true). */
  select?: boolean
}

export interface SendOptions {
  /** Target chat (default: the active chat). */
  chatId?: string
  /** Extra attachments when sending explicit text (the composer's are used when text is omitted). */
  attachments?: ContextAttachment[]
}

export interface AgentStoreState {
  chats: Record<string, ChatState>
  /** Tab order. Never empty. */
  order: string[]
  activeChatId: string | null
  /** Workspace the open tabs belong to ('' = no folder open). */
  workspacePath: string

  /** Create a chat tab with the default mode/model/effort/permission (reuses the active tab when it is pristine). */
  newChat(opts?: NewChatOptions): string
  /** Close a tab (stops its CLI session). Always keeps at least one chat. */
  closeChat(id: string): void
  setActive(id: string): void
  renameChat(id: string, title: string): void
  /** Reorder tabs. */
  moveChat(id: string, toIndex: number): void

  // composer (active chat unless chatId is given)
  setComposerText(text: string, chatId?: string): void
  addAttachment(att: ContextAttachment, chatId?: string): void
  removeAttachment(index: number, chatId?: string): void
  addImage(img: ImageAttachment, chatId?: string): void
  removeImage(index: number, chatId?: string): void
  clearComposer(chatId?: string): void

  /**
   * Send a prompt. Without `text` the active chat's composer (text, attachments, images) is sent and cleared.
   * While a turn is running the message is queued into it (priority 'next'). '/clear' opens a new chat.
   */
  send(text?: string, opts?: SendOptions): Promise<void>
  interrupt(chatId?: string): Promise<void>

  setMode(modeId: string, chatId?: string): void
  /** Next (or previous) mode in picker order — Shift+Tab in the composer. */
  cycleMode(direction?: 1 | -1, chatId?: string): void
  setPermission(policy: PermissionPolicy, chatId?: string): void
  setModel(model: string, chatId?: string): void
  setEffort(effort: EffortLevel | 'auto', chatId?: string): void

  /** Answer a permission / plan / question request (finds the owning chat). */
  respondPermission(requestId: string, response: PermissionResponse): Promise<void>
  /** Open a stored session (from history) in a tab; returns the chat id. */
  resumeSession(sessionId: string, title?: string): string
  /** Restore files to their state before the given user message. `dryRun` only previews. */
  rewind(userMessageUuid: string, opts?: { dryRun?: boolean; chatId?: string }): Promise<RewindResult | null>
  /** Stop a background task (subagent / shell) by task id. */
  stopTask(taskId: string, chatId?: string): Promise<void>

  /** Put the prompt suggestion into the composer and focus it. */
  acceptSuggestion(chatId?: string): void
  dismissSuggestion(chatId?: string): void
  dismissError(chatId?: string): void

  /** Show the agent panel and focus the composer. */
  focusComposer(): void
  /** The composer registers its focus function; returns an unregister function. */
  registerComposerFocus(fn: () => void): () => void

  /** Load the stored transcript of a restored / resumed chat (no-op when already loaded). */
  loadHistoryIfNeeded(chatId: string): Promise<void>
  /** Ask the CLI for fresh context usage (pushed automatically after each turn). */
  refreshContextUsage(chatId?: string): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function currentWorkspacePath(): string {
  return useWorkspaceStore.getState().workspace?.path ?? ''
}

function customModes(): AgentModeDefinition[] {
  return useSettingsStore.getState().settings.customModes
}

/** Most recent capabilities (models/commands) seen for this account — seeds new chats' pickers. */
let lastCapabilities: ChatState['capabilities'] = null

function makeChat(modeId?: string, workspace?: string): ChatState {
  const a = useSettingsStore.getState().settings.agent
  const chat = createChatState({
    id: uuid(),
    workspace: workspace ?? currentWorkspacePath(),
    modeId: findMode(modeId ?? a.defaultModeId, customModes()).id,
    permission: a.defaultPermission,
    model: normalizeModelValue(a.defaultModel),
    effort: a.defaultEffort
  })
  return lastCapabilities ? { ...chat, capabilities: lastCapabilities } : chat
}

/** Nothing typed, sent or started yet. */
function isPristine(c: ChatState): boolean {
  return (
    !c.started &&
    c.items.length === 0 &&
    !c.sessionId &&
    !c.resumeSessionId &&
    !c.composer.text.trim() &&
    c.composer.attachments.length === 0 &&
    c.composer.images.length === 0
  )
}

function sameAttachment(a: ContextAttachment, b: ContextAttachment): boolean {
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'file':
    case 'folder':
      return 'path' in b && a.path === b.path
    case 'selection':
      return b.type === 'selection' && a.path === b.path && a.startLine === b.startLine && a.endLine === b.endLine
    case 'diagnostics':
      return b.type === 'diagnostics' && a.path === b.path && a.text === b.text
    case 'terminal':
    case 'git-diff':
      return 'text' in b && a.text === b.text
  }
}

function activeEditorInfo(): OutgoingUserMessage['activeEditor'] {
  try {
    const info = useEditorStore.getState().getActiveEditorInfo()
    return info ? { path: info.path, line: info.line, column: info.column, language: info.language } : null
  } catch {
    return null
  }
}

function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const bin = atob(data)
  const bytes = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

/** Small preview data URL for an image attachment (≤ 160 px). Falls back to the original image. */
async function makeThumbnail(img: ImageAttachment, max = 160): Promise<string> {
  const original = `data:${img.mediaType};base64,${img.data}`
  if (img.data.length < 40_000 || typeof OffscreenCanvas === 'undefined') return original
  try {
    const bitmap = await createImageBitmap(new Blob([base64ToBytes(img.data)], { type: img.mediaType }))
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) return original
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return await blobToDataUrl(await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 }))
  } catch {
    return original
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-workspace tab persistence
// ─────────────────────────────────────────────────────────────────────────────

const TABS_KEY_PREFIX = 'atom.agent.tabs.v1:'

interface PersistedTab {
  id: string
  title: string
  titleEdited: boolean
  sessionId: string | null
  modeId: string
  model: string
  effort: EffortLevel | 'auto'
  permission: PermissionPolicy
  draft?: string
}

interface PersistedTabs {
  tabs: PersistedTab[]
  activeChatId: string | null
}

function tabsKey(workspace: string): string {
  return TABS_KEY_PREFIX + workspace
}

const MAX_RESTORED_TABS = 24
const EFFORT_VALUES: ReadonlySet<string> = new Set(['auto', 'low', 'medium', 'high', 'xhigh', 'max'])
const POLICY_VALUES: ReadonlySet<string> = new Set(['default', 'acceptEdits', 'auto', 'bypassPermissions'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

/** Validate one stored tab field by field (storage may hold data from older versions or be hand-edited). */
function sanitizeTab(raw: unknown, defaults: Pick<PersistedTab, 'modeId' | 'model' | 'effort' | 'permission'>): PersistedTab | null {
  if (!isRecord(raw)) return null
  const id = nonEmptyString(raw.id)
  if (!id || id.length > 128) return null
  const tab: PersistedTab = {
    id,
    title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : DEFAULT_CHAT_TITLE,
    titleEdited: raw.titleEdited === true,
    sessionId: nonEmptyString(raw.sessionId),
    modeId: nonEmptyString(raw.modeId) ?? defaults.modeId,
    model: typeof raw.model === 'string' ? raw.model : defaults.model,
    effort: typeof raw.effort === 'string' && EFFORT_VALUES.has(raw.effort) ? (raw.effort as PersistedTab['effort']) : defaults.effort,
    permission:
      typeof raw.permission === 'string' && POLICY_VALUES.has(raw.permission) ? (raw.permission as PermissionPolicy) : defaults.permission
  }
  if (typeof raw.draft === 'string' && raw.draft.trim()) tab.draft = raw.draft
  return tab
}

function readTabs(workspace: string): PersistedTabs | null {
  try {
    const raw = localStorage.getItem(tabsKey(workspace))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || !Array.isArray(parsed.tabs)) return null
    const a = useSettingsStore.getState().settings.agent
    const defaults = { modeId: a.defaultModeId, model: a.defaultModel, effort: a.defaultEffort, permission: a.defaultPermission }
    const seen = new Set<string>()
    const tabs: PersistedTab[] = []
    for (const entry of parsed.tabs) {
      const tab = sanitizeTab(entry, defaults)
      if (!tab || seen.has(tab.id)) continue
      seen.add(tab.id)
      tabs.push(tab)
      if (tabs.length >= MAX_RESTORED_TABS) break
    }
    return { tabs, activeChatId: typeof parsed.activeChatId === 'string' ? parsed.activeChatId : null }
  } catch {
    return null
  }
}

function snapshotTabs(s: AgentStoreState): PersistedTabs {
  const tabs: PersistedTab[] = []
  for (const id of s.order) {
    const c = s.chats[id]
    if (!c) continue
    const sessionId = c.sessionId ?? c.resumeSessionId ?? null
    // Pristine tabs are not worth restoring, unless it is the only one.
    if (!sessionId && !c.items.length && !c.composer.text.trim() && s.order.length > 1) continue
    const tab: PersistedTab = {
      id: c.id,
      title: c.title,
      titleEdited: c.titleEdited,
      sessionId,
      modeId: c.modeId,
      model: c.model,
      effort: c.effort,
      permission: c.permission
    }
    if (c.composer.text.trim()) tab.draft = c.composer.text
    tabs.push(tab)
  }
  return { tabs, activeChatId: s.activeChatId }
}

function chatFromTab(tab: PersistedTab, workspace: string): ChatState {
  const modes = customModes()
  const chat = createChatState({
    id: tab.id,
    workspace,
    modeId: findMode(tab.modeId, modes).id,
    permission: tab.permission,
    model: normalizeModelValue(tab.model),
    effort: tab.effort,
    title: tab.title,
    titleEdited: tab.titleEdited,
    sessionId: tab.sessionId,
    resumeSessionId: tab.sessionId ?? undefined
  })
  const withCaps = lastCapabilities ? { ...chat, capabilities: lastCapabilities } : chat
  return tab.draft ? { ...withCaps, composer: { ...withCaps.composer, text: tab.draft } } : withCaps
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
const lastPersisted = new Map<string, string>()

function persistNow(): void {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  const s = useAgentStore.getState()
  if (!s.workspacePath) return
  const key = tabsKey(s.workspacePath)
  const json = JSON.stringify(snapshotTabs(s))
  if (lastPersisted.get(key) === json) return
  try {
    localStorage.setItem(key, json)
    lastPersisted.set(key, json)
  } catch {
    /* storage full / unavailable — tabs simply won't be restored */
  }
}

function schedulePersist(): void {
  if (persistTimer) return
  persistTimer = setTimeout(persistNow, 400)
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

/** In-flight `atom.agent.createChat` calls, so concurrent sends start a chat once. */
const startPromises = new Map<string, Promise<void>>()
/**
 * Bumped when the user presses Stop while a chat's CLI is still starting: sends that were waiting for the
 * start are not delivered (there is no turn yet for `interrupt` to stop).
 */
const stopEpochs = new Map<string, number>()

/** Stop a chat's CLI session (after an in-flight start settles, so no orphan session is left behind). */
function closeRemote(chatId: string): void {
  const close = (): void => {
    void atom.agent.closeChat(chatId).catch(() => undefined)
  }
  const pending = startPromises.get(chatId)
  if (pending) void pending.then(close, close)
  else close()
}
const historyRequests = new Set<string>()
let composerFocusFn: (() => void) | null = null
let pendingComposerFocus = false

const initialChat = makeChat(undefined, '')

export const useAgentStore = create<AgentStoreState>((set, get) => {
  /** Immutable update of one chat (no-op when missing / unchanged). */
  const update = (chatId: string, fn: (c: ChatState) => ChatState): void => {
    set((s) => {
      const c = s.chats[chatId]
      if (!c) return s
      const n = fn(c)
      return n === c ? s : { chats: { ...s.chats, [chatId]: n } }
    })
  }

  // Actions are often passed straight to onClick: ignore non-string arguments (e.g. a MouseEvent).
  const resolveId = (chatId?: unknown): string | null => {
    const id = typeof chatId === 'string' ? chatId : get().activeChatId
    return id && get().chats[id] ? id : null
  }

  const ensureStarted = async (chatId: string): Promise<void> => {
    const chat = get().chats[chatId]
    if (!chat) throw new Error('This chat was closed.')
    if (chat.started) return
    let p = startPromises.get(chatId)
    if (!p) {
      p = (async () => {
        const c = get().chats[chatId]
        if (!c) throw new Error('This chat was closed.')
        await atom.agent.createChat({
          chatId,
          workspace: c.workspace,
          modeId: c.modeId,
          model: c.model,
          effort: c.effort,
          permission: c.permission,
          ...(c.resumeSessionId ? { resumeSessionId: c.resumeSessionId } : {}),
          ...(c.titleEdited ? { title: c.title } : {})
        })
        update(chatId, (x) => (x.started ? x : { ...x, started: true }))
      })().finally(() => startPromises.delete(chatId))
      startPromises.set(chatId, p)
    }
    await p
  }

  /**
   * Call a live-config IPC method when the chat's CLI is running (or right after it finishes starting);
   * a chat that has not started picks the value up from `createChat`.
   */
  const liveCall = (chatId: string, action: string, fn: () => Promise<void>): void => {
    const report = (err: unknown): void => {
      toast.error(`Could not ${action}`, errorMessage(err))
    }
    const pending = startPromises.get(chatId)
    if (pending) {
      pending.then(() => fn()).catch(report)
      return
    }
    if (get().chats[chatId]?.started) fn().catch(report)
  }

  const composerOf = (chatId: string | null, fn: (composer: ChatState['composer']) => ChatState['composer']): void => {
    if (!chatId) return
    update(chatId, (c) => {
      const composer = fn(c.composer)
      return composer === c.composer ? c : { ...c, composer }
    })
  }

  return {
    chats: { [initialChat.id]: initialChat },
    order: [initialChat.id],
    activeChatId: initialChat.id,
    workspacePath: '',

    newChat: (rawOpts) => {
      const opts: NewChatOptions | undefined =
        rawOpts && typeof rawOpts === 'object' && !('nativeEvent' in rawOpts) ? rawOpts : undefined
      const s = get()
      const active = s.activeChatId ? s.chats[s.activeChatId] : null
      if (active && isPristine(active) && opts?.select !== false) {
        if (opts?.modeId && opts.modeId !== active.modeId) get().setMode(opts.modeId, active.id)
        return active.id
      }
      const chat = makeChat(opts?.modeId)
      set({
        chats: { ...s.chats, [chat.id]: chat },
        order: [...s.order, chat.id],
        activeChatId: opts?.select === false ? s.activeChatId : chat.id
      })
      return chat.id
    },

    closeChat: (id) => {
      const s = get()
      const chat = s.chats[id]
      if (!chat) return
      // Sends still waiting for the CLI to start must not reach a session that is being closed.
      if (startPromises.has(id)) stopEpochs.set(id, (stopEpochs.get(id) ?? 0) + 1)
      if (chat.started || startPromises.has(id)) closeRemote(id)
      const chats = { ...s.chats }
      delete chats[id]
      const order = s.order.filter((x) => x !== id)
      let activeChatId = s.activeChatId
      if (activeChatId === id) {
        const idx = s.order.indexOf(id)
        activeChatId = order[Math.min(idx, order.length - 1)] ?? null
      }
      if (!order.length) {
        const fresh = makeChat()
        chats[fresh.id] = fresh
        order.push(fresh.id)
        activeChatId = fresh.id
      }
      set({ chats, order, activeChatId })
      if (activeChatId) void get().loadHistoryIfNeeded(activeChatId)
    },

    setActive: (id) => {
      if (!get().chats[id]) return
      if (get().activeChatId !== id) set({ activeChatId: id })
      void get().loadHistoryIfNeeded(id)
    },

    renameChat: (id, title) => {
      const chat = get().chats[id]
      if (!chat) return
      const clean = title.replace(/\s+/g, ' ').trim()
      update(id, (c) => (clean ? { ...c, title: clean, titleEdited: true } : { ...c, titleEdited: false }))
      const sessionId = chat.sessionId ?? chat.resumeSessionId
      const ws = chat.workspace || currentWorkspacePath()
      if (clean && sessionId && ws) void atom.agent.renameSession(sessionId, clean, ws).catch(() => undefined)
    },

    moveChat: (id, toIndex) => {
      const order = get().order.filter((x) => x !== id)
      if (order.length === get().order.length) return
      const idx = Math.max(0, Math.min(toIndex, order.length))
      order.splice(idx, 0, id)
      set({ order })
    },

    setComposerText: (text, chatId) => composerOf(resolveId(chatId), (c) => (c.text === text ? c : { ...c, text })),

    addAttachment: (att, chatId) =>
      composerOf(resolveId(chatId), (c) =>
        c.attachments.some((a) => sameAttachment(a, att)) ? c : { ...c, attachments: [...c.attachments, att] }
      ),

    removeAttachment: (index, chatId) =>
      composerOf(resolveId(chatId), (c) =>
        index < 0 || index >= c.attachments.length ? c : { ...c, attachments: c.attachments.filter((_, i) => i !== index) }
      ),

    addImage: (img, chatId) =>
      composerOf(resolveId(chatId), (c) =>
        c.images.some((i) => i.data === img.data) ? c : { ...c, images: [...c.images, img] }
      ),

    removeImage: (index, chatId) =>
      composerOf(resolveId(chatId), (c) =>
        index < 0 || index >= c.images.length ? c : { ...c, images: c.images.filter((_, i) => i !== index) }
      ),

    clearComposer: (chatId) => composerOf(resolveId(chatId), () => ({ text: '', attachments: [], images: [] })),

    send: async (text, opts) => {
      const chatId = resolveId(opts?.chatId)
      if (!chatId) return
      const chat = get().chats[chatId]
      const fromComposer = typeof text !== 'string'
      const body = (fromComposer ? chat.composer.text : text).trim()
      const attachments = fromComposer ? chat.composer.attachments : (opts?.attachments ?? [])
      const images = fromComposer ? chat.composer.images : []
      if (!body && !attachments.length && !images.length) return

      if (body === '/clear' && !attachments.length && !images.length) {
        if (fromComposer) get().clearComposer(chatId)
        get().newChat({ modeId: chat.modeId })
        return
      }

      const workspace = chat.workspace || currentWorkspacePath()
      if (!workspace) {
        toast.warning('Open a folder first', 'ATOM works inside a project folder — open one to start chatting.')
        return
      }

      const settings = useSettingsStore.getState().settings.agent
      const msgUuid = uuid()
      const busy = isRunning(chat) && (chat.started || startPromises.has(chatId))
      const now = Date.now()
      const stopEpoch = stopEpochs.get(chatId) ?? 0

      update(chatId, (c) => {
        let n = addUserMessage(
          c,
          {
            uuid: msgUuid,
            text: body,
            attachments,
            imageCount: images.length,
            checkpoint: settings.enableCheckpoints,
            queued: busy,
            pending: true
          },
          now
        )
        n = {
          ...n,
          workspace,
          error: null,
          suggestion: null,
          queuedCount: busy ? c.queuedCount + 1 : c.queuedCount
        }
        if (fromComposer) n = { ...n, composer: { text: '', attachments: [], images: [] } }
        if (!c.titleEdited && c.title === DEFAULT_CHAT_TITLE && body) n = { ...n, title: titleFromPrompt(body) }
        if (!busy) n = { ...n, status: c.started ? 'running' : 'starting', turnStartedAt: now }
        return n
      })

      if (images.length) {
        void Promise.all(images.map((img) => makeThumbnail(img))).then((thumbnails) =>
          update(chatId, (c) => patchUserItem(c, msgUuid, { thumbnails }))
        )
      }

      try {
        await ensureStarted(chatId)
        if ((stopEpochs.get(chatId) ?? 0) !== stopEpoch) {
          // Stopped while the CLI was starting: take the prompt back into the composer instead of sending it.
          update(chatId, (c) => {
            let n: ChatState = { ...c, items: c.items.filter((i) => !(i.kind === 'user' && i.uuid === msgUuid)) }
            if (fromComposer) {
              const cur = n.composer
              n = {
                ...n,
                composer: {
                  text: cur.text.trim() ? `${body}\n\n${cur.text}` : body,
                  attachments: [...attachments, ...cur.attachments.filter((a) => !attachments.some((b) => sameAttachment(a, b)))],
                  images: [...images, ...cur.images.filter((i) => !images.some((j) => j.data === i.data))]
                }
              }
            }
            const settling = n.status === 'starting'
            return {
              ...n,
              queuedCount: busy ? Math.max(0, n.queuedCount - 1) : n.queuedCount,
              status: settling ? 'idle' : n.status,
              turnStartedAt: settling ? null : n.turnStartedAt
            }
          })
          return
        }
        const message: OutgoingUserMessage = {
          uuid: msgUuid,
          text: body,
          attachments,
          images,
          activeEditor: settings.autoIncludeActiveFile ? activeEditorInfo() : null
        }
        if (busy) message.priority = 'next'
        await atom.agent.send(chatId, message)
      } catch (err) {
        const msg = errorMessage(err)
        update(chatId, (c) => {
          // Take the message back out and restore the composer so the user can retry.
          let n: ChatState = { ...c, items: c.items.filter((i) => !(i.kind === 'user' && i.uuid === msgUuid)) }
          if (fromComposer && !n.composer.text.trim() && !n.composer.images.length) {
            n = { ...n, composer: { text: body, attachments, images } }
          }
          const alreadyShown = n.items
            .slice(-3)
            .some((i) => i.kind === 'notice' && i.variant === 'error' && (i.text === msg || i.detail === msg))
          if (!alreadyShown) n = addNotice(n, { variant: 'error', text: 'Message not sent', detail: msg }, Date.now())
          return {
            ...n,
            queuedCount: busy ? Math.max(0, c.queuedCount - 1) : c.queuedCount,
            status: busy ? c.status : c.status === 'starting' || c.status === 'running' ? 'idle' : c.status,
            turnStartedAt: busy ? c.turnStartedAt : null
          }
        })
        if (!useLayoutStore.getState().agentVisible) toast.error('Message not sent', msg)
      }
    },

    interrupt: async (chatId) => {
      const id = resolveId(chatId)
      if (!id) return
      if (!get().chats[id].started) {
        if (!startPromises.has(id)) return
        // Nothing runs yet: cancel the sends waiting for the CLI and settle the optimistic "starting" state.
        stopEpochs.set(id, (stopEpochs.get(id) ?? 0) + 1)
        update(id, (c) => (c.status === 'starting' ? { ...c, status: 'idle', turnStartedAt: null } : c))
        return
      }
      try {
        await atom.agent.interrupt(id)
      } catch (err) {
        toast.error('Could not stop the agent', errorMessage(err))
      }
    },

    setMode: (modeId, chatId) => {
      const id = resolveId(chatId)
      if (!id) return
      const mode = findMode(modeId, customModes())
      update(id, (c) => (c.modeId === mode.id ? c : { ...c, modeId: mode.id }))
      liveCall(id, 'switch the mode', () => atom.agent.setMode(id, mode.id))
    },

    cycleMode: (direction, chatId) => {
      const id = resolveId(chatId)
      if (!id) return
      const modes = getAllModes(customModes())
      if (!modes.length) return
      const step = direction === -1 ? -1 : 1
      const idx = modes.findIndex((m) => m.id === get().chats[id].modeId)
      const next = modes[(idx + step + modes.length) % modes.length]
      get().setMode(next.id, id)
    },

    setPermission: (policy, chatId) => {
      const id = resolveId(chatId)
      if (!id) return
      update(id, (c) => (c.permission === policy ? c : { ...c, permission: policy }))
      liveCall(id, 'change the permission mode', () => atom.agent.setPermission(id, policy))
    },

    setModel: (model, chatId) => {
      const id = resolveId(chatId)
      if (!id) return
      const value = normalizeModelValue(model)
      update(id, (c) => (c.model === value ? c : { ...c, model: value }))
      liveCall(id, 'switch the model', () => atom.agent.setModel(id, value))
    },

    setEffort: (effort, chatId) => {
      const id = resolveId(chatId)
      if (!id) return
      update(id, (c) => (c.effort === effort ? c : { ...c, effort }))
      liveCall(id, 'change the effort level', () => atom.agent.setEffort(id, effort))
    },

    respondPermission: async (requestId, response) => {
      const s = get()
      const chatId = s.order.find((id) => s.chats[id]?.pendingRequests.some((r) => r.requestId === requestId))
      if (!chatId) return
      const request = s.chats[chatId].pendingRequests.find((r) => r.requestId === requestId) as PermissionRequest
      // Optimistic: hide the prompt right away (the main process confirms with `permission-resolved`).
      update(chatId, (c) => reduceAgentEvent(c, { type: 'permission-resolved', requestId, behavior: response.behavior }))
      try {
        await atom.agent.respondPermission(chatId, requestId, response)
      } catch (err) {
        update(chatId, (c) => reopenPermissionRequest(c, request))
        toast.error('Could not send your answer', errorMessage(err))
      }
    },

    resumeSession: (sessionId, title) => {
      const s = get()
      const existing = s.order.find((id) => s.chats[id]?.sessionId === sessionId || s.chats[id]?.resumeSessionId === sessionId)
      if (existing) {
        get().setActive(existing)
        return existing
      }
      const active = s.activeChatId ? s.chats[s.activeChatId] : null
      const reuse = active && isPristine(active) ? active : null
      const base = reuse ?? makeChat()
      const chat: ChatState = {
        ...base,
        sessionId,
        resumeSessionId: sessionId,
        title: title?.replace(/\s+/g, ' ').trim() || base.title,
        historyLoaded: false,
        historyLoading: false
      }
      set({
        chats: { ...s.chats, [chat.id]: chat },
        order: reuse ? s.order : [...s.order, chat.id],
        activeChatId: chat.id
      })
      void get().loadHistoryIfNeeded(chat.id)
      return chat.id
    },

    rewind: async (userMessageUuid, opts) => {
      const s = get()
      const owner = s.order.find((id) => s.chats[id]?.items.some((i) => i.kind === 'user' && i.uuid === userMessageUuid))
      const chatId = opts?.chatId ?? owner ?? s.activeChatId
      if (!chatId || !s.chats[chatId]) return null
      const dryRun = opts?.dryRun ?? false
      try {
        await ensureStarted(chatId)
        const res = await atom.agent.rewind(chatId, userMessageUuid, dryRun)
        if (!dryRun) {
          if (res.canRewind) {
            const n = res.filesChanged?.length ?? 0
            update(chatId, (c) =>
              addNotice(
                c,
                {
                  variant: 'info',
                  text: n
                    ? `Restored ${n} file${n === 1 ? '' : 's'} to the checkpoint before this message`
                    : 'Checkpoint restored — no files needed changes',
                  detail: res.filesChanged?.map((f) => basename(f)).join(', ') || undefined
                },
                Date.now()
              )
            )
          } else {
            toast.error('Could not restore the checkpoint', res.error)
          }
        }
        return res
      } catch (err) {
        toast.error('Could not restore the checkpoint', errorMessage(err))
        return null
      }
    },

    stopTask: async (taskId, chatId) => {
      const id = resolveId(chatId)
      if (!id || !get().chats[id].started) return
      try {
        await atom.agent.stopTask(id, taskId)
      } catch (err) {
        toast.error('Could not stop the task', errorMessage(err))
      }
    },

    acceptSuggestion: (chatId) => {
      const id = resolveId(chatId)
      if (!id) return
      const suggestion = get().chats[id].suggestion
      if (!suggestion) return
      update(id, (c) => ({ ...c, suggestion: null, composer: { ...c.composer, text: suggestion } }))
      get().focusComposer()
    },

    dismissSuggestion: (chatId) => {
      const id = resolveId(chatId)
      if (id) update(id, (c) => (c.suggestion ? { ...c, suggestion: null } : c))
    },

    dismissError: (chatId) => {
      const id = resolveId(chatId)
      if (id) update(id, (c) => (c.error ? { ...c, error: null } : c))
    },

    focusComposer: () => {
      const layout = useLayoutStore.getState()
      if (!layout.agentVisible) layout.setAgentVisible(true)
      if (composerFocusFn) {
        const fn = composerFocusFn
        requestAnimationFrame(() => fn())
      } else {
        pendingComposerFocus = true
      }
    },

    registerComposerFocus: (fn) => {
      composerFocusFn = fn
      if (pendingComposerFocus) {
        pendingComposerFocus = false
        requestAnimationFrame(() => fn())
      }
      return () => {
        if (composerFocusFn === fn) composerFocusFn = null
      }
    },

    loadHistoryIfNeeded: async (chatId) => {
      const chat = get().chats[chatId]
      if (!chat || chat.historyLoaded || chat.historyLoading || historyRequests.has(chatId)) return
      const sessionId = chat.resumeSessionId ?? chat.sessionId
      const ws = chat.workspace || currentWorkspacePath()
      if (!sessionId || !ws) {
        update(chatId, (c) => ({ ...c, historyLoaded: true }))
        return
      }
      historyRequests.add(chatId)
      update(chatId, (c) => ({ ...c, historyLoading: true }))
      try {
        const messages = await atom.agent.loadSession(sessionId, ws)
        if (!messages.length) {
          // The session is gone (deleted / different machine): continue as a fresh conversation.
          update(chatId, (c) => ({
            ...c,
            historyLoaded: true,
            historyLoading: false,
            ...(c.started ? {} : { resumeSessionId: undefined, sessionId: null })
          }))
          return
        }
        const history = historyFromStoredMessages(messages)
        update(chatId, (c) => applyHistory(c, history))
      } catch (err) {
        update(chatId, (c) =>
          addNotice(
            { ...c, historyLoaded: true, historyLoading: false },
            { variant: 'error', text: 'Could not load this chat’s history', detail: errorMessage(err) },
            Date.now()
          )
        )
      } finally {
        historyRequests.delete(chatId)
      }
    },

    refreshContextUsage: async (chatId) => {
      const id = resolveId(chatId)
      if (!id || !get().chats[id].started) return
      try {
        const usage = await atom.agent.getContextUsage(id)
        if (usage) update(id, (c) => ({ ...c, contextUsage: usage }))
      } catch {
        /* best effort */
      }
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Event routing (batched per frame while streaming)
// ─────────────────────────────────────────────────────────────────────────────

let eventQueue: AgentEventEnvelope[] = []
let rafHandle: number | null = null
let timeoutHandle: ReturnType<typeof setTimeout> | null = null

function flushEvents(): void {
  if (rafHandle !== null) cancelAnimationFrame(rafHandle)
  if (timeoutHandle !== null) clearTimeout(timeoutHandle)
  rafHandle = null
  timeoutHandle = null
  if (!eventQueue.length) return
  const batch = eventQueue
  eventQueue = []
  const now = Date.now()
  useAgentStore.setState((s) => {
    let chats = s.chats
    let changed = false
    for (const { chatId, event } of batch) {
      const chat = chats[chatId]
      if (!chat) continue
      const next = reduceAgentEvent(chat, event, now)
      if (next === chat) continue
      if (!changed) {
        chats = { ...chats }
        changed = true
      }
      chats[chatId] = next
      if (next.capabilities && next.capabilities !== chat.capabilities) lastCapabilities = next.capabilities
    }
    return changed ? { chats } : s
  })
}

function scheduleFlush(): void {
  if (rafHandle === null) rafHandle = requestAnimationFrame(flushEvents)
  // rAF does not fire while the window is hidden; the timeout keeps state current in the background.
  if (timeoutHandle === null) timeoutHandle = setTimeout(flushEvents, 60)
}

function notifyPermissionRequest(chatId: string, request: PermissionRequest): void {
  const s = useAgentStore.getState()
  const layout = useLayoutStore.getState()
  if (layout.agentVisible && s.activeChatId === chatId && document.hasFocus()) return
  const chat = s.chats[chatId]
  const what = request.kind === 'plan' ? 'A plan is ready for review' : request.kind === 'question' ? 'ATOM has a question' : 'ATOM needs your approval'
  toast.show(
    {
      kind: 'warning',
      message: what,
      detail: request.title ?? (chat ? chat.title : undefined),
      action: {
        label: 'Review',
        run: () => {
          useLayoutStore.getState().setAgentVisible(true)
          useAgentStore.getState().setActive(chatId)
        }
      }
    },
    10_000
  )
}

function handleEnvelope(envelope: AgentEventEnvelope): void {
  const { chatId, event } = envelope
  if (!useAgentStore.getState().chats[chatId]) return

  if (event.type === 'file-changed') {
    try {
      const editor = useEditorStore.getState()
      void editor.reloadFromDisk(event.path).catch(() => undefined)
      if (event.tool !== 'rewind') editor.markAgentEdited(event.path)
    } catch {
      /* editor not ready */
    }
  } else if (event.type === 'permission-request') {
    notifyPermissionRequest(chatId, event.request)
  }

  eventQueue.push(envelope)
  // Prompts and status changes should feel instant; deltas are batched.
  if (event.type === 'permission-request' || event.type === 'status' || event.type === 'error') flushEvents()
  else scheduleFlush()
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace switching & settings defaults
// ─────────────────────────────────────────────────────────────────────────────

function switchWorkspace(path: string): void {
  const s = useAgentStore.getState()
  if (path === s.workspacePath) return
  persistNow()
  flushEvents()

  const chats: Record<string, ChatState> = {}
  const order: string[] = []
  // Unsent work started before a folder was open moves into the new workspace; everything else closes.
  const carried: string[] = []
  for (const id of s.order) {
    const c = s.chats[id]
    if (!c) continue
    const hasWork = c.items.length > 0 || !!c.composer.text.trim() || c.composer.attachments.length > 0 || c.composer.images.length > 0
    if (!c.workspace && !c.started && hasWork && path) {
      chats[id] = { ...c, workspace: path }
      carried.push(id)
    } else if (c.started || startPromises.has(id)) {
      if (startPromises.has(id)) stopEpochs.set(id, (stopEpochs.get(id) ?? 0) + 1)
      closeRemote(id)
    }
  }

  const saved = path ? readTabs(path) : null
  let savedActive = saved?.activeChatId ?? null
  for (const tab of saved?.tabs ?? []) {
    if (chats[tab.id]) continue
    // The chat may still be starting from before an earlier switch, with its close queued behind the start
    // (closeRemote). Main keys sessions by chat id, so restore it under a fresh id that the pending close can
    // never reach.
    const restored = startPromises.has(tab.id) ? { ...tab, id: uuid() } : tab
    if (savedActive === tab.id) savedActive = restored.id
    chats[restored.id] = chatFromTab(restored, path)
    order.push(restored.id)
  }
  order.push(...carried)
  if (!order.length) {
    const fresh = makeChat(undefined, path)
    chats[fresh.id] = fresh
    order.push(fresh.id)
  }
  const activeChatId = carried[0] ?? (savedActive && chats[savedActive] ? savedActive : order[order.length - 1])

  useAgentStore.setState({ chats, order, activeChatId, workspacePath: path })
  if (path) lastPersisted.set(tabsKey(path), JSON.stringify(snapshotTabs(useAgentStore.getState())))
  void useAgentStore.getState().loadHistoryIfNeeded(activeChatId)
}

type ChatDefaults = Pick<ChatState, 'modeId' | 'permission' | 'model' | 'effort'>

function settingsDefaults(): ChatDefaults {
  const a = useSettingsStore.getState().settings.agent
  return {
    modeId: findMode(a.defaultModeId, customModes()).id,
    permission: a.defaultPermission,
    model: normalizeModelValue(a.defaultModel),
    effort: a.defaultEffort
  }
}

let appliedDefaults: ChatDefaults | null = null

/**
 * Pristine chats follow the default mode/model/effort/permission: on first load every pristine chat adopts
 * them; later, a changed default only replaces values the user has not picked in that chat.
 */
function applySettingsDefaults(): void {
  const next = settingsDefaults()
  const prev = appliedDefaults
  appliedDefaults = next
  if (prev && prev.modeId === next.modeId && prev.permission === next.permission && prev.model === next.model && prev.effort === next.effort) {
    return
  }
  useAgentStore.setState((s) => {
    let chats = s.chats
    for (const id of s.order) {
      const c = chats[id]
      if (!c || !isPristine(c)) continue
      const patch: Partial<ChatDefaults> = {}
      for (const key of ['modeId', 'permission', 'model', 'effort'] as const) {
        if (c[key] !== next[key] && (!prev || c[key] === prev[key])) Object.assign(patch, { [key]: next[key] })
      }
      if (!Object.keys(patch).length) continue
      if (chats === s.chats) chats = { ...chats }
      chats[id] = { ...c, ...patch }
    }
    return chats === s.chats ? s : { chats }
  })
}

let initialized = false

/** Wire IPC events, workspace switching, settings defaults and persistence. Idempotent; runs automatically. */
export function initAgentStore(): void {
  if (initialized) return
  initialized = true
  if (typeof window === 'undefined' || !window.atom?.agent) return

  atom.agent.onEvent(handleEnvelope)

  useWorkspaceStore.subscribe((state, prev) => {
    const next = state.workspace?.path ?? ''
    if (next !== (prev.workspace?.path ?? '')) switchWorkspace(next)
  })
  const ws = currentWorkspacePath()
  if (ws) switchWorkspace(ws)

  useSettingsStore.subscribe((state) => {
    if (state.loaded) applySettingsDefaults()
  })
  if (useSettingsStore.getState().loaded) applySettingsDefaults()

  useAgentStore.subscribe(schedulePersist)
  window.addEventListener('beforeunload', persistNow)
}

// Deferred so that modules importing each other are fully evaluated first.
queueMicrotask(initAgentStore)

// ─────────────────────────────────────────────────────────────────────────────
// Hooks & non-hook accessors
// ─────────────────────────────────────────────────────────────────────────────

export function getActiveChat(): ChatState | null {
  const s = useAgentStore.getState()
  return s.activeChatId ? (s.chats[s.activeChatId] ?? null) : null
}

export function useActiveChat(): ChatState | null {
  return useAgentStore((s) => (s.activeChatId ? (s.chats[s.activeChatId] ?? null) : null))
}

export function useChat(id: string | null | undefined): ChatState | null {
  return useAgentStore((s) => (id ? (s.chats[id] ?? null) : null))
}

/** Models for a chat's model picker: the account's list from the CLI, or the fallback aliases. */
export function useAvailableModels(chatId?: string | null): ModelOption[] {
  return useAgentStore((s) => {
    const id = chatId ?? s.activeChatId
    const models = id ? s.chats[id]?.capabilities?.models : undefined
    return models && models.length ? models : (lastCapabilities?.models?.length ? lastCapabilities.models : FALLBACK_MODELS)
  })
}

/** Built-in + custom modes in picker order. */
export function useAgentModes(): AgentModeDefinition[] {
  const custom = useSettingsStore((s) => s.settings.customModes)
  return useMemo(() => getAllModes(custom), [custom])
}

/** The active chat's mode definition. */
export function useActiveMode(): AgentModeDefinition {
  const modeId = useAgentStore((s) => (s.activeChatId ? s.chats[s.activeChatId]?.modeId : undefined))
  const custom = useSettingsStore((s) => s.settings.customModes)
  return useMemo(() => findMode(modeId ?? '', custom), [modeId, custom])
}

/** Number of chats with a turn in progress (status bar "ATOM is working…"). */
export function useRunningChatCount(): number {
  return useAgentStore((s) => s.order.reduce((n, id) => (s.chats[id] && isRunning(s.chats[id]) ? n + 1 : n), 0))
}

/** Number of chats blocked on a permission / plan / question prompt. */
export function useAwaitingChatCount(): number {
  return useAgentStore((s) => s.order.reduce((n, id) => (s.chats[id]?.pendingRequests.length ? n + 1 : n), 0))
}
