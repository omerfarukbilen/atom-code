/**
 * Agent manager: owns every chat's AgentSession and wires the `IPC.agent*` handlers
 * (see docs/ARCHITECTURE.md §5).
 */
import { statSync } from 'node:fs'
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { deleteSession, getSessionMessages, listSessions, renameSession } from '@anthropic-ai/claude-agent-sdk'
import type { AccountInfo, SDKSessionInfo, SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { IPC } from '../../shared/ipc'
import { PERMISSION_POLICIES, findMode } from '../../shared/modes'
import type {
  AgentEvent,
  AgentEventEnvelope,
  CreateChatOptions,
  EffortLevel,
  OutgoingUserMessage,
  PermissionPolicy,
  PermissionResponse,
  SessionSummary,
  StoredSessionMessage
} from '../../shared/types'
import { ctx } from '../context'
import { settingsService } from '../services/settings'
import { AgentSession, errorMessage, toIpcSafe } from './session'

export interface CachedAccountInfo {
  email?: string
  organization?: string
  subscriptionType?: string
  tokenSource?: string
  apiProvider?: string
}

const sessions = new Map<string, AgentSession>()
let accountInfoCache: CachedAccountInfo | null = null
let unsubscribeSettings: (() => void) | null = null

const EFFORTS: readonly (EffortLevel | 'auto')[] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
const POLICIES: readonly PermissionPolicy[] = PERMISSION_POLICIES.map((p) => p.id)
const SESSION_LIST_LIMIT = 100
const MAX_TITLE_LENGTH = 200

// ─────────────────────────────────────────────────────────────────────────────
// Public helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Latest account info reported by any agent session (fetched once per session after init). */
export function getCachedAccountInfo(): CachedAccountInfo | null {
  return accountInfoCache ? { ...accountInfoCache } : null
}

/** Forget the cached account (e.g. after logout) so stale details are never shown. */
export function clearCachedAccountInfo(): void {
  accountInfoCache = null
}

export function getSession(chatId: string): AgentSession | undefined {
  return sessions.get(chatId)
}

/**
 * Close every chat but keep the IPC wiring (the renderer reloaded or its window closed: it has no
 * record of these chats any more, so their CLIs and pending prompts would otherwise be orphaned).
 * Never waits longer than a few seconds.
 */
export async function closeAllChats(): Promise<void> {
  const all = [...sessions.values()]
  sessions.clear()
  if (all.length === 0) return
  let timer: ReturnType<typeof setTimeout> | null = null
  await Promise.race([
    Promise.allSettled(all.map((s) => s.close())),
    new Promise<void>((r) => (timer = setTimeout(r, 3000)))
  ])
  if (timer) clearTimeout(timer)
}

/** Credentials changed (sign-in, API key, token, logout): relaunch chats once idle with the new environment. */
export function restartChatsForNewCredentials(): void {
  for (const session of sessions.values()) session.requestRestart()
}

/** Close every chat (app shutdown). Never waits longer than a few seconds. */
export async function disposeAgents(): Promise<void> {
  unsubscribeSettings?.()
  unsubscribeSettings = null
  await closeAllChats()
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function rememberAccountInfo(info: AccountInfo): void {
  const next: CachedAccountInfo = {}
  const pick = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
  const email = pick(info.email)
  const organization = pick(info.organization)
  const subscriptionType = pick(info.subscriptionType)
  const tokenSource = pick(info.tokenSource)
  const apiProvider = pick(info.apiProvider)
  if (email) next.email = email
  if (organization) next.organization = organization
  if (subscriptionType) next.subscriptionType = subscriptionType
  if (tokenSource) next.tokenSource = tokenSource
  if (apiProvider) next.apiProvider = apiProvider
  if (Object.keys(next).length > 0) accountInfoCache = next
}

function sendEvent(chatId: string, event: AgentEvent): void {
  const envelope: AgentEventEnvelope = { chatId, event }
  ctx.send(IPC.agentEvent, envelope)
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing or invalid ${name}.`)
  return value
}

function requireSession(chatId: unknown): AgentSession {
  const id = requireString(chatId, 'chat id')
  const session = sessions.get(id)
  if (!session || session.isDisposed) throw new Error(`Unknown chat "${id}". Create the chat before using it.`)
  return session
}

function requireDirectory(path: unknown, name: string): string {
  const dir = requireString(path, name)
  let isDir = false
  try {
    isDir = statSync(dir).isDirectory()
  } catch {
    isDir = false
  }
  if (!isDir) throw new Error(`The workspace folder does not exist: ${dir}`)
  return dir
}

function parseCreateChatOptions(raw: unknown): CreateChatOptions {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid chat options.')
  const o = raw as Record<string, unknown>
  const settings = settingsService.get()
  const modeId = typeof o.modeId === 'string' && o.modeId ? o.modeId : settings.agent.defaultModeId
  const effort = typeof o.effort === 'string' && (EFFORTS as readonly string[]).includes(o.effort) ? (o.effort as EffortLevel | 'auto') : settings.agent.defaultEffort
  const permission =
    typeof o.permission === 'string' && (POLICIES as readonly string[]).includes(o.permission)
      ? (o.permission as PermissionPolicy)
      : settings.agent.defaultPermission
  const options: CreateChatOptions = {
    chatId: requireString(o.chatId, 'chat id'),
    workspace: requireDirectory(o.workspace, 'workspace'),
    modeId: findMode(modeId, settings.customModes).id,
    model: typeof o.model === 'string' ? o.model : settings.agent.defaultModel,
    effort,
    permission
  }
  if (typeof o.resumeSessionId === 'string' && o.resumeSessionId.trim()) {
    options.resumeSessionId = o.resumeSessionId.trim()
    if (o.forkSession === true) options.forkSession = true
  }
  if (typeof o.title === 'string' && o.title.trim()) options.title = o.title.trim()
  return options
}

async function createChat(raw: unknown): Promise<void> {
  const options = parseCreateChatOptions(raw)
  const existing = sessions.get(options.chatId)
  if (existing) {
    sessions.delete(options.chatId)
    await existing.close()
  }
  const session = new AgentSession(options, {
    emit: (event) => sendEvent(options.chatId, event),
    onAccountInfo: rememberAccountInfo
  })
  sessions.set(options.chatId, session)
  // Launch failures (no binary, bad auth…) surface as `error` events; send() retries the launch.
  await session.start().catch(() => undefined)
}

function toSessionSummary(info: SDKSessionInfo): SessionSummary {
  const title = (info.customTitle?.trim() || info.summary?.trim() || info.firstPrompt?.trim() || 'Untitled session').replace(/\s+/g, ' ')
  const summary: SessionSummary = {
    sessionId: info.sessionId,
    title: title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title,
    lastModified: info.lastModified
  }
  if (typeof info.createdAt === 'number') summary.createdAt = info.createdAt
  if (info.gitBranch) summary.gitBranch = info.gitBranch
  if (info.cwd) summary.cwd = info.cwd
  if (info.firstPrompt) summary.firstPrompt = info.firstPrompt
  if (typeof info.fileSize === 'number') summary.fileSize = info.fileSize
  return summary
}

function toStoredMessage(m: SessionMessage): StoredSessionMessage {
  return {
    type: m.type,
    uuid: m.uuid,
    session_id: m.session_id,
    message: toIpcSafe(m.message) ?? null,
    parent_tool_use_id: m.parent_tool_use_id ?? null
  }
}

/** Close the CLI of any live chat bound to an SDK session (before its transcript is deleted). */
async function detachLiveSessions(sessionId: string): Promise<void> {
  const bound = [...sessions.values()].filter((s) => s.getSessionId() === sessionId)
  await Promise.allSettled(bound.map((s) => s.forgetSession()))
}

function wrapError(action: string, err: unknown): Error {
  return new Error(`${action}: ${errorMessage(err)}`)
}

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function handle(channel: string, handler: Handler): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, handler)
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC
// ─────────────────────────────────────────────────────────────────────────────

export function registerAgentIpc(): void {
  handle(IPC.agentCreateChat, (_e, options) => createChat(options))

  handle(IPC.agentSend, (_e, chatId, message) => requireSession(chatId).send(message as OutgoingUserMessage))

  handle(IPC.agentInterrupt, async (_e, chatId) => {
    const session = sessions.get(requireString(chatId, 'chat id'))
    if (session) await session.interrupt()
  })

  handle(IPC.agentSetMode, (_e, chatId, modeId) => requireSession(chatId).setMode(requireString(modeId, 'mode id')))

  handle(IPC.agentSetPermission, (_e, chatId, policy) => requireSession(chatId).setPermission(policy as PermissionPolicy))

  handle(IPC.agentSetModel, (_e, chatId, model) =>
    requireSession(chatId).setModel(typeof model === 'string' ? model : '')
  )

  handle(IPC.agentSetEffort, (_e, chatId, effort) => requireSession(chatId).setEffort(effort as EffortLevel | 'auto'))

  handle(IPC.agentRespondPermission, async (_e, chatId, requestId, response) => {
    const session = sessions.get(requireString(chatId, 'chat id'))
    // The chat may already be gone; its pending prompts were denied when it closed.
    if (!session) return
    await session.respondPermission(requireString(requestId, 'request id'), response as PermissionResponse)
  })

  handle(IPC.agentRewind, (_e, chatId, userMessageUuid, dryRun) =>
    requireSession(chatId).rewind(requireString(userMessageUuid, 'message id'), dryRun === true)
  )

  handle(IPC.agentGetContextUsage, async (_e, chatId) => {
    const session = sessions.get(requireString(chatId, 'chat id'))
    return session ? session.getContextUsage() : null
  })

  handle(IPC.agentGetCapabilities, async (_e, chatId) => {
    const session = sessions.get(requireString(chatId, 'chat id'))
    return session ? session.getCapabilities() : null
  })

  handle(IPC.agentStopTask, (_e, chatId, taskId) => requireSession(chatId).stopTask(requireString(taskId, 'task id')))

  handle(IPC.agentMcpStatus, async (_e, chatId) => {
    const session = sessions.get(requireString(chatId, 'chat id'))
    return session ? session.mcpStatus() : []
  })

  handle(IPC.agentCloseChat, async (_e, chatId) => {
    const id = requireString(chatId, 'chat id')
    const session = sessions.get(id)
    if (!session) return
    sessions.delete(id)
    await session.close()
  })

  handle(IPC.agentListSessions, async (_e, workspace) => {
    const dir = requireString(workspace, 'workspace')
    try {
      const list = await listSessions({ dir, limit: SESSION_LIST_LIMIT, includeProgrammatic: true })
      return list
        .filter((s) => typeof s.sessionId === 'string' && s.sessionId)
        .map(toSessionSummary)
        .sort((a, b) => b.lastModified - a.lastModified)
    } catch (err) {
      throw wrapError('Could not list chat history', err)
    }
  })

  handle(IPC.agentLoadSession, async (_e, sessionId, workspace) => {
    const id = requireString(sessionId, 'session id')
    const dir = requireString(workspace, 'workspace')
    try {
      const messages = await getSessionMessages(id, { dir })
      return messages.map(toStoredMessage)
    } catch (err) {
      throw wrapError('Could not load the chat', err)
    }
  })

  handle(IPC.agentRenameSession, async (_e, sessionId, title, workspace) => {
    const id = requireString(sessionId, 'session id')
    const dir = requireString(workspace, 'workspace')
    const clean = requireString(title, 'title').trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE_LENGTH)
    try {
      await renameSession(id, clean, { dir })
    } catch (err) {
      throw wrapError('Could not rename the chat', err)
    }
  })

  handle(IPC.agentDeleteSession, async (_e, sessionId, workspace) => {
    const id = requireString(sessionId, 'session id')
    const dir = requireString(workspace, 'workspace')
    await detachLiveSessions(id)
    try {
      await deleteSession(id, { dir })
    } catch (err) {
      throw wrapError('Could not delete the chat', err)
    }
  })

  // Rules, custom modes and tool allow/deny lists apply to running chats once they are idle.
  unsubscribeSettings?.()
  unsubscribeSettings = settingsService.onChange(() => {
    for (const session of sessions.values()) session.onSettingsChanged()
  })
}
