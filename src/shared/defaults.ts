import type { AppSettings } from './types'

export const SETTINGS_VERSION = 1

export const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  theme: 'atom-dark',
  uiFontSize: 13,
  language: 'en',
  editor: {
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
    tabSize: 2,
    insertSpaces: true,
    wordWrap: false,
    minimap: true,
    lineNumbers: true,
    formatOnSave: false,
    autoSave: 'off',
    autoSaveDelayMs: 1000,
    bracketPairColorization: true,
    stickyScroll: true
  },
  terminal: {
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
    shell: '',
    cursorBlink: true
  },
  agent: {
    defaultModel: '',
    defaultEffort: 'auto',
    defaultModeId: 'agent',
    defaultPermission: 'default',
    thinkingDisplay: 'summarized',
    autoIncludeActiveFile: true,
    enableCheckpoints: true,
    maxBudgetUsd: null,
    maxTurns: null,
    customInstructions: '',
    disabledSkills: [],
    useBundledClaude: true,
    claudeExecutablePath: '',
    loadUserSettings: true,
    allowedTools: [],
    disallowedTools: [],
    inlineEditModel: '',
    commitMessageModel: '',
    promptSuggestions: true,
    sandbox: false
  },
  mcpServers: [],
  customModes: [],
  recentWorkspaces: [],
  lastWorkspace: null,
  trustedWorkspaces: [],
  filesExclude: ['.git', 'node_modules', '.DS_Store', 'dist', 'out', '.next', '__pycache__', '.venv', 'target'],
  telemetry: false
}
