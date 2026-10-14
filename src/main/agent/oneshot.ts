/**
 * One-shot AI helpers (docs/ARCHITECTURE.md §5): Cmd/Ctrl+K inline edits and commit-message
 * generation. Each request is a single-turn, tool-less `query()` against the user's Claude account
 * that never touches session history.
 */
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { ipcMain } from 'electron'
import { AbortError, USAGE_LIMIT_ERROR_PREFIXES, query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { IPC } from '../../shared/ipc'
import { normalizeModelValue } from '../../shared/modes'
import { relativePath } from '../../shared/paths'
import type { InlineEditDeltaEvent, InlineEditRequest, InlineEditResult } from '../../shared/types'
import { ctx } from '../context'
import { getAgentEnv } from '../services/auth'
import { createClaudeSpawner, resolveClaudeBinary } from '../services/claude-binary'
import { getRepoDiffForCommit } from '../services/git'
import { settingsService } from '../services/settings'

const DEFAULT_INLINE_MODEL = 'sonnet'
const DEFAULT_COMMIT_MODEL = 'haiku'
const INLINE_TIMEOUT_MS = 3 * 60_000
const COMMIT_TIMEOUT_MS = 2 * 60_000
const DELTA_THROTTLE_MS = 40
const MAX_SELECTION_CHARS = 60_000
const MAX_PREFIX_CHARS = 16_000
const MAX_SUFFIX_CHARS = 8_000
const MAX_INSTRUCTION_CHARS = 4_000
const MAX_COMMIT_SUBJECT = 72
const STDERR_TAIL_CHARS = 4_000

const INLINE_SYSTEM_PROMPT = [
  'You are the inline code editor inside ATOM Code. You receive part of a file, the user\'s selection in it and an instruction, and you rewrite the selection.',
  '',
  'Rules:',
  '- Output ONLY the replacement code for the selection: no markdown fences, no explanations, no commentary before or after.',
  '- Preserve indentation: keep the selection\'s base indentation level and the file\'s indentation style (tabs vs spaces, width). The first line of your output replaces the first line of the selection, including its leading whitespace.',
  '- Change only what the instruction asks for; keep everything else exactly as it was (names, comments, formatting).',
  '- The code before and after the selection is context only — never repeat it in your output.',
  '- If the selection is empty, output only the new code to insert at the cursor position.',
  '- Match the language, conventions and style of the surrounding file. Produce complete, working code — no placeholders like "..." or "rest of code".',
  '- If the instruction cannot be applied, output the selection unchanged.'
].join('\n')

const COMMIT_SYSTEM_PROMPT = [
  'You write git commit messages. Reply with ONLY the commit message: no code fences, no quotes, no preamble.',
  '',
  'Format (Conventional Commits):',
  '<type>(<optional scope>): <subject>',
  '',
  '<optional body>',
  '',
  '- type: one of feat, fix, refactor, perf, docs, test, build, ci, chore, style, revert.',
  '- scope: a short noun for the affected area when it is obvious (e.g. auth, editor, api); omit it otherwise.',
  `- subject: imperative mood ("add", not "added"), lowercase first word, no trailing period, at most ${MAX_COMMIT_SUBJECT} characters including the type prefix.`,
  '- Add a body (after one blank line, wrapped at 72 characters) only when the change is not obvious from the subject: explain what changed and why, as short sentences or "- " bullets.',
  '- Describe only what the diff actually shows; never invent motivation, tickets or details. Write one message for the whole diff.'
].join('\n')

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Remove a markdown fence the model wrapped its answer in. While streaming (`partial`), an opening
 * fence line that is not complete yet hides the text so the user never sees ``` flash by.
 */
export function stripCodeFences(text: string, partial = false): string {
  const lead = /^\s*(`{3,}|~{3,})[^\n`]*\n/.exec(text)
  if (!lead) {
    if (partial && /^\s*(`{1,3}|~{1,3})[^\n`]*$/.test(text)) return ''
    return text
  }
  let body = text.slice(lead[0].length)
  const fence = lead[1]
  const closing = new RegExp(`\\n?${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*\\n?\\s*$`)
  body = body.replace(closing, '')
  if (partial) body = body.replace(/\n?[`~]{1,3}$/, '')
  return body
}

