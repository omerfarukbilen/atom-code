/**
 * Authentication — Claude subscription, long-lived OAuth token or API key (docs/ARCHITECTURE.md §4).
 *
 * ATOM Code never implements OAuth itself: it drives the official Claude Code CLI bundled with the
 * Agent SDK (`claude auth status|login|logout`, `claude setup-token`) and keeps optional credentials of
 * its own (API key / OAuth token) through `settingsService` (encrypted with the OS keyring when one is available).
 * Secrets are never logged.
 */
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { app, ipcMain, shell } from 'electron'
import type * as NodePty from 'node-pty'
import { IPC } from '../../shared/ipc'
import type { AuthMethod, AuthStatus, LoginExitEvent, LoginMode, LoginOutputEvent, SecretStorageInfo } from '../../shared/types'
import { ctx } from '../context'
import { buildClaudeCommand, getClaudeVersion, resolveClaudeBinary } from './claude-binary'
import { ensurePtySpawnHelperExecutable } from './pty-helper'
import { settingsService } from './settings'
import { stripAnsi } from './terminal'

const STATUS_TTL_MS = 30_000
const CLI_TIMEOUT_MS = 15_000
const LOGIN_COLS = 100
const LOGIN_ROWS = 30
const LOGIN_TRANSCRIPT_CHARS = 256 * 1024
const MAX_LOGIN_INPUT_CHARS = 64 * 1024
const MAX_SECRET_CHARS = 4096
/** Let trailing PTY output (e.g. the setup-token line) arrive before the exit is processed. */
const EXIT_SETTLE_MS = 200

const LOGIN_ARGS: Record<LoginMode, string[]> = {
  claudeai: ['auth', 'login', '--claudeai'],
  console: ['auth', 'login', '--console'],
  'setup-token': ['setup-token']
}

const NOT_FOUND_MESSAGE =
  'Claude Code was not found. Reinstall ATOM Code, or choose a Claude Code executable in Settings → Models & Agent.'

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  return typeof err === 'string' ? err : String(err)
}

function firstMeaningfulLine(text: string): string {
  return (
    stripAnsi(text)
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ''
  ).slice(0, 500)
}

function isLoginMode(value: unknown): value is LoginMode {
  return value === 'claudeai' || value === 'console' || value === 'setup-token'
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment for Claude Code processes
// ─────────────────────────────────────────────────────────────────────────────

function clientAppId(): string {
  return process.env.CLAUDE_AGENT_SDK_CLIENT_APP || `atom-code/${app.getVersion()}`
}

/** `process.env` minus Electron's node-mode switch, plus the SDK client identifier. No stored secrets. */
function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') continue
    env[key] = value
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = clientAppId()
  return env
}

/**
 * Environment for every Claude Code process ATOM Code starts (agent sessions, one-shot helpers, status
 * probes). A stored API key wins over a stored OAuth token; with neither, the CLI's own login
 * (`~/.claude`) applies. The stored credential also replaces a competing one inherited from the shell
 * so the user's explicit in-app choice is what Claude Code uses.
 */
export function getAgentEnv(): Record<string, string> {
  const env = baseEnv()
  const apiKey = settingsService.getSecret('anthropicApiKey')
  const oauthToken = settingsService.getSecret('claudeOAuthToken')
  if (apiKey) {
    env.ANTHROPIC_API_KEY = apiKey
    delete env.CLAUDE_CODE_OAUTH_TOKEN
  } else if (oauthToken) {
    env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken
    delete env.ANTHROPIC_API_KEY
  }
  return env
}

