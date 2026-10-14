/**
 * ATOM Code — shared types used by the main process, the preload bridge and the renderer.
 *
 * This file is the single source of truth for every payload that crosses the IPC boundary.
 * Keep it free of runtime imports from Electron, Node or React: it must type-check in both
 * the `tsconfig.node.json` and `tsconfig.web.json` projects.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Generic helpers
// ─────────────────────────────────────────────────────────────────────────────

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer _U> ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export type Unsubscribe = () => void

// ─────────────────────────────────────────────────────────────────────────────
// Workspace & file system
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkspaceInfo {
  /** Absolute path of the workspace root folder. */
  path: string
  /** Folder name (basename of path). */
  name: string
  isGitRepo: boolean
}

export interface RecentWorkspace {
  path: string
  name: string
  openedAt: number
}

export interface FileEntry {
  name: string
  /** Absolute path. */
  path: string
  isDirectory: boolean
  isSymlink?: boolean
  size?: number
  mtimeMs?: number
}

export interface FileContent {
  path: string
  /** UTF-8 text, or base64 when `isBinary` is true (only for images ≤ 10 MB). Empty when `tooLarge`. */
  content: string
  encoding: 'utf8' | 'base64'
  isBinary: boolean
  /** True when the file is larger than the editor limit (5 MB) — content is empty. */
  tooLarge?: boolean
  /**
   * How the text was decoded (text files only). `utf8bom`: UTF-8 with a byte order mark;
   * `windows-1252`: the bytes are not valid UTF-8 and were read as Windows-1252 / Latin-1. The main
   * process remembers it and writes the file back in the same encoding (BOM included).
   */
  textEncoding?: TextEncodingId
  size: number
  mtimeMs: number
}

export type TextEncodingId = 'utf8' | 'utf8bom' | 'windows-1252'

export interface FileStat {
  path: string
  exists: boolean
  isDirectory: boolean
  size: number
  mtimeMs: number
}