/** Make the replacement end with a newline exactly when the original selection did. */
export function matchTrailingNewline(replacement: string, selection: string): string {
  if (!selection) return replacement
  const wantsNewline = /\r?\n$/.test(selection)
  const eol = selection.endsWith('\r\n') ? '\r\n' : '\n'
  if (wantsNewline && !/\n$/.test(replacement)) return replacement + eol
  if (!wantsNewline) return replacement.replace(/\r?\n$/, '')
  return replacement
}

/** Clean a generated commit message: no fences/quotes/labels, subject ≤ 72 chars, tidy blank lines. */
export function normalizeCommitMessage(text: string): string {
  let msg = stripCodeFences(text.trim()).trim()
  msg = msg.replace(/^(?:commit message|message)\s*:\s*/i, '')
  if (/^(["'`]).*\1$/s.test(msg)) msg = msg.slice(1, -1).trim()
  const lines = msg.replace(/\r\n/g, '\n').split('\n')
  let subject = (lines.shift() ?? '').trim().replace(/\.+$/, '')
  if (subject.length > MAX_COMMIT_SUBJECT) {
    const cut = subject.slice(0, MAX_COMMIT_SUBJECT + 1)
    const space = cut.lastIndexOf(' ')
    subject = (space > MAX_COMMIT_SUBJECT / 2 ? cut.slice(0, space) : subject.slice(0, MAX_COMMIT_SUBJECT)).replace(/[\s,;:-]+$/, '')
  }
  const body = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return body ? `${subject}\n\n${body}` : subject
}

function clip(text: string, max: number, keep: 'start' | 'end'): string {
  if (text.length <= max) return text
  return keep === 'end' ? text.slice(text.length - max) : text.slice(0, max)
}

/** Build the user prompt for an inline edit. */
export function buildInlineEditPrompt(req: Pick<InlineEditRequest, 'workspace' | 'filePath' | 'language' | 'instruction' | 'selection' | 'prefix' | 'suffix'>): string {
  const rel = req.workspace ? relativePath(req.workspace, req.filePath) : req.filePath
  const prefix = clip(req.prefix, MAX_PREFIX_CHARS, 'end')
  const suffix = clip(req.suffix, MAX_SUFFIX_CHARS, 'start')
  const parts = [
    `File: ${rel || req.filePath}`,
    `Language: ${req.language || 'plaintext'}`,
    `Instruction: ${req.instruction.trim()}`,
    '',
    '<code_before_selection>',
    prefix,
    '</code_before_selection>'
  ]
  if (req.selection) parts.push('<selection>', req.selection, '</selection>')
  else parts.push('<selection/>', '(The selection is empty: generate the code to insert at the cursor, which sits between the two context blocks.)')
  parts.push('<code_after_selection>', suffix, '</code_after_selection>', '')
  parts.push(
    req.selection
      ? 'Reply with the replacement for <selection> only — raw code, no fences, no explanation.'
      : 'Reply with the code to insert only — raw code, no fences, no explanation.'
  )
  return parts.join('\n')
}

const AUTH_PATTERNS = [
  /authentication_failed/i,
  /\b401\b/,
  /invalid api key/i,
  /invalid (?:bearer|x-api-key)/i,
  /not logged in/i,
  /please run \/login/i,
  /oauth token (?:has )?(?:expired|been revoked)/i,
  /credit balance is too low/i
]

/** Turn raw CLI/API error text into a message the user can act on. */
export function friendlyAiError(text: string, code: string | undefined, model: string): string {
  const raw = text.trim()
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^(?:API Error:\s*|Error:\s*)/i, ''))
    .filter(Boolean)
  const usage = lines.find((l) => USAGE_LIMIT_ERROR_PREFIXES.some((p) => l.startsWith(p)))
  if (usage) return usage
  if (/credit balance is too low/i.test(raw)) return 'Your Anthropic API credit balance is too low. Add credits in the Anthropic Console or sign in with your Claude subscription.'
  if (code === 'authentication_failed' || code === 'oauth_org_not_allowed' || AUTH_PATTERNS.some((re) => re.test(raw))) {
    return 'You are not signed in to Claude, or your sign-in expired. Sign in from Settings → Account and try again.'
  }
  if (code === 'billing_error') return 'There is a billing problem with your Claude account.'
  if (code === 'model_not_found' || /model[^\n]*(?:not found|not available|does not exist)/i.test(raw)) {
    return `The model "${model}" is not available for your account. Choose another model in Settings → Models & Agent.`
  }
  if (code === 'rate_limit' || /\b429\b|rate[_ ]limit/i.test(raw)) return 'Claude is rate limiting requests right now. Wait a moment and try again.'
  if (code === 'overloaded' || /\b529\b|overloaded/i.test(raw)) return 'Claude is overloaded right now. Try again in a moment.'
  if (/native binary not found|executable not found|\bENOENT\b|\bEACCES\b|failed to launch|spawn/i.test(raw)) {
    return `Claude Code could not be started (${lines[0] ?? 'unknown error'}). Check the Claude Code executable in Settings → Models & Agent.`
  }
  return (lines.join('\n') || 'Claude returned an error without details.').slice(0, 800)
}

function textBlocks(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((b) => (isRecord(b) && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('')
}

function isAbortError(err: unknown): boolean {
  return err instanceof AbortError || (err instanceof Error && err.name === 'AbortError')
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  return typeof err === 'string' ? err : String(err)
}

function existingDir(...candidates: (string | undefined)[]): string {
  for (const c of candidates) {
    if (!c) continue
    try {
      if (statSync(c).isDirectory()) return c
    } catch {
      /* try the next one */
    }
  }
  return homedir()
}

// ─────────────────────────────────────────────────────────────────────────────
// The single-turn query runner
// ─────────────────────────────────────────────────────────────────────────────

class OneShotCancelledError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'OneShotCancelledError'
  }
}

interface OneShotParams {
  prompt: string
  systemPrompt: string
  model: string
  cwd: string
  controller: AbortController
  timeoutMs: number
  /** Called with the accumulated streamed text. */
  onText?: (accumulated: string) => void
}

async function runOneShot(params: OneShotParams): Promise<string> {
  const { controller } = params
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, params.timeoutMs)

  let stderrTail = ''
  const onStderr = (data: string): void => {
    stderrTail = (stderrTail + data).slice(-STDERR_TAIL_CHARS)
  }
  const claudeBinary = resolveClaudeBinary()
  // `.js` entry points and unresolvable Windows `.cmd` shims cannot be spawned by the SDK itself.
  const spawnClaudeCodeProcess = createClaudeSpawner(claudeBinary, onStderr)
  const options: Options = {
    abortController: controller,
    cwd: params.cwd,
    pathToClaudeCodeExecutable: claudeBinary ?? undefined,
    ...(spawnClaudeCodeProcess ? { spawnClaudeCodeProcess } : {}),
    env: getAgentEnv(),
    tools: [],
    settingSources: [],
    persistSession: false,
    maxTurns: 1,
    systemPrompt: params.systemPrompt,
    model: params.model,
    includePartialMessages: true,
    permissionMode: 'dontAsk',
    thinking: { type: 'disabled' },
    mcpServers: {},
    strictMcpConfig: true,
    stderr: onStderr
  }

  let streamed = ''
  let assistantText = ''
  let assistantId: string | undefined
  let resultText: string | undefined
  let failure: { text: string; code?: string } | undefined

  const handle = (msg: SDKMessage): void => {
    switch (msg.type) {
      case 'stream_event': {
        if (msg.parent_tool_use_id) return
        const ev = msg.event
        if (ev.type === 'message_start') {
          streamed = '' // a retried request starts over
        } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          streamed += ev.delta.text
          params.onText?.(streamed)
        }
        return
      }
      case 'assistant': {
        if (msg.parent_tool_use_id) return
        const text = textBlocks(msg.message.content)
        if (msg.error) {
          failure ??= { text: text || msg.error, code: msg.error }
          return
        }
        if (msg.message.id !== assistantId) {
          assistantId = msg.message.id
          assistantText = ''
        }
        assistantText += text
        return
      }
      case 'result': {
        if (msg.subtype === 'success') {
          if (msg.is_error) failure ??= { text: msg.result }
          else resultText = msg.result
        } else {
          failure ??= { text: msg.errors.join('\n') || `The request ended early (${msg.subtype}).` }
        }
        return
      }
      case 'auth_status': {
        if (msg.error) failure ??= { text: msg.error, code: 'authentication_failed' }
        return
      }
      default:
        return
    }
  }

  const q = query({ prompt: params.prompt, options })
  try {
    for await (const msg of q) handle(msg)
  } catch (err) {
    if (controller.signal.aborted || isAbortError(err)) {
      if (timedOut) throw new Error(`Claude did not finish within ${Math.round(params.timeoutMs / 1000)}s. Try again.`)
      throw new OneShotCancelledError()
    }
    failure ??= { text: [errorMessage(err), stderrTail.trim()].filter(Boolean).join('\n') }
  } finally {
    clearTimeout(timer)
    try {
      q.close()
    } catch {
      /* already finished */
    }
  }

  if (controller.signal.aborted && !failure && resultText === undefined) {
    if (timedOut) throw new Error(`Claude did not finish within ${Math.round(params.timeoutMs / 1000)}s. Try again.`)
    throw new OneShotCancelledError()
  }
  if (failure) throw new Error(friendlyAiError(failure.text || stderrTail, failure.code, params.model))
  const text = resultText?.trim() ? resultText : assistantText || streamed
  return text
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline edit
// ─────────────────────────────────────────────────────────────────────────────

