/**
 * ATOM Code — IPC contract.
 *
 * `IPC` lists every channel name. Request/response channels are handled in the main process with
 * `ipcMain.handle(IPC.x, ...)` and invoked from the preload with `ipcRenderer.invoke`. Event channels
 * (suffix `Event`) are pushed from main with `webContents.send` and subscribed to in the preload.
 *
 * `AtomAPI` is the object the preload exposes as `window.atom`. The renderer must only talk to the
 * main process through it.
 */
import type {
  AgentCapabilities,
  AgentEventEnvelope,
  AppPaths,
  AppSettings,
  AuthStatus,
  ContextUsageInfo,
  CreateChatOptions,
  DeepPartial,
  FileContent,
  FileEntry,
  FileStat,
  FsChangeEvent,
  GitBranchInfo,
  GitCommitInfo,
  GitStatus,
  IdeRequest,
  InlineEditDeltaEvent,
  InlineEditRequest,
  InlineEditResult,
  LibraryIndex,
  LibrarySaveRequest,
  LoginExitEvent,
  LoginMode,
  LoginOutputEvent,
  MenuCommand,
  OutgoingUserMessage,
  PermissionPolicy,
  PermissionResponse,
  RewindResult,
  SearchOptions,
  SearchResult,
  SessionSummary,
  StoredSessionMessage,
  TerminalCreateOptions,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalInfo,
  Unsubscribe,
  WorkspaceInfo,
  EffortLevel,
  McpServerSetting
} from './types'