/** Environment for the interactive login flows: no stored credentials (they would shadow the login), BROWSER unset. */
function loginEnv(): Record<string, string> {
  const env = baseEnv()
  delete env.BROWSER
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  if (process.platform !== 'win32' && !env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LANG = 'en_US.UTF-8'
  return env
}

// ─────────────────────────────────────────────────────────────────────────────
// Running the CLI
// ─────────────────────────────────────────────────────────────────────────────

export interface CliRunResult {
  stdout: string
  stderr: string
  /** Process exit code; null when it could not be started, was killed or timed out. */
  exitCode: number | null
  timedOut: boolean
  /** Set when the process could not be started at all (ENOENT, EACCES…). */
  spawnError?: string
}

function runClaude(bin: string, args: string[], env: Record<string, string>, timeoutMs = CLI_TIMEOUT_MS): Promise<CliRunResult> {
  const cmd = buildClaudeCommand(bin, args, env)
  return new Promise((resolve) => {
    try {
      execFile(
        cmd.file,
        cmd.args,
        { env: cmd.env, shell: cmd.shell, cwd: homedir(), timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout, stderr) => {
          const out = String(stdout ?? '')
          const errOut = String(stderr ?? '')
          if (!err) {
            resolve({ stdout: out, stderr: errOut, exitCode: 0, timedOut: false })
            return
          }
          // Non-zero exit → numeric `code`; timeout → `killed`; spawn failure → string `code` (ENOENT…).
          const e: { code?: unknown; killed?: unknown; signal?: unknown } = err
          if (typeof e.code === 'number') {
            resolve({ stdout: out, stderr: errOut, exitCode: e.code, timedOut: false })
          } else if (e.killed === true || typeof e.signal === 'string') {
            resolve({ stdout: out, stderr: errOut, exitCode: null, timedOut: e.killed === true })
          } else {
            resolve({ stdout: out, stderr: errOut, exitCode: null, timedOut: false, spawnError: errorMessage(err) })
          }
        }
      )
    } catch (err) {
      resolve({ stdout: '', stderr: '', exitCode: null, timedOut: false, spawnError: errorMessage(err) })
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Status parsing (pure, exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a JSON object from CLI output, tolerating log lines before/after it. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const attempts = [trimmed]
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start > 0 || (end !== -1 && end < trimmed.length - 1)) {
    if (start !== -1 && end > start) attempts.push(trimmed.slice(start, end + 1))
  }
  for (const attempt of attempts) {
    try {
      const parsed: unknown = JSON.parse(attempt)
      if (isRecord(parsed)) return parsed
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/** Map the CLI's `authMethod` / `apiProvider` / `apiKeySource` to ATOM Code's AuthMethod (for a logged-in account). */
export function mapAuthMethod(authMethod: string | undefined, apiProvider: string | undefined, apiKeySource?: string): AuthMethod {
  if (apiProvider && !/^first[\s_-]?party$/i.test(apiProvider)) return 'third-party'
  if (apiKeySource === '/login managed key') return 'console'
  const m = (authMethod ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  switch (m) {
    case 'claude.ai':
    case 'claudeai':
    case 'claude_ai':
    case 'oauth':
    case 'subscription':
    case 'claude_subscription':
      return 'claude-subscription'
    case 'oauth_token':
    case 'oauthtoken':
    case 'token':
    case 'long_lived_token':
      return 'oauth-token'
    case 'api_key':
    case 'apikey':
    case 'api_key_helper':
    case 'apikeyhelper':
      return 'api-key'
    case 'console':
    case 'console_oauth':
      return 'console'
    case 'bedrock':
    case 'vertex':
    case 'foundry':
    case 'third_party':
    case 'thirdparty':
      return 'third-party'
    default:
      return apiKeySource && apiKeySource !== 'none' ? 'api-key' : 'claude-subscription'
  }
}

export type ParsedAuthStatus = Pick<AuthStatus, 'loggedIn' | 'method' | 'email' | 'organization' | 'subscriptionType' | 'apiProvider' | 'error'>

/** Interpret the result of `claude auth status --json`. Never throws. */
export function interpretAuthStatus(run: CliRunResult): ParsedAuthStatus {
  const parsed = parseJsonObject(run.stdout)
  if (!parsed) {
    if (run.spawnError) return { loggedIn: false, method: 'none', error: `Could not start Claude Code: ${run.spawnError}` }
    if (run.timedOut) {
      return { loggedIn: false, method: 'none', error: `Claude Code did not report the sign-in status within ${CLI_TIMEOUT_MS / 1000}s.` }
    }
    const detail = firstMeaningfulLine(run.stderr) || firstMeaningfulLine(run.stdout)
    return {
      loggedIn: false,
      method: 'none',
      error:
        detail ||
        (run.exitCode === 0 || run.exitCode === null
          ? 'Claude Code returned an unreadable sign-in status.'
          : `"claude auth status" exited with code ${run.exitCode}.`)
    }
  }

  const loggedIn = parsed.loggedIn === true || parsed.loggedIn === 'true'
  const account = isRecord(parsed.account) ? parsed.account : {}
  const apiProvider = str(parsed.apiProvider) ?? str(parsed.api_provider)
  const apiKeySource = str(parsed.apiKeySource) ?? str(parsed.api_key_source)
  const authMethod = str(parsed.authMethod) ?? str(parsed.auth_method)
  const email = str(parsed.email) ?? str(parsed.emailAddress) ?? str(account.email) ?? str(account.emailAddress)
  const organization =
    str(parsed.orgName) ?? str(parsed.organization) ?? str(parsed.organizationName) ?? str(account.orgName) ?? str(account.organizationName)
  const subscriptionType = str(parsed.subscriptionType) ?? str(parsed.subscription) ?? str(account.subscriptionType)

  if (!loggedIn) {
    const error = str(parsed.error) ?? str(parsed.message) ?? (firstMeaningfulLine(run.stderr) || undefined)
    return { loggedIn: false, method: 'none', apiProvider, error }
  }
  return {
    loggedIn: true,
    method: mapAuthMethod(authMethod, apiProvider, apiKeySource),
    email,
    organization,
    subscriptionType,
    apiProvider
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Login output scanning (pure, exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:claude\.ai|claude\.com|anthropic\.com)$/i
const AUTH_PATH_RE = /oauth|authorize|login/i
const OSC8_RE = /\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]+)(?:\x07|\x1b\\)/g
const URL_CHARS_RE = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/
const PLAIN_URL_RE = /https:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g
const TOKEN_RE = /sk-ant-oat[0-9A-Za-z_-]+/g
const TOKEN_CHARS_RE = /^[0-9A-Za-z_-]+$/
const MIN_TOKEN_LENGTH = 40
const MAX_TOKEN_LENGTH = 400

function isAuthUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' && AUTH_HOST_RE.test(url.hostname) && AUTH_PATH_RE.test(url.pathname + url.search)
  } catch {
    return false
  }
}

/**
 * Hard-wrapped terminal output: if a match ends exactly at the end of a line that (nearly) fills the
 * terminal width, keep appending following lines made only of `chars`.
 */
function joinWrapped(lines: string[], lineIndex: number, matchEnd: number, initial: string, chars: RegExp, cols: number): string {
  let value = initial
  const line = lines[lineIndex]
  if (matchEnd !== line.trimEnd().length || line.trimEnd().length < cols - 8) return value
  for (let j = lineIndex + 1; j < lines.length; j++) {
    const next = lines[j].trim()
    if (!next || !chars.test(next)) break
    value += next
    if (lines[j].trimEnd().length < cols - 8) break // this continuation line did not fill the width: the value ends here
  }
  return value
}

/**
 * Find the sign-in URL in raw login output. Prefers OSC 8 hyperlinks (the CLI emits them with the full,
 * unwrapped URL), then falls back to visible text with wrapped lines re-joined.
 */
export function findAuthUrl(raw: string, cols = LOGIN_COLS): string | null {
  for (const match of raw.matchAll(OSC8_RE)) {
    const url = match[1].trim()
    if (isAuthUrl(url)) return url
  }
  const lines = stripAnsi(raw).split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const match of lines[i].matchAll(PLAIN_URL_RE)) {
      const url = joinWrapped(lines, i, (match.index ?? 0) + match[0].length, match[0], URL_CHARS_RE, cols)
      if (isAuthUrl(url)) return url
    }
  }
  return null
}

/**
 * Find the long-lived OAuth token printed by `claude setup-token` in ANSI-stripped output. The token is
 * longer than the terminal is wide, so wrapped continuation lines are re-joined. Returns the longest
 * plausible candidate (the transcript may contain partial re-renders), or null.
 */
export function extractOAuthToken(plain: string, cols = LOGIN_COLS): string | null {
  const lines = plain.split('\n')
  let best: string | null = null
  for (let i = 0; i < lines.length; i++) {
    for (const match of lines[i].matchAll(TOKEN_RE)) {
      const token = joinWrapped(lines, i, (match.index ?? 0) + match[0].length, match[0], TOKEN_CHARS_RE, cols)
      if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) continue
      if (!best || token.length > best.length) best = token
    }
  }
  return best
}

/** Clean a pasted secret: trims, drops `export NAME=` prefixes and surrounding quotes. '' → null. */
export function normalizeSecretInput(value: unknown, varNames: string[]): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error('Expected a string.')
  let v = value.trim()
  for (const name of varNames) {
    const re = new RegExp(`^(?:export\\s+|set\\s+|\\$env:)?${name}\\s*=\\s*`, 'i')
    v = v.replace(re, '')
  }
  v = v.replace(/^["'](.*)["']$/s, '$1').trim()
  return v || null
}

// ─────────────────────────────────────────────────────────────────────────────
// Status cache
// ─────────────────────────────────────────────────────────────────────────────

let cachedStatus: AuthStatus | null = null
let inflight: { generation: number; promise: Promise<AuthStatus> } | null = null
let generation = 0
let lastBroadcastKey = ''

function invalidateAuthStatus(): void {
  generation++
  cachedStatus = null
}

function statusKey(s: AuthStatus): string {
  return JSON.stringify([
    s.loggedIn,
    s.method,
    s.email,
    s.organization,
    s.subscriptionType,
    s.apiProvider,
    s.claudeBinary,
    s.claudeVersion,
    s.hasStoredApiKey,
    s.hasStoredOAuthToken,
    s.secretStorage,
    s.error
  ])
}

/** Stored-credential fields of AuthStatus: what ATOM Code holds and how it is stored. */
function storedCredentials(): Pick<AuthStatus, 'hasStoredApiKey' | 'hasStoredOAuthToken' | 'secretStorage'> {
  const state = settingsService.getSecretStorageState()
  const secretStorage: SecretStorageInfo = { encrypted: state.encrypted, file: state.file }
  if (state.backend) secretStorage.backend = state.backend
  const locked = state.locked.map((n) => (n === 'anthropicApiKey' ? ('apiKey' as const) : ('oauthToken' as const)))
  if (locked.length > 0) secretStorage.locked = locked
  return {
    hasStoredApiKey: Boolean(settingsService.getSecret('anthropicApiKey')),
    hasStoredOAuthToken: Boolean(settingsService.getSecret('claudeOAuthToken')),
    secretStorage
  }
}

/** Explain a sign-in failure caused by a saved credential the keyring of this session cannot decrypt. */
function withLockedSecretHint(status: AuthStatus): AuthStatus {
  const locked = status.secretStorage?.locked
  if (status.loggedIn || !locked || locked.length === 0) return status
  const what = locked.length > 1 ? 'API key and OAuth token are' : locked[0] === 'apiKey' ? 'API key is' : 'OAuth token is'
  const hint =
    `Your saved ${what} encrypted with the system keyring, which is not available in this session. ` +
    'Unlock or start the keyring (e.g. GNOME Keyring / KWallet) and restart ATOM Code, or enter it again.'
  return { ...status, error: status.error ? `${hint}\n${status.error}` : hint }
}

function broadcast(status: AuthStatus, force: boolean): void {
  const key = statusKey(status)
  if (!force && key === lastBroadcastKey) return
  lastBroadcastKey = key
  ctx.send(IPC.authStatusEvent, status)
}

async function probeAuthStatus(): Promise<AuthStatus> {
  const stored = storedCredentials()
  const bin = resolveClaudeBinary()
  if (!bin) {
    return { loggedIn: false, method: 'none', claudeBinary: null, ...stored, error: NOT_FOUND_MESSAGE, checkedAt: Date.now() }
  }
  const [claudeVersion, run] = await Promise.all([getClaudeVersion(bin), runClaude(bin, ['auth', 'status', '--json'], getAgentEnv())])
  return withLockedSecretHint({ ...interpretAuthStatus(run), claudeBinary: bin, claudeVersion, ...stored, checkedAt: Date.now() })
}

/** Fill in email / plan / organization from a live agent session's `accountInfo()` when the CLI omitted them. */
async function enrichStatus(status: AuthStatus): Promise<AuthStatus> {
  if (!status.loggedIn || status.method === 'third-party' || status.method === 'api-key') return status
  if (status.email && status.subscriptionType && status.organization) return status
  try {
    // Lazy import: the agent manager depends on this module (getAgentEnv).
    const { getCachedAccountInfo } = await import('../agent/manager')
    const info = getCachedAccountInfo()
    if (!info) return status
    return {
      ...status,
      email: status.email ?? str(info.email),
      organization: status.organization ?? str(info.organization),
      subscriptionType: status.subscriptionType ?? str(info.subscriptionType)
    }
  } catch {
    return status
  }
}

async function clearAccountInfo(): Promise<void> {
  try {
    const { clearCachedAccountInfo } = await import('../agent/manager')
    clearCachedAccountInfo()
  } catch {
    /* manager unavailable — nothing cached to clear */
  }
}

/**
 * The account or stored credential changed. Running agent CLIs captured their environment (API key /
 * OAuth token) when they were spawned, so they are relaunched — with resume, once idle — to use it.
 */
async function credentialsChanged(): Promise<void> {
  await clearAccountInfo()
  try {
    const { restartChatsForNewCredentials } = await import('../agent/manager')
    restartChatsForNewCredentials()
  } catch {
    /* manager unavailable — no chats to restart */
  }
}

/** Cached or freshly probed status; `current` is false when credentials changed while probing. */
async function loadStatus(refresh: boolean): Promise<{ status: AuthStatus; current: boolean }> {
  if (!refresh && cachedStatus && Date.now() - cachedStatus.checkedAt < STATUS_TTL_MS) {
    return { status: await enrichStatus(cachedStatus), current: false }
  }
  let entry = inflight && inflight.generation === generation ? inflight : null
  if (!entry) {
    const gen = generation
    const promise = probeAuthStatus()
    entry = { generation: gen, promise }
    inflight = entry
    promise
      .then((status) => {
        if (gen === generation) cachedStatus = status
      })
      .catch(() => undefined)
      .finally(() => {
        if (inflight?.promise === promise) inflight = null
      })
  }
  let status: AuthStatus
  try {
    status = await entry.promise
  } catch (err) {
    status = {
      loggedIn: false,
      method: 'none',
      claudeBinary: resolveClaudeBinary(),
      ...storedCredentials(),
      error: `Could not check the sign-in status: ${errorMessage(err)}`,
      checkedAt: Date.now()
    }
  }
  return { status: await enrichStatus(status), current: entry.generation === generation }
}

/**
 * Current authentication status. Cached for 30 s unless `refresh` is true; concurrent calls share one
 * probe. Changes are broadcast on `IPC.authStatusEvent`.
 */
export async function getAuthStatus(refresh = false): Promise<AuthStatus> {
  const { status, current } = await loadStatus(refresh)
  if (current) broadcast(status, false)
  return status
}

/** Drop the cache, re-probe and always broadcast the fresh status (after login/logout/credential changes). */
async function refreshAndBroadcast(): Promise<AuthStatus> {
  invalidateAuthStatus()
  const { status } = await loadStatus(true)
  broadcast(status, true)
  return status
}

// ─────────────────────────────────────────────────────────────────────────────
// Stored credentials
// ─────────────────────────────────────────────────────────────────────────────

function validateSecret(value: string, label: string): void {
  if (/\s/.test(value)) throw new Error(`The ${label} must not contain spaces or line breaks.`)
  if (value.length < 16) throw new Error(`That ${label} looks too short. Paste the complete value.`)
  if (value.length > MAX_SECRET_CHARS) throw new Error(`That ${label} is too long.`)
}

async function setApiKey(input: unknown): Promise<AuthStatus> {
  const key = normalizeSecretInput(input, ['ANTHROPIC_API_KEY'])
  if (key) {
    validateSecret(key, 'API key')
    if (key.startsWith('sk-ant-oat')) {
      throw new Error('This looks like a long-lived OAuth token (sk-ant-oat…), not an API key. Use "Long-lived token" instead.')
    }
  }
  await settingsService.setSecret('anthropicApiKey', key)
  // The last credential the user chose wins: a new key replaces a stored token.
  if (key && settingsService.getSecret('claudeOAuthToken')) await settingsService.setSecret('claudeOAuthToken', null)
  await credentialsChanged()
  return refreshAndBroadcast()
}

async function setOAuthToken(input: unknown): Promise<AuthStatus> {
  const token = normalizeSecretInput(input, ['CLAUDE_CODE_OAUTH_TOKEN'])
  if (token) {
    validateSecret(token, 'token')
    if (token.startsWith('sk-ant-api')) {
      throw new Error('This looks like an Anthropic API key (sk-ant-api…), not an OAuth token. Use "API key" instead.')
    }
  }
  await storeOAuthToken(token)
  await credentialsChanged()
  return refreshAndBroadcast()
}

async function storeOAuthToken(token: string | null): Promise<void> {
  await settingsService.setSecret('claudeOAuthToken', token)
  if (token && settingsService.getSecret('anthropicApiKey')) await settingsService.setSecret('anthropicApiKey', null)
}

async function clearStoredCredentials(): Promise<void> {
  if (settingsService.getSecret('anthropicApiKey')) await settingsService.setSecret('anthropicApiKey', null)
  if (settingsService.getSecret('claudeOAuthToken')) await settingsService.setSecret('claudeOAuthToken', null)
}

async function logout(): Promise<AuthStatus> {
  cancelAllLogins()
  const bin = resolveClaudeBinary()
  let cliProblem: string | undefined
  if (bin) {
    const run = await runClaude(bin, ['auth', 'logout'], baseEnv())
    if (run.spawnError) cliProblem = run.spawnError
    else if (run.timedOut) cliProblem = 'Claude Code did not finish signing out in time.'
  }
  await clearStoredCredentials()
  await credentialsChanged()
  const status = await refreshAndBroadcast()
  if (!status.loggedIn) return status
  const reason = cliProblem
    ? `Claude Code could not sign out: ${cliProblem}`
    : 'Claude Code still reports a sign-in. It probably comes from an environment variable set outside ATOM Code (ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or a Bedrock/Vertex configuration).'
  const withReason: AuthStatus = { ...status, error: status.error ?? reason }
  if (cachedStatus) cachedStatus = { ...cachedStatus, error: withReason.error }
  broadcast(withReason, true)
  return withReason
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive login (node-pty, with a pipe fallback)
// ─────────────────────────────────────────────────────────────────────────────

interface LoginProcess {
  write(data: string): void
  kill(): void
}

interface LoginSession {
  id: string
  mode: LoginMode
  proc: LoginProcess | null
  /** Raw output tail (with ANSI) used for URL / token detection. */
  raw: string
  urlOpened: boolean
  cancelled: boolean
  finished: boolean
}

const logins = new Map<string, LoginSession>()

type PtyModule = typeof NodePty
let ptyModulePromise: Promise<PtyModule | null> | null = null

/** node-pty is native: load it lazily so a missing/mismatched build only disables the PTY path. */
function loadPty(): Promise<PtyModule | null> {
  if (!ptyModulePromise) {
    ptyModulePromise = import('node-pty')
      .then((mod: unknown): PtyModule | null => {
        const m = mod as { spawn?: unknown; default?: { spawn?: unknown } }
        // macOS: node-pty's prebuilt spawn-helper ships without the execute bit.
        ensurePtySpawnHelperExecutable()
        if (typeof m.spawn === 'function') return m as PtyModule
        if (m.default && typeof m.default.spawn === 'function') return m.default as PtyModule
        return null
      })
      .catch(() => null)
  }
  return ptyModulePromise
}

interface LoginHandlers {
  onData(data: string): void
  onExit(exitCode: number | null): void
}

async function spawnLoginProcess(bin: string, args: string[], env: Record<string, string>, handlers: LoginHandlers): Promise<LoginProcess> {
  const cmd = buildClaudeCommand(bin, args, env)
  const cwd = homedir()

  const pty = await loadPty()
  if (pty) {
    try {
      const viaShell = process.platform === 'win32' && cmd.shell
      const file = viaShell ? (cmd.env.ComSpec ?? cmd.env.COMSPEC ?? 'cmd.exe') : cmd.file
      // On Windows a string is passed through verbatim as the command line (cmd.file is pre-quoted).
      const ptyArgs: string[] | string = viaShell ? `/d /s /c "${cmd.file} ${cmd.args.join(' ')}"` : cmd.args
      const p = pty.spawn(file, ptyArgs, { name: 'xterm-256color', cols: LOGIN_COLS, rows: LOGIN_ROWS, cwd, env: cmd.env })
      p.onData((data) => handlers.onData(data))
      p.onExit(({ exitCode }) => handlers.onExit(exitCode))
      return {
        write: (data) => p.write(data),
        kill: () => {
          try {
            p.kill()
          } catch {
            /* already exited */
          }
        }
      }
    } catch {
      /* fall back to plain pipes below */
    }
  }

  const child = spawn(cmd.file, cmd.args, { cwd, env: cmd.env, shell: cmd.shell, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let exited = false
  const finish = (code: number | null): void => {
    if (exited) return
    exited = true
    handlers.onExit(code)
  }
  // xterm needs CRLF; pipes deliver bare LF.
  const forward = (chunk: string): void => handlers.onData(chunk.replace(/\r?\n/g, '\r\n'))
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', forward)
  child.stderr.on('data', forward)
  child.on('error', (err) => {
    handlers.onData(`\r\n\x1b[31mCould not start Claude Code: ${err.message}\x1b[0m\r\n`)
    finish(null)
  })
  child.on('close', (code) => finish(code))
  handlers.onData('\x1b[2m[ATOM Code] Terminal emulation (node-pty) is unavailable; using a basic pipe.\x1b[0m\r\n')
  return {
    // Pipes expect LF for Enter where a terminal sends CR.
    write: (data) => {
      if (!child.stdin.destroyed) child.stdin.write(data.replace(/\r\n?/g, '\n'))
    },
    kill: () => {
      if (!exited) child.kill()
    }
  }
}

function onLoginData(session: LoginSession, data: string): void {
  if (session.finished) return
  session.raw = (session.raw + data).slice(-LOGIN_TRANSCRIPT_CHARS)
  const event: LoginOutputEvent = { loginId: session.id, data }
  ctx.send(IPC.authLoginOutputEvent, event)
  if (!session.urlOpened) {
    const url = findAuthUrl(session.raw)
    if (url) {
      // The CLI usually opens the browser itself too; a second tab is harmless.
      session.urlOpened = true
      shell.openExternal(url).catch(() => undefined)
    }
  }
}

async function onLoginExit(session: LoginSession, exitCode: number | null): Promise<void> {
  if (session.finished) return
  session.finished = true
  logins.delete(session.id)

  const success = !session.cancelled && exitCode === 0
  let tokenCaptured: boolean | undefined
  try {
    if (session.mode === 'setup-token') {
      tokenCaptured = false
      const token = extractOAuthToken(stripAnsi(session.raw))
      if (token) {
        try {
          await storeOAuthToken(token)
          tokenCaptured = true
        } catch (err) {
          console.error('[auth] could not store the long-lived token:', errorMessage(err))
        }
      }
    } else if (success) {
      // A fresh subscription/Console login should take effect: stored credentials would shadow it.
      await clearStoredCredentials()
    }
    if (success || tokenCaptured) await credentialsChanged()
    await refreshAndBroadcast()
  } catch (err) {
    console.error('[auth] status refresh after sign-in failed:', errorMessage(err))
  } finally {
    session.raw = ''
    const event: LoginExitEvent = {
      loginId: session.id,
      success,
      exitCode: session.cancelled ? null : exitCode,
      ...(tokenCaptured !== undefined ? { tokenCaptured } : {})
    }
    ctx.send(IPC.authLoginExitEvent, event)
  }
}

async function startLogin(mode: unknown): Promise<{ loginId: string }> {
  if (!isLoginMode(mode)) throw new Error(`Unknown sign-in mode: ${String(mode)}`)
  const bin = resolveClaudeBinary()
  if (!bin) throw new Error(NOT_FOUND_MESSAGE)

  // One sign-in flow at a time (each one runs its own local OAuth callback listener).
  cancelAllLogins()

  const session: LoginSession = { id: randomUUID(), mode, proc: null, raw: '', urlOpened: false, cancelled: false, finished: false }
  logins.set(session.id, session)
  try {
    session.proc = await spawnLoginProcess(bin, LOGIN_ARGS[mode], loginEnv(), {
      onData: (data) => onLoginData(session, data),
      onExit: (code) => {
        setTimeout(() => void onLoginExit(session, code), EXIT_SETTLE_MS)
      }
    })
  } catch (err) {
    logins.delete(session.id)
    session.finished = true
    throw new Error(`Could not start the Claude Code sign-in: ${errorMessage(err)}`)
  }
  // The process may have been cancelled (or exited) while spawning.
  if (session.cancelled) session.proc.kill()
  return { loginId: session.id }
}

function writeLogin(loginId: unknown, data: unknown): void {
  if (typeof loginId !== 'string' || typeof data !== 'string') throw new Error('Invalid sign-in input.')
  const session = logins.get(loginId)
  if (!session || session.finished || !session.proc) throw new Error('This sign-in has already ended. Start the sign-in again.')
  if (data.length > MAX_LOGIN_INPUT_CHARS) throw new Error('The input is too long.')
  session.proc.write(data)
}

function cancelSession(session: LoginSession): void {
  session.cancelled = true
  session.proc?.kill()
}

function cancelLogin(loginId: unknown): void {
  if (typeof loginId !== 'string') return
  const session = logins.get(loginId)
  if (session) cancelSession(session)
}

function cancelAllLogins(): void {
  for (const session of logins.values()) cancelSession(session)
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC & lifecycle
// ─────────────────────────────────────────────────────────────────────────────

let unsubscribeSettings: (() => void) | null = null
let binaryConfigKey = ''
let binaryRefreshTimer: ReturnType<typeof setTimeout> | null = null

function currentBinaryConfigKey(): string {
  const { useBundledClaude, claudeExecutablePath } = settingsService.get().agent
  return `${useBundledClaude}|${claudeExecutablePath}`
}

export function registerAuthIpc(): void {
  ipcMain.handle(IPC.authGetStatus, (_e, refresh?: unknown) => getAuthStatus(refresh === true))
  ipcMain.handle(IPC.authStartLogin, (_e, mode: unknown) => startLogin(mode))
  ipcMain.handle(IPC.authWriteLogin, (_e, loginId: unknown, data: unknown) => writeLogin(loginId, data))
  ipcMain.handle(IPC.authCancelLogin, (_e, loginId: unknown) => cancelLogin(loginId))
  ipcMain.handle(IPC.authSetApiKey, (_e, key: unknown) => setApiKey(key))
  ipcMain.handle(IPC.authSetOAuthToken, (_e, token: unknown) => setOAuthToken(token))
  ipcMain.handle(IPC.authLogout, () => logout())

  // Switching between the bundled and a custom Claude Code executable changes the status.
  binaryConfigKey = currentBinaryConfigKey()
  unsubscribeSettings?.()
  unsubscribeSettings = settingsService.onChange(() => {
    const key = currentBinaryConfigKey()
    if (key === binaryConfigKey) return
    binaryConfigKey = key
    if (binaryRefreshTimer) clearTimeout(binaryRefreshTimer)
    binaryRefreshTimer = setTimeout(() => {
      binaryRefreshTimer = null
      refreshAndBroadcast().catch(() => undefined)
    }, 400)
  })
}

/** Kill running login processes and detach listeners (app quit). */
export function disposeAuth(): void {
  for (const session of logins.values()) {
    session.cancelled = true
    session.finished = true
    session.proc?.kill()
  }
  logins.clear()
  if (binaryRefreshTimer) clearTimeout(binaryRefreshTimer)
  binaryRefreshTimer = null
  unsubscribeSettings?.()
  unsubscribeSettings = null
}
