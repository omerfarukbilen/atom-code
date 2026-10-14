import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AtomAPI } from '../shared/ipc'
import type { IdeRequest } from '../shared/types'

const invoke = <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

let ideHandler: ((req: IdeRequest) => Promise<unknown> | unknown) | null = null
ipcRenderer.on(IPC.ideRequestEvent, async (_e, req: IdeRequest) => {
  if (!ideHandler) {
    ipcRenderer.invoke(IPC.ideRespond, req.requestId, { error: 'IDE is not ready' })
    return
  }
  try {
    const result = await ideHandler(req)
    ipcRenderer.invoke(IPC.ideRespond, req.requestId, { result })
  } catch (err) {
    ipcRenderer.invoke(IPC.ideRespond, req.requestId, { error: err instanceof Error ? err.message : String(err) })
  }
})

const api: AtomAPI = {
  platform: process.platform,

  app: {
    getVersion: () => invoke(IPC.appGetVersion),
    getPaths: () => invoke(IPC.appGetPaths),
    openExternal: (url) => invoke(IPC.appOpenExternal, url),
    showItemInFolder: (path) => invoke(IPC.appShowItemInFolder, path),
    windowControl: (action) => invoke(IPC.appWindowControl, action),
    isMaximized: () => invoke(IPC.appIsMaximized),
    setTitle: (title) => invoke(IPC.appSetTitle, title),
    onMaximizedChange: (cb) => on(IPC.appMaximizedEvent, cb),
    onMenuCommand: (cb) => on(IPC.appMenuCommandEvent, cb),
    onBeforeClose: (cb) => on(IPC.appBeforeCloseEvent, () => cb()),
    confirmClose: (allow) => invoke(IPC.appConfirmClose, allow)
  },

  workspace: {
    openDialog: () => invoke(IPC.workspaceOpenDialog),
    open: (path) => invoke(IPC.workspaceOpen, path),
    getCurrent: () => invoke(IPC.workspaceGetCurrent),
    listFiles: (root) => invoke(IPC.workspaceListFiles, root),
    onChanged: (cb) => on(IPC.workspaceChangedEvent, cb)
  },

  fs: {
    readDir: (path) => invoke(IPC.fsReadDir, path),
    readFile: (path) => invoke(IPC.fsReadFile, path),
    writeFile: (path, content) => invoke(IPC.fsWriteFile, path, content),
    createFile: (path, content) => invoke(IPC.fsCreateFile, path, content),
    createDir: (path) => invoke(IPC.fsCreateDir, path),
    rename: (from, to) => invoke(IPC.fsRename, from, to),
    delete: (path) => invoke(IPC.fsDelete, path),
    stat: (path) => invoke(IPC.fsStat, path),
    copy: (from, to) => invoke(IPC.fsCopy, from, to),
    onChange: (cb) => on(IPC.fsChangeEvent, cb)
  },

  search: {
    find: (root, options) => invoke(IPC.searchFind, root, options),
    cancel: () => invoke(IPC.searchCancel)
  },

  git: {
    status: (root) => invoke(IPC.gitStatus, root),
    diff: (root, path, staged) => invoke(IPC.gitDiff, root, path, staged),
    fileAtHead: (root, path) => invoke(IPC.gitFileAtHead, root, path),
    stage: (root, paths) => invoke(IPC.gitStage, root, paths),
    unstage: (root, paths) => invoke(IPC.gitUnstage, root, paths),
    discard: (root, paths) => invoke(IPC.gitDiscard, root, paths),
    commit: (root, message, options) => invoke(IPC.gitCommit, root, message, options),
    branches: (root) => invoke(IPC.gitBranches, root),
    checkout: (root, branch) => invoke(IPC.gitCheckout, root, branch),
    createBranch: (root, name) => invoke(IPC.gitCreateBranch, root, name),
    log: (root, limit) => invoke(IPC.gitLog, root, limit),
    push: (root) => invoke(IPC.gitPush, root),
    pull: (root) => invoke(IPC.gitPull, root),
    init: (root) => invoke(IPC.gitInit, root)
  },

  terminal: {
    create: (options) => invoke(IPC.terminalCreate, options),
    write: (id, data) => invoke(IPC.terminalWrite, id, data),
    resize: (id, cols, rows) => invoke(IPC.terminalResize, id, cols, rows),
    kill: (id) => invoke(IPC.terminalKill, id),
    onData: (cb) => on(IPC.terminalDataEvent, cb),
    onExit: (cb) => on(IPC.terminalExitEvent, cb)
  },

  auth: {
    getStatus: (refresh) => invoke(IPC.authGetStatus, refresh),
    startLogin: (mode) => invoke(IPC.authStartLogin, mode),
    writeLogin: (loginId, data) => invoke(IPC.authWriteLogin, loginId, data),
    cancelLogin: (loginId) => invoke(IPC.authCancelLogin, loginId),
    setApiKey: (key) => invoke(IPC.authSetApiKey, key),
    setOAuthToken: (token) => invoke(IPC.authSetOAuthToken, token),
    logout: () => invoke(IPC.authLogout),
    onLoginOutput: (cb) => on(IPC.authLoginOutputEvent, cb),
    onLoginExit: (cb) => on(IPC.authLoginExitEvent, cb),
    onStatus: (cb) => on(IPC.authStatusEvent, cb)
  },

  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (patch) => invoke(IPC.settingsUpdate, patch),
    reset: () => invoke(IPC.settingsReset),
    onChange: (cb) => on(IPC.settingsChangedEvent, cb)
  },

  agent: {
    createChat: (options) => invoke(IPC.agentCreateChat, options),
    send: (chatId, message) => invoke(IPC.agentSend, chatId, message),
    interrupt: (chatId) => invoke(IPC.agentInterrupt, chatId),
    setMode: (chatId, modeId) => invoke(IPC.agentSetMode, chatId, modeId),
    setPermission: (chatId, policy) => invoke(IPC.agentSetPermission, chatId, policy),
    setModel: (chatId, model) => invoke(IPC.agentSetModel, chatId, model),
    setEffort: (chatId, effort) => invoke(IPC.agentSetEffort, chatId, effort),
    respondPermission: (chatId, requestId, response) =>
      invoke(IPC.agentRespondPermission, chatId, requestId, response),
    rewind: (chatId, userMessageUuid, dryRun) => invoke(IPC.agentRewind, chatId, userMessageUuid, dryRun),
    getContextUsage: (chatId) => invoke(IPC.agentGetContextUsage, chatId),
    getCapabilities: (chatId) => invoke(IPC.agentGetCapabilities, chatId),
    stopTask: (chatId, taskId) => invoke(IPC.agentStopTask, chatId, taskId),
    mcpStatus: (chatId) => invoke(IPC.agentMcpStatus, chatId),
    closeChat: (chatId) => invoke(IPC.agentCloseChat, chatId),
    listSessions: (workspace) => invoke(IPC.agentListSessions, workspace),
    loadSession: (sessionId, workspace) => invoke(IPC.agentLoadSession, sessionId, workspace),
    renameSession: (sessionId, title, workspace) => invoke(IPC.agentRenameSession, sessionId, title, workspace),
    deleteSession: (sessionId, workspace) => invoke(IPC.agentDeleteSession, sessionId, workspace),
    onEvent: (cb) => on(IPC.agentEvent, cb)
  },

  ai: {
    inlineEdit: (request) => invoke(IPC.aiInlineEdit, request),
    cancelInlineEdit: (requestId) => invoke(IPC.aiCancelInlineEdit, requestId),
    commitMessage: (root) => invoke(IPC.aiCommitMessage, root),
    onInlineEditDelta: (cb) => on(IPC.aiInlineEditDeltaEvent, cb)
  },

  library: {
    list: (workspace) => invoke(IPC.libraryList, workspace),
    read: (path) => invoke(IPC.libraryRead, path),
    save: (request) => invoke(IPC.librarySave, request),
    delete: (path) => invoke(IPC.libraryDelete, path),
    openFolder: (scope, workspace) => invoke(IPC.libraryOpenFolder, scope, workspace)
  },

  ide: {
    onRequest: (handler) => {
      ideHandler = handler
      return () => {
        if (ideHandler === handler) ideHandler = null
      }
    }
  }
}

contextBridge.exposeInMainWorld('atom', api)