export const IPC = {
  // app / window
  appGetVersion: 'app:getVersion',
  appGetPaths: 'app:getPaths',
  appOpenExternal: 'app:openExternal',
  appShowItemInFolder: 'app:showItemInFolder',
  appWindowControl: 'app:windowControl',
  appIsMaximized: 'app:isMaximized',
  appMaximizedEvent: 'app:maximizedEvent',
  appMenuCommandEvent: 'app:menuCommandEvent',
  appSetTitle: 'app:setTitle',
  appConfirmClose: 'app:confirmClose',
  appCloseAck: 'app:closeAck',
  appBeforeCloseEvent: 'app:beforeCloseEvent',

  // workspace
  workspaceOpenDialog: 'workspace:openDialog',
  workspaceOpen: 'workspace:open',
  workspaceGetCurrent: 'workspace:getCurrent',
  workspaceListFiles: 'workspace:listFiles',
  workspaceChangedEvent: 'workspace:changedEvent',

  // fs
  fsReadDir: 'fs:readDir',
  fsReadFile: 'fs:readFile',
  fsWriteFile: 'fs:writeFile',
  fsCreateFile: 'fs:createFile',
  fsCreateDir: 'fs:createDir',
  fsRename: 'fs:rename',
  fsDelete: 'fs:delete',
  fsStat: 'fs:stat',
  fsCopy: 'fs:copy',
  fsChangeEvent: 'fs:changeEvent',

  // search
  searchFind: 'search:find',
  searchCancel: 'search:cancel',

  // git
  gitStatus: 'git:status',
  gitDiff: 'git:diff',
  gitFileAtHead: 'git:fileAtHead',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitDiscard: 'git:discard',
  gitCommit: 'git:commit',
  gitBranches: 'git:branches',
  gitCheckout: 'git:checkout',
  gitCreateBranch: 'git:createBranch',
  gitLog: 'git:log',
  gitPush: 'git:push',
  gitPull: 'git:pull',
  gitInit: 'git:init',

  // terminal
  terminalCreate: 'terminal:create',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalKill: 'terminal:kill',
  terminalDataEvent: 'terminal:dataEvent',
  terminalExitEvent: 'terminal:exitEvent',

  // auth
  authGetStatus: 'auth:getStatus',
  authStartLogin: 'auth:startLogin',
  authWriteLogin: 'auth:writeLogin',
  authCancelLogin: 'auth:cancelLogin',
  authSetApiKey: 'auth:setApiKey',
  authSetOAuthToken: 'auth:setOAuthToken',
  authLogout: 'auth:logout',
  authLoginOutputEvent: 'auth:loginOutputEvent',
  authLoginExitEvent: 'auth:loginExitEvent',
  authStatusEvent: 'auth:statusEvent',

  // settings
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsReset: 'settings:reset',
  settingsChangedEvent: 'settings:changedEvent',

  // agent
  agentCreateChat: 'agent:createChat',
  agentSend: 'agent:send',
  agentInterrupt: 'agent:interrupt',
  agentSetMode: 'agent:setMode',
  agentSetPermission: 'agent:setPermission',
  agentSetModel: 'agent:setModel',
  agentSetEffort: 'agent:setEffort',
  agentRespondPermission: 'agent:respondPermission',
  agentRewind: 'agent:rewind',
  agentGetContextUsage: 'agent:getContextUsage',
  agentGetCapabilities: 'agent:getCapabilities',
  agentCloseChat: 'agent:closeChat',
  agentListSessions: 'agent:listSessions',
  agentLoadSession: 'agent:loadSession',
  agentRenameSession: 'agent:renameSession',
  agentDeleteSession: 'agent:deleteSession',
  agentStopTask: 'agent:stopTask',
  agentMcpStatus: 'agent:mcpStatus',
  agentEvent: 'agent:event',

  // one-shot AI helpers
  aiInlineEdit: 'ai:inlineEdit',
  aiCancelInlineEdit: 'ai:cancelInlineEdit',
  aiCommitMessage: 'ai:commitMessage',
  aiInlineEditDeltaEvent: 'ai:inlineEditDeltaEvent',

  // skills / agents / commands library
  libraryList: 'library:list',
  libraryRead: 'library:read',
  librarySave: 'library:save',
  libraryDelete: 'library:delete',
  libraryOpenFolder: 'library:openFolder',

  // IDE bridge (main asks renderer)
  ideRequestEvent: 'ide:requestEvent',
  ideRespond: 'ide:respond'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export type WindowControlAction = 'minimize' | 'maximize' | 'close'

export interface McpServerStatusInfo {
  name: string
  status: string
  error?: string
  tools?: string[]
}

export interface AtomAPI {
  platform: 'darwin' | 'win32' | 'linux' | string

  app: {
    getVersion(): Promise<string>
    getPaths(): Promise<AppPaths>
    openExternal(url: string): Promise<void>
    showItemInFolder(path: string): Promise<void>
    windowControl(action: WindowControlAction): Promise<void>
    isMaximized(): Promise<boolean>
    setTitle(title: string): Promise<void>
    onMaximizedChange(cb: (maximized: boolean) => void): Unsubscribe
    onMenuCommand(cb: (command: MenuCommand) => void): Unsubscribe
    /** Main asks before closing the window; renderer answers with confirmClose(true|false). */
    onBeforeClose(cb: () => void): Unsubscribe
    confirmClose(allow: boolean): Promise<void>
    /** Tell main the close request was received and a decision is pending (e.g. an unsaved-changes dialog). */
    ackClose(): Promise<void>
  }

  workspace: {
    openDialog(): Promise<string | null>
    open(path: string): Promise<WorkspaceInfo>
    getCurrent(): Promise<WorkspaceInfo | null>
    /** All files (absolute paths) in the workspace, gitignore-aware, capped at 50k. */
    listFiles(root: string): Promise<string[]>
    onChanged(cb: (ws: WorkspaceInfo | null) => void): Unsubscribe
  }

  fs: {
    readDir(path: string): Promise<FileEntry[]>
    readFile(path: string): Promise<FileContent>
    writeFile(path: string, content: string): Promise<FileStat>
    createFile(path: string, content?: string): Promise<void>
    createDir(path: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    /** Moves to the OS trash. */
    delete(path: string): Promise<void>
    stat(path: string): Promise<FileStat>
    copy(from: string, to: string): Promise<void>
    /** Batched (≈100 ms) change notifications for the current workspace. */
    onChange(cb: (events: FsChangeEvent[]) => void): Unsubscribe
  }

  search: {
    find(root: string, options: SearchOptions): Promise<SearchResult>
    cancel(): Promise<void>
  }

  git: {
    status(root: string): Promise<GitStatus>
    /** Unified diff of the working tree (or index when staged) for a path or the whole repo. */
    diff(root: string, path?: string, staged?: boolean): Promise<string>
    /** File content at HEAD, or null when untracked / not a repo. */
    fileAtHead(root: string, path: string): Promise<string | null>
    stage(root: string, paths: string[]): Promise<void>
    unstage(root: string, paths: string[]): Promise<void>
    discard(root: string, paths: string[]): Promise<void>
    commit(root: string, message: string, options?: { amend?: boolean; all?: boolean }): Promise<string>
    branches(root: string): Promise<GitBranchInfo[]>
    checkout(root: string, branch: string): Promise<void>
    createBranch(root: string, name: string): Promise<void>
    log(root: string, limit?: number): Promise<GitCommitInfo[]>
    push(root: string): Promise<string>
    pull(root: string): Promise<string>
    init(root: string): Promise<void>
  }

  terminal: {
    create(options: TerminalCreateOptions): Promise<TerminalInfo>
    write(id: string, data: string): Promise<void>
    resize(id: string, cols: number, rows: number): Promise<void>
    kill(id: string): Promise<void>
    onData(cb: (e: TerminalDataEvent) => void): Unsubscribe
    onExit(cb: (e: TerminalExitEvent) => void): Unsubscribe
  }

  auth: {
    getStatus(refresh?: boolean): Promise<AuthStatus>
    /** Starts the official Claude Code login flow in a pseudo terminal. */
    startLogin(mode: LoginMode): Promise<{ loginId: string }>
    /** Write to the login process stdin (e.g. paste the authorization code + "\r"). */
    writeLogin(loginId: string, data: string): Promise<void>
    cancelLogin(loginId: string): Promise<void>
    /** Store (encrypted) or clear an Anthropic API key. */
    setApiKey(key: string | null): Promise<AuthStatus>
    /** Store (encrypted) or clear a long-lived OAuth token from `claude setup-token`. */
    setOAuthToken(token: string | null): Promise<AuthStatus>
    /** Logs out of Claude Code and clears stored credentials. */
    logout(): Promise<AuthStatus>
    onLoginOutput(cb: (e: LoginOutputEvent) => void): Unsubscribe
    onLoginExit(cb: (e: LoginExitEvent) => void): Unsubscribe
    onStatus(cb: (s: AuthStatus) => void): Unsubscribe
  }

  settings: {
    get(): Promise<AppSettings>
    update(patch: DeepPartial<AppSettings>): Promise<AppSettings>
    reset(): Promise<AppSettings>
    onChange(cb: (s: AppSettings) => void): Unsubscribe
  }

  agent: {
    createChat(options: CreateChatOptions): Promise<void>
    send(chatId: string, message: OutgoingUserMessage): Promise<void>
    interrupt(chatId: string): Promise<void>
    setMode(chatId: string, modeId: string): Promise<void>
    setPermission(chatId: string, policy: PermissionPolicy): Promise<void>
    setModel(chatId: string, model: string): Promise<void>
    setEffort(chatId: string, effort: EffortLevel | 'auto'): Promise<void>
    respondPermission(chatId: string, requestId: string, response: PermissionResponse): Promise<void>
    /** Restore files to their state before the given user message (requires checkpoints). */
    rewind(chatId: string, userMessageUuid: string, dryRun?: boolean): Promise<RewindResult>
    getContextUsage(chatId: string): Promise<ContextUsageInfo | null>
    getCapabilities(chatId: string): Promise<AgentCapabilities | null>
    stopTask(chatId: string, taskId: string): Promise<void>
    mcpStatus(chatId: string): Promise<McpServerStatusInfo[]>
    closeChat(chatId: string): Promise<void>
    listSessions(workspace: string): Promise<SessionSummary[]>
    loadSession(sessionId: string, workspace: string): Promise<StoredSessionMessage[]>
    renameSession(sessionId: string, title: string, workspace: string): Promise<void>
    deleteSession(sessionId: string, workspace: string): Promise<void>
    onEvent(cb: (e: AgentEventEnvelope) => void): Unsubscribe
  }

  ai: {
    inlineEdit(request: InlineEditRequest): Promise<InlineEditResult>
    cancelInlineEdit(requestId: string): Promise<void>
    commitMessage(root: string): Promise<string>
    onInlineEditDelta(cb: (e: InlineEditDeltaEvent) => void): Unsubscribe
  }

  library: {
    list(workspace?: string | null): Promise<LibraryIndex>
    read(path: string): Promise<string>
    save(request: LibrarySaveRequest): Promise<string>
    delete(path: string): Promise<void>
    openFolder(scope: 'atom' | 'user' | 'project', workspace?: string | null): Promise<void>
  }

  ide: {
    /** Register the renderer handler that answers the agent's IDE tool calls. Only one handler is active. */
    onRequest(handler: (req: IdeRequest) => Promise<unknown> | unknown): Unsubscribe
  }
}

/** Re-exported for convenience in main-process handlers. */
export type { McpServerSetting }