export type FsChangeKind = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface FsChangeEvent {
  kind: FsChangeKind
  /** Absolute path. */
  path: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Search (ripgrep)
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchOptions {
  query: string
  isRegex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  /** Comma separated glob list, e.g. "src/**,*.ts". */
  include?: string
  /** Comma separated glob list. */
  exclude?: string
  /** Max total matches (default 2000). */
  maxResults?: number
}

export interface SearchMatch {
  /** 1-based line number. */
  line: number
  /** 1-based column of the match start (in UTF-16 code units of `preview`). */
  column: number
  length: number
  /** The full line text (trimmed to 300 chars). */
  preview: string
}

export interface SearchFileResult {
  path: string
  relativePath: string
  matches: SearchMatch[]
}

export interface SearchResult {
  files: SearchFileResult[]
  totalMatches: number
  truncated: boolean
  durationMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Git
// ─────────────────────────────────────────────────────────────────────────────

/** Porcelain status letters. ' ' means unmodified in that column. */
export type GitStatusCode = ' ' | 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!'

export interface GitFileChange {
  /** Absolute path. */
  path: string
  /** Path relative to the repository root, forward slashes. */
  relativePath: string
  index: GitStatusCode
  workingTree: GitStatusCode
  /** True when the change (or part of it) is staged. */
  staged: boolean
  /** True for untracked files. */
  untracked: boolean
  /** True when the file has merge conflicts. */
  conflicted: boolean
  renamedFrom?: string
}

export interface GitStatus {
  isRepo: boolean
  root: string | null
  branch: string | null
  tracking: string | null
  ahead: number
  behind: number
  files: GitFileChange[]
}

export interface GitCommitInfo {
  hash: string
  shortHash: string
  message: string
  author: string
  /** ISO date. */
  date: string
}

export interface GitBranchInfo {
  name: string
  current: boolean
  remote: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Terminal
// ─────────────────────────────────────────────────────────────────────────────

export interface TerminalCreateOptions {
  cwd?: string
  cols: number
  rows: number
  /** Override shell executable. Empty / undefined = settings or OS default. */
  shell?: string
}

export interface TerminalInfo {
  id: string
  title: string
  shell: string
  cwd: string
  pid: number
  /** False when node-pty could not be loaded and a pipe-based fallback is used. */
  isPty: boolean
}

export interface TerminalDataEvent {
  id: string
  data: string
}

export interface TerminalExitEvent {
  id: string
  exitCode: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication (Claude subscription via the official Claude Code CLI login)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * - `claude-subscription`: logged in through `claude auth login --claudeai` (Pro / Max / Team / Enterprise).
 * - `oauth-token`: a long-lived token created with `claude setup-token`, stored by ATOM Code (encrypted
 *   with the OS keyring when one is available — see `AuthStatus.secretStorage`).
 * - `api-key`: an Anthropic Console API key, stored by ATOM Code (same storage).
 * - `console`: logged in through `claude auth login --console`.
 * - `third-party`: Bedrock / Vertex / Foundry etc. configured through environment variables.
 */
export type AuthMethod = 'claude-subscription' | 'oauth-token' | 'api-key' | 'console' | 'third-party' | 'none'

export interface AuthStatus {
  loggedIn: boolean
  method: AuthMethod
  email?: string
  organization?: string
  /** e.g. "pro", "max", "team", "enterprise" when known. */
  subscriptionType?: string
  apiProvider?: string
  /** Absolute path of the Claude Code executable ATOM Code drives, or null when none was found. */
  claudeBinary: string | null
  claudeVersion?: string
  /** True when ATOM Code holds a usable API key / OAuth token of its own (see `secretStorage` for how). */
  hasStoredApiKey: boolean
  hasStoredOAuthToken: boolean
  /** How ATOM Code stores its own credentials on this machine. */
  secretStorage?: SecretStorageInfo
  error?: string
  checkedAt: number
}

export interface SecretStorageInfo {
  /**
   * True when credentials ATOM Code saves are encrypted with the OS keyring (Keychain, DPAPI,
   * libsecret/kwallet). False when no keyring is available: they are then stored unencrypted in
   * `file`, readable by anyone with access to your user account — the UI must not call them encrypted.
   */
  encrypted: boolean
  /** Electron safeStorage backend on Linux, e.g. "gnome_libsecret", "kwallet5" or "basic_text". */
  backend?: string
  /** Absolute path of the file that holds the stored credentials. */
  file: string
  /**
   * Stored credentials that were encrypted with a keyring that is not available in this session.
   * They are kept on disk but not used until the keyring is back (or they are entered again).
   */
  locked?: ('apiKey' | 'oauthToken')[]
}

export type LoginMode = 'claudeai' | 'console' | 'setup-token'

export interface LoginOutputEvent {
  loginId: string
  data: string
}

export interface LoginExitEvent {
  loginId: string
  success: boolean
  exitCode: number | null
  /** For `setup-token`: the token detected in the output (also stored automatically). Never logged. */
  tokenCaptured?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent modes, models & permissions
// ─────────────────────────────────────────────────────────────────────────────

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * How tool calls are approved. Maps 1:1 to the SDK `PermissionMode` (minus `plan`/`dontAsk`,
 * which are controlled by the agent mode).
 */
export type PermissionPolicy = 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions'

export interface AgentModeDefinition {
  /** Stable id, e.g. "agent", "plan", "my-custom-mode". */
  id: string
  name: string
  /** One-line description shown in the mode picker. */
  description: string
  /** lucide-react icon name in PascalCase, e.g. "Bot", "ListChecks", "MessageCircleQuestion". */
  icon: string
  /** Accent color (CSS color). */
  color: string
  builtin?: boolean
  /** When "plan", the SDK runs in plan mode regardless of the user's permission policy. */
  forcedPermissionMode?: 'plan' | null
  /** Read-only modes may only use non-mutating tools (Read, Glob, Grep, WebSearch, WebFetch, IDE read tools). */
  readOnly?: boolean
  /** Explicit tool allowlist (built-in tool names and/or mcp__ names). Overrides readOnly when set. */
  tools?: string[]
  disallowedTools?: string[]
  /** Instructions appended to the ATOM base system prompt while this mode is active. */
  systemPrompt: string
  /** Preferred model id/alias for this mode ('' = keep the chat's model). */
  model?: string
  effort?: EffortLevel
  /** Skill names the mode recommends (shown as hints and referenced in the prompt). */
  skills?: string[]
  /** Keyboard hint / ordering. */
  order?: number
}

export interface ModelOption {
  /** Value passed to the SDK `model` option. '' means "Claude Code default". */
  value: string
  label: string
  description?: string
  supportsEffort?: boolean
  supportedEffortLevels?: EffortLevel[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

export type ThemeId = 'atom-dark' | 'atom-midnight' | 'atom-light'

export interface McpServerSetting {
  /** Unique server name (used as `mcp__<name>__*` tool prefix). */
  name: string
  enabled: boolean
  type: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export interface AgentSettings {
  /** '' = Claude Code default model for the account. */
  defaultModel: string
  /** 'auto' = model default effort. */
  defaultEffort: EffortLevel | 'auto'
  defaultModeId: string
  defaultPermission: PermissionPolicy
  thinkingDisplay: 'summarized' | 'omitted'
  /** Tell the agent which file/line the user is looking at when sending a message. */
  autoIncludeActiveFile: boolean
  /** Enable SDK file checkpointing (restore files to any earlier user message). */
  enableCheckpoints: boolean
  /**
   * Spending limit per chat in USD (estimated cost of the conversation, kept across agent restarts).
   * The agent stops when the chat reaches it. null = unlimited.
   */
  maxBudgetUsd: number | null
  /** null = unlimited. */
  maxTurns: number | null
  /** Global user rules appended to the system prompt for every chat. */
  customInstructions: string
  /** Skill names (as reported by the SDK, e.g. "atom:tdd" or "my-skill") hidden from the agent. */
  disabledSkills: string[]
  /** Use the Claude Code binary bundled with the Agent SDK (recommended). */
  useBundledClaude: boolean
  /** Custom Claude Code executable path when useBundledClaude is false. */
  claudeExecutablePath: string
  /** Load ~/.claude settings, skills, agents, CLAUDE.md (settingSources 'user'). */
  loadUserSettings: boolean
  /** Extra permission rules that are always allowed, e.g. "Bash(npm test:*)". */
  allowedTools: string[]
  /** Tools the agent may never use, e.g. "WebFetch". */
  disallowedTools: string[]
  /** Model used for Cmd/Ctrl+K inline edits ('' = sonnet). */
  inlineEditModel: string
  /** Model used for commit message generation ('' = haiku). */
  commitMessageModel: string
  /** Ask the SDK for a predicted next prompt after each turn. */
  promptSuggestions: boolean
  /** Run Bash commands inside the Claude Code sandbox when available. */
  sandbox: boolean
}

export interface EditorSettings {
  fontSize: number
  fontFamily: string
  tabSize: number
  insertSpaces: boolean
  wordWrap: boolean
  minimap: boolean
  lineNumbers: boolean
  formatOnSave: boolean
  autoSave: 'off' | 'afterDelay' | 'onFocusChange'
  autoSaveDelayMs: number
  bracketPairColorization: boolean
  stickyScroll: boolean
}

export interface TerminalSettings {
  fontSize: number
  fontFamily: string
  /** '' = OS default shell. */
  shell: string
  cursorBlink: boolean
}

export interface AppSettings {
  version: number
  theme: ThemeId
  /** UI font size in px. */
  uiFontSize: number
  /** UI language. */
  language: 'en' | 'tr'
  editor: EditorSettings
  terminal: TerminalSettings
  agent: AgentSettings
  mcpServers: McpServerSetting[]
  customModes: AgentModeDefinition[]
  recentWorkspaces: RecentWorkspace[]
  lastWorkspace: string | null
  /**
   * Folders whose Claude Code project configuration the user trusts (absolute, canonical paths; a
   * folder inside a trusted one is trusted too). Only trusted workspaces load `.claude/settings*.json`
   * (hooks, permissions, env), `.mcp.json` servers, CLAUDE.md and ATOM.md into agent sessions.
   */
  trustedWorkspaces: string[]
  /** Files/folders hidden from the explorer and quick open (glob names). */
  filesExclude: string[]
  telemetry: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Skills, subagents & commands library
// ─────────────────────────────────────────────────────────────────────────────

/**
 * - `atom`: bundled with ATOM Code (resources/atom-plugin) — exposed to the agent as `atom:<name>`.
 * - `user`: ~/.claude/skills (or agents/commands).
 * - `project`: <workspace>/.claude/skills (or agents/commands).
 */
export type LibraryScope = 'atom' | 'user' | 'project'

export interface SkillInfo {
  /** Directory / frontmatter name, e.g. "systematic-debugging". */
  name: string
  /** Name the SDK uses: "atom:systematic-debugging" for bundled skills, plain name otherwise. */
  qualifiedName: string
  description: string
  scope: LibraryScope
  /** Absolute path of SKILL.md. */
  path: string
  /** Absolute path of the skill directory. */
  dir: string
  /** Other files bundled in the skill directory (relative paths). */
  files: string[]
  enabled: boolean
  /** Bundled skills are read-only in the UI (they can be duplicated into user scope). */
  readOnly: boolean
}

export interface SubagentInfo {
  name: string
  qualifiedName: string
  description: string
  scope: LibraryScope
  path: string
  model?: string
  tools?: string[]
  readOnly: boolean
}

export interface CommandInfo {
  /** Command name without the leading slash. */
  name: string
  qualifiedName: string
  description: string
  argumentHint?: string
  scope: LibraryScope
  path: string
  readOnly: boolean
}

export interface LibraryIndex {
  skills: SkillInfo[]
  agents: SubagentInfo[]
  commands: CommandInfo[]
  pluginDir: string
}

export type LibraryKind = 'skill' | 'agent' | 'command'

export interface LibrarySaveRequest {
  kind: LibraryKind
  scope: Exclude<LibraryScope, 'atom'>
  /** kebab-case name. */
  name: string
  /** Full markdown file content including YAML frontmatter. */
  content: string
  /** Required for project scope. */
  workspace?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent chat — requests from the renderer
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateChatOptions {
  /** Renderer-generated id (uuid). */
  chatId: string
  /** Absolute workspace path used as the agent cwd. */
  workspace: string
  modeId: string
  /** '' = default model. */
  model: string
  effort: EffortLevel | 'auto'
  permission: PermissionPolicy
  /** Resume an existing SDK session (from history). */
  resumeSessionId?: string
  /** Fork instead of continuing when resuming. */
  forkSession?: boolean
  title?: string
}

/** Extra context the user attached to a message. Rendered by the main process into the prompt. */
export type ContextAttachment =
  | { type: 'file'; path: string }
  | { type: 'folder'; path: string }
  | { type: 'selection'; path: string; startLine: number; endLine: number; text: string; language?: string }
  | { type: 'terminal'; text: string }
  | { type: 'diagnostics'; path: string; text: string }
  | { type: 'git-diff'; text: string }

export interface ImageAttachment {
  /** e.g. image/png */
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  /** Base64 data without the data: prefix. */
  data: string
  name?: string
}

export interface OutgoingUserMessage {
  /** Client uuid of the message (renderer generated). Used for checkpoints/rewind. */
  uuid: string
  text: string
  attachments?: ContextAttachment[]
  images?: ImageAttachment[]
  /** Where the user is looking (auto-included when enabled). */
  activeEditor?: { path: string; line?: number; column?: number; language?: string } | null
  /** When the agent is busy: 'next' folds into the running turn, 'later' queues after it. */
  priority?: 'now' | 'next' | 'later'
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent chat — events to the renderer
// ─────────────────────────────────────────────────────────────────────────────

export type AgentRunStatus =
  | 'starting' // CLI process spawning / initializing
  | 'idle' // waiting for user input
  | 'running' // a turn is in progress
  | 'awaiting-input' // blocked on a permission / plan / question response
  | 'error'
  | 'closed'

export interface PermissionRequest {
  requestId: string
  chatId: string
  /**
   * - `tool`: a normal tool approval (Bash, Edit, Write, WebFetch, MCP…)
   * - `plan`: ExitPlanMode — the agent finished planning and asks to execute
   * - `question`: AskUserQuestion — the agent asks multiple-choice questions
   */
  kind: 'tool' | 'plan' | 'question'
  toolName: string
  toolUseId?: string
  input: Record<string, unknown>
  /** Prompt sentence from the CLI, e.g. "Claude wants to run npm test". */
  title?: string
  /** Short noun phrase, e.g. "Run command". */
  displayName?: string
  decisionReason?: string
  blockedPath?: string
  /** Opaque PermissionUpdate[] suggestions from the SDK (needed for "always allow"). */
  suggestions?: unknown[]
  /**
   * The ask must not be approvable by a single stray keystroke: open the prompt on its decline option
   * (no Enter-to-allow default, no one-key approve shortcut) and allow only on an explicit click.
   */
  defaultToNo?: boolean
  /**
   * Do not offer "Always allow": the rule cannot be saved for this ask (it would grant more than this
   * action, or the folder's project configuration is not trusted, so .claude/settings.local.json is not
   * loaded). Main downgrades an `always` answer to this chat only.
   */
  suppressAlwaysAllow?: boolean
  createdAt: number
}

export type PermissionResponse =
  | {
      behavior: 'allow'
      /**
       * once = just this call; session = for this chat (kept across agent restarts); always = persist to
       * project .claude/settings.local.json (this chat only when the request has `suppressAlwaysAllow`).
       */
      scope: 'once' | 'session' | 'always'
      /** Modified tool input (AskUserQuestion answers are sent here). */
      updatedInput?: Record<string, unknown>
      /** For plan approval: switch the chat to this permission policy and leave plan mode. */
      nextPermission?: PermissionPolicy
    }
  | {
      behavior: 'deny'
      /** Feedback shown to the agent. */
      message?: string
      /** Also stop the current turn. */
      interrupt?: boolean
    }

export interface SessionInitInfo {
  sessionId: string
  model: string
  cwd: string
  tools: string[]
  slashCommands: string[]
  skills: string[]
  agents: string[]
  plugins: { name: string; path: string }[]
  mcpServers: { name: string; status: string }[]
  permissionMode: string
  claudeCodeVersion: string
  apiKeySource: string
}

export interface SlashCommandInfo {
  name: string
  description: string
  argumentHint: string
  builtin?: boolean
}

export interface AgentCapabilities {
  commands: SlashCommandInfo[]
  models: ModelOption[]
  agents: { name: string; description: string }[]
}

export interface ContextUsageInfo {
  totalTokens: number
  maxTokens: number
  percentage: number
  /** Optional category breakdown (system prompt, tools, messages, …). */
  categories?: { name: string; tokens: number }[]
}

export interface RateLimitInfo {
  /** e.g. "five_hour", "seven_day" */
  window?: string
  status?: string
  /** Unix ms when the window resets. */
  resetsAt?: number
  utilization?: number
  raw?: unknown
}

export type AgentEvent =
  /** A raw SDK message, forwarded verbatim (assistant, user, result, system, stream_event, tool_progress, task_*, rate_limit_event, …). */
  | { type: 'sdk'; message: SdkMessageLike }
  | { type: 'status'; status: AgentRunStatus; detail?: string }
  | { type: 'init'; info: SessionInitInfo }
  | { type: 'capabilities'; capabilities: AgentCapabilities }
  | { type: 'permission-request'; request: PermissionRequest }
  | { type: 'permission-resolved'; requestId: string; behavior: 'allow' | 'deny' }
  /** A user message accepted by the CLI (echo of what was sent, after attachments were rendered). */
  | { type: 'user-sent'; uuid: string; text: string; images: number }
  | { type: 'file-changed'; path: string; tool: string }
  | { type: 'context-usage'; usage: ContextUsageInfo }
  | { type: 'rate-limit'; info: RateLimitInfo }
  | { type: 'mode-changed'; modeId: string; permission: PermissionPolicy | 'plan' }
  | { type: 'error'; message: string; kind: 'auth' | 'rate-limit' | 'process' | 'usage-limit' | 'unknown' }
  | { type: 'stderr'; data: string }

/**
 * Minimal structural type for SDK messages crossing IPC. The renderer may narrow it using
 * `import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'` — type-only imports are fine there.
 */
export interface SdkMessageLike {
  type: string
  subtype?: string
  uuid?: string
  session_id?: string
  parent_tool_use_id?: string | null
  [key: string]: unknown
}

export interface AgentEventEnvelope {
  chatId: string
  event: AgentEvent
}

export interface SessionSummary {
  sessionId: string
  title: string
  lastModified: number
  createdAt?: number
  gitBranch?: string
  cwd?: string
  firstPrompt?: string
  fileSize?: number
}

/** A stored transcript entry (from getSessionMessages) — same shape as live SDK user/assistant messages. */
export interface StoredSessionMessage {
  type: 'user' | 'assistant' | 'system'
  uuid: string
  session_id: string
  message: unknown
  parent_tool_use_id: string | null
}

export interface RewindResult {
  canRewind: boolean
  error?: string
  filesChanged?: string[]
  insertions?: number
  deletions?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// One-shot AI helpers (inline edit, commit messages)
// ─────────────────────────────────────────────────────────────────────────────

export interface InlineEditRequest {
  requestId: string
  workspace: string
  filePath: string
  language: string
  instruction: string
  /** The selected text to transform ('' = generate code at the cursor). */
  selection: string
  /** Up to ~200 lines before / after the selection for context. */
  prefix: string
  suffix: string
  model?: string
}

export interface InlineEditResult {
  requestId: string
  /** Replacement code for the selection (no markdown fences). */
  text: string
  error?: string
}

export interface InlineEditDeltaEvent {
  requestId: string
  /** Accumulated text so far. */
  text: string
}

// ─────────────────────────────────────────────────────────────────────────────
// IDE bridge — the agent's `atom-ide` MCP tools query the renderer
// ─────────────────────────────────────────────────────────────────────────────

export type IdeMethod = 'getOpenEditors' | 'getDiagnostics' | 'openFile' | 'getSelection' | 'getTerminalOutput'

export interface IdeRequest {
  requestId: string
  method: IdeMethod
  params: Record<string, unknown>
}

export interface IdeOpenEditorsResult {
  activePath: string | null
  editors: { path: string; dirty: boolean; language: string }[]
  cursor?: { line: number; column: number } | null
}

export interface IdeDiagnostic {
  path: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  line: number
  column: number
  endLine: number
  endColumn: number
  source?: string
  code?: string
}

export interface IdeSelectionResult {
  path: string | null
  text: string
  startLine: number
  endLine: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Menu / app
// ─────────────────────────────────────────────────────────────────────────────

/** Commands the native menu can send to the renderer (see renderer command registry). */
export type MenuCommand =
  | 'file.openFolder'
  | 'file.newFile'
  | 'file.save'
  | 'file.saveAll'
  | 'file.closeEditor'
  | 'view.commandPalette'
  | 'view.quickOpen'
  | 'view.toggleSidebar'
  | 'view.togglePanel'
  | 'view.toggleAgent'
  | 'view.settings'
  | 'agent.newChat'
  | 'agent.focus'
  | 'help.about'

export interface AppPaths {
  home: string
  userData: string
  pluginDir: string
  claudeConfigDir: string
}