const inlineControllers = new Map<string, AbortController>()

function parseInlineRequest(value: unknown): InlineEditRequest {
  if (!isRecord(value)) throw new Error('Invalid inline edit request.')
  const s = (key: string): string => (typeof value[key] === 'string' ? (value[key] as string) : '')
  const req: InlineEditRequest = {
    requestId: s('requestId'),
    workspace: s('workspace'),
    filePath: s('filePath'),
    language: s('language'),
    instruction: s('instruction'),
    selection: s('selection'),
    prefix: s('prefix'),
    suffix: s('suffix'),
    model: typeof value.model === 'string' ? value.model : undefined
  }
  if (!req.requestId) throw new Error('Inline edit request is missing its requestId.')
  return req
}

async function inlineEdit(value: unknown): Promise<InlineEditResult> {
  const req = parseInlineRequest(value)
  const instruction = req.instruction.trim()
  if (!instruction) return { requestId: req.requestId, text: '', error: 'Describe the change you want first.' }
  if (instruction.length > MAX_INSTRUCTION_CHARS) return { requestId: req.requestId, text: '', error: 'The instruction is too long.' }
  if (req.selection.length > MAX_SELECTION_CHARS) {
    return {
      requestId: req.requestId,
      text: '',
      error: `The selection is too large for an inline edit (${Math.round(req.selection.length / 1000)}k characters; max ${MAX_SELECTION_CHARS / 1000}k). Use the agent instead.`
    }
  }

  inlineControllers.get(req.requestId)?.abort()
  const controller = new AbortController()
  inlineControllers.set(req.requestId, controller)

  const selectionHasFence = /^\s*(?:`{3,}|~{3,})/.test(req.selection)
  const model = normalizeModelValue(req.model) || normalizeModelValue(settingsService.get().agent.inlineEditModel) || DEFAULT_INLINE_MODEL
  let lastSent = ''
  let pendingText: string | null = null
  let deltaTimer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    deltaTimer = null
    if (pendingText === null || controller.signal.aborted) return
    const text = pendingText
    pendingText = null
    if (text === lastSent) return
    lastSent = text
    const event: InlineEditDeltaEvent = { requestId: req.requestId, text }
    ctx.send(IPC.aiInlineEditDeltaEvent, event)
  }

  try {
    const raw = await runOneShot({
      prompt: buildInlineEditPrompt({ ...req, instruction }),
      systemPrompt: INLINE_SYSTEM_PROMPT,
      model,
      cwd: existingDir(req.workspace, req.filePath ? dirname(req.filePath) : undefined),
      controller,
      timeoutMs: INLINE_TIMEOUT_MS,
      onText: (accumulated) => {
        pendingText = selectionHasFence ? accumulated : stripCodeFences(accumulated, true)
        if (!deltaTimer) deltaTimer = setTimeout(flush, DELTA_THROTTLE_MS)
      }
    })
    // Markdown selections may legitimately start with a fence: only strip fences the model added.
    const cleaned = selectionHasFence ? raw : stripCodeFences(raw)
    const text = matchTrailingNewline(cleaned, req.selection)
    return { requestId: req.requestId, text }
  } catch (err) {
    if (err instanceof OneShotCancelledError) return { requestId: req.requestId, text: '', error: 'Cancelled' }
    return { requestId: req.requestId, text: '', error: errorMessage(err) }
  } finally {
    if (deltaTimer) clearTimeout(deltaTimer)
    if (inlineControllers.get(req.requestId) === controller) inlineControllers.delete(req.requestId)
  }
}

function cancelInlineEdit(requestId: unknown): void {
  if (typeof requestId !== 'string') return
  inlineControllers.get(requestId)?.abort()
}

// ─────────────────────────────────────────────────────────────────────────────
// Commit message
// ─────────────────────────────────────────────────────────────────────────────

const commitInflight = new Map<string, Promise<string>>()

async function generateCommitMessage(root: unknown): Promise<string> {
  if (typeof root !== 'string' || !root.trim()) throw new Error('No repository is open.')
  const existing = commitInflight.get(root)
  if (existing) return existing
  const run = (async () => {
    const diff = await getRepoDiffForCommit(root)
    if (!diff.trim()) return ''
    const model = normalizeModelValue(settingsService.get().agent.commitMessageModel) || DEFAULT_COMMIT_MODEL
    const raw = await runOneShot({
      prompt: `Write the commit message for this diff:\n\n<diff>\n${diff}\n</diff>`,
      systemPrompt: COMMIT_SYSTEM_PROMPT,
      model,
      cwd: existingDir(root),
      controller: new AbortController(),
      timeoutMs: COMMIT_TIMEOUT_MS
    })
    const message = normalizeCommitMessage(raw)
    if (!message) throw new Error('Claude returned an empty commit message. Try again.')
    return message
  })()
  commitInflight.set(root, run)
  try {
    return await run
  } catch (err) {
    if (err instanceof OneShotCancelledError) throw new Error('Commit message generation was cancelled.')
    throw err
  } finally {
    commitInflight.delete(root)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC
// ─────────────────────────────────────────────────────────────────────────────

export function registerAiIpc(): void {
  ipcMain.handle(IPC.aiInlineEdit, (_e, request: unknown) => inlineEdit(request))
  ipcMain.handle(IPC.aiCancelInlineEdit, (_e, requestId: unknown) => cancelInlineEdit(requestId))
  ipcMain.handle(IPC.aiCommitMessage, (_e, root: unknown) => generateCommitMessage(root))
}

/** Abort every running one-shot request (app quit). */
export function disposeAi(): void {
  for (const controller of inlineControllers.values()) controller.abort()
  inlineControllers.clear()
}
