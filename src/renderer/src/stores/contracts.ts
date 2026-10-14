/**
 * Cross-module renderer contracts.
 *
 * Several feature areas (editor, agent panel, settings, skills) are built independently. Whenever one
 * area needs another, it goes through the store APIs described here — never through component internals.
 *
 *  - `useEditorStore`   (stores/editor.ts)    implements EditorStoreApi
 *  - `useWorkspaceStore`(stores/workspace.ts) implements WorkspaceStoreApi
 *  - `useLayoutStore`   (stores/layout.ts)    implements LayoutState      (already implemented)
 *  - `useCommandStore`  (stores/commands.ts)  command registry            (already implemented)
 *  - `useSettingsStore` (stores/settings.ts)  settings                    (already implemented)
 *  - `useAgentStore`    (stores/agent.ts)     agent chats                 (agent panel)
 *  - `useAuthStore`     (stores/auth.ts)      AuthStoreApi                (auth / login)
 *  - `useLibraryStore`  (stores/library.ts)   skills/agents/commands index (skills panel)
 */
import type { AuthStatus, IdeDiagnostic, LoginMode, WorkspaceInfo } from '@shared/types'

// ── Editor ──────────────────────────────────────────────────────────────────

export type EditorTabKind = 'file' | 'diff' | 'image' | 'welcome'

export interface EditorTab {
  /** Unique id. For files: the absolute path. For diffs: `diff:<path>:<n>`. */
  id: string
  kind: EditorTabKind
  /** Absolute file path (for diff tabs: the file being compared). */
  path: string
  title: string
  language: string
  dirty: boolean
  /** Preview tabs (single click in explorer) are replaced by the next preview. */
  preview: boolean
}

export interface OpenFileOptions {
  /** 1-based line to reveal. */
  line?: number
  column?: number
  /** Highlight a range up to this line. */
  endLine?: number
  preview?: boolean
  /** Move keyboard focus into the editor (default true). */
  focus?: boolean
}

export interface DiffTabRequest {
  /** Absolute path of the file being compared. */
  path: string
  title?: string
  original: string
  modified: string
  language?: string
  /** When false the modified side is editable and can be saved to disk. Default true. */
  readOnly?: boolean
}

export interface ActiveEditorInfo {
  path: string
  language: string
  /** 1-based cursor position. */
  line: number
  column: number
  selection: { text: string; startLine: number; endLine: number } | null
}

export interface EditorStoreApi {
  tabs: EditorTab[]
  activeTabId: string | null
  openFile(path: string, options?: OpenFileOptions): Promise<void>
  openDiff(request: DiffTabRequest): void
  closeTab(id: string): Promise<void>
  /** Save the active file. */
  saveActive(): Promise<void>
  saveAll(): Promise<void>
  /** Reload a file's buffer from disk if it is not dirty (used after the agent edits a file). */
  reloadFromDisk(path: string): Promise<void>
  getActiveEditorInfo(): ActiveEditorInfo | null
  /** Monaco markers for a file, or for all open models when path is omitted. */
  getDiagnostics(path?: string): IdeDiagnostic[]
  /** Paths edited by the agent during this session (for gutter decorations). */
  markAgentEdited(path: string): void
  hasDirtyTabs(): boolean
}

// ── Workspace ───────────────────────────────────────────────────────────────

export interface WorkspaceStoreApi {
  workspace: WorkspaceInfo | null
  /** Cached file list for quick open / @-mentions (absolute paths). */
  files: string[]
  filesLoading: boolean
  openFolderDialog(): Promise<void>
  openWorkspace(path: string): Promise<void>
  closeWorkspace(): void
  refreshFiles(): Promise<void>
}

// ── Auth ────────────────────────────────────────────────────────────────────

export interface AuthStoreApi {
  status: AuthStatus | null
  loading: boolean
  refresh(force?: boolean): Promise<void>
  /** Opens the login dialog (embedded terminal running the official Claude Code login). */
  openLogin(mode?: LoginMode): void
  closeLogin(): void
  loginOpen: boolean
  loginMode: LoginMode
}
