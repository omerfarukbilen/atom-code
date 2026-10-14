# ATOM Code — Architecture & Build Spec

ATOM Code is a Cursor-style, AI-native desktop code editor. Its agent is powered by the **Claude Agent SDK**
(`@anthropic-ai/claude-agent-sdk`, Claude Code packaged as a library), so it inherits Claude Code's harness —
built-in tools, permission system, hooks, subagents, skills, sessions, checkpoints — and signs in with the
user's **Claude subscription** through the official Claude Code login.

```
┌──────────────────────── Electron main (Node, ESM) ────────────────────────┐
│ settings · workspace · fs(watch) · search(ripgrep) · git(simple-git)      │
│ terminal(node-pty) · auth(claude CLI) · library(skills/agents/commands)    │
│ agent/manager ── AgentSession ── query() ──► bundled `claude` binary ──► API│
│        ▲   canUseTool / hooks / in-process MCP "atom-ide"                  │
└────────┼───────────────────────── IPC (src/shared/ipc.ts) ─────────────────┘
         ▼
┌──────────────────────── Renderer (React 19 + zustand) ─────────────────────┐
│ TitleBar · ActivityBar · Sidebar(Explorer/Search/Git/History/Skills)       │
│ EditorArea(Monaco tabs, diff, inline edit ⌘K) · Panel(Terminal/Problems)   │
│ AgentPanel(chat tabs, tool cards, permissions, plan/todo, composer)        │
│ Settings · Login · Command palette · Quick open · Status bar               │
└────────────────────────────────────────────────────────────────────────────┘
```

## 1. Ground rules for contributors (humans and agents)

- **Contract first.** All IPC payloads live in `src/shared/types.ts`; channel names and the `window.atom` API in
  `src/shared/ipc.ts`; the preload (`src/preload/index.ts`) is complete. Do **not** change these files casually —
  if a change is unavoidable, keep it additive and backwards compatible and mention it in your report.
- **Main process** code is ESM TypeScript (`"type": "module"`). Use `node:` imports. `import.meta.dirname` is available.
  Electron imports: `import { ipcMain, ... } from 'electron'`. Push events with `ctx.send(IPC.xEvent, payload)` from
  `src/main/context.ts`. Never import renderer code.
- **Renderer** code talks to main only through `atom` from `src/renderer/src/lib/api.ts`. Path alias `@shared/*`
  and `@renderer/*` are available in the renderer; main/preload use relative imports to `../shared/...`.
- **State**: zustand v5 stores in `src/renderer/src/stores/`. Cross-area access only through the APIs in
  `stores/contracts.ts` (editor, workspace, auth) and the already implemented `layout.ts`, `commands.ts`, `settings.ts`.
- **Styling**: Tailwind v4 utilities mapped to theme tokens (see `src/renderer/src/styles/globals.css`). Use only token
  colors: `bg-app bg-sidebar bg-panel bg-titlebar bg-elevated bg-overlay bg-input bg-hover bg-active`,
  `text-fg text-muted text-subtle`, `border-line border-line-strong`, `text-accent bg-accent bg-accent-soft
  text-accent-fg text-accent-2`, `text-success/warning/danger/info` and `bg-*-soft`, `bg-diff-add bg-diff-del`,
  `shadow-pop shadow-glow`, `font-sans font-mono`. No hard-coded hex colors in components (Monaco/xterm themes excepted:
  read CSS variables at runtime with `getComputedStyle(document.documentElement)`). Base UI text is 13px; dense
  lists 12–13px; secondary 11–12px. Rounded corners `rounded-md`/`rounded-lg`. Icons: `lucide-react`, size 14–16.
- **Design language**: calm, dense, professional — think Cursor/VS Code/Linear. Dark by default, subtle 1px borders,
  hover = `bg-hover`, selected = `bg-active`, focus ring = accent. Smooth but quick transitions (≤150 ms). Empty
  states always explain what to do next. Every icon-only button has a `title` tooltip.
- **Dependencies**: only what is already in `package.json`. Do not add packages.
- **react-resizable-panels v4** API: `Group` (prop `orientation="horizontal"|"vertical"`), `Panel`
  (`defaultSize`, `minSize`, `maxSize`, `collapsible`, `collapsedSize`, `panelRef`), `Separator`. **Numbers are
  pixels, strings are percentages** (`defaultSize="20"` = 20%). Imperative handle via `usePanelRef()` with
  `collapse() / expand() / isCollapsed() / resize()`. Read `node_modules/react-resizable-panels/dist/react-resizable-panels.d.ts` when unsure.
- **lucide-react v1**, **@xterm/xterm v6**, **monaco-editor 0.57**, **React 19** (there is no global `JSX` namespace — omit component return types or use `ReactElement` /
  `ReactNode` imported from `react`), **zod v4** (main only, for MCP tool schemas).
- Code quality: strict TypeScript, no `any` unless interfacing with untyped SDK payloads (prefer `unknown` + narrowing),
  small focused components, comments only where intent is non-obvious.
- Verification: `npm run typecheck` and `npm run build` must pass.

## 2. Directory layout & ownership

```
resources/
  icon.png, icon.svg
  atom-plugin/                       # bundled Claude Code plugin, loaded into every agent session
    .claude-plugin/plugin.json       # {"name":"atom", ...}
    skills/<name>/SKILL.md           # exposed as atom:<name>
    agents/<name>.md                 # subagents, exposed as atom:<name>
    commands/<name>.md               # slash commands, exposed as /atom:<name>
src/shared/        types.ts ipc.ts modes.ts defaults.ts paths.ts          (foundation — done)
src/preload/       index.ts index.d.ts                                     (done)
src/main/
  index.ts context.ts app-ipc.ts menu.ts                                   (done)
  services/settings.ts                                                     (done)
  services/workspace.ts fs.ts search.ts git.ts terminal.ts library.ts      (core services)
  services/claude-binary.ts auth.ts                                        (auth)
  agent/manager.ts session.ts options.ts prompt.ts ide-mcp.ts ide-bridge.ts oneshot.ts  (agent harness)
src/renderer/src/
  main.tsx styles/globals.css lib/{api,cn,ids,platform}.ts                 (done)
  stores/{contracts,layout,commands,settings}.ts                           (done)
  App.tsx, components/workbench/*, explorer/*, search/*, git/*, editor/*,
  terminal/*, palette/*, statusbar, stores/{workspace,editor,terminal,git}.ts, lib/{monaco,ide-bridge,file-icons}.ts
                                                                           (workbench)
  components/agent/*, stores/agent.ts, lib/agent-reducer.ts                (agent panel)
  components/settings/*, components/auth/*, components/skills/*,
  stores/{auth,library}.ts                                                 (settings, auth, skills)
  components/ui/*                                                          (shared primitives — see §6)
```

## 3. Main-process services

Each service file exports `registerXxxIpc()` (called from `src/main/index.ts`) plus helpers other services use.

### workspace.ts
- `IPC.workspaceOpenDialog` → `dialog.showOpenDialog({ properties: ['openDirectory','createDirectory'] })`.
- `IPC.workspaceOpen(path)` → validates directory, sets current workspace, updates `settings.recentWorkspaces`
  (dedupe, newest first, max 12) and `lastWorkspace`, (re)starts the fs watcher (`startWatching(root)` from fs.ts),
  emits `IPC.workspaceChangedEvent`, returns `WorkspaceInfo` (`isGitRepo` = `.git` exists in root or ancestors).
- Export `getCurrentWorkspace(): WorkspaceInfo | null`.
- `IPC.workspaceListFiles(root)` → delegates to `listWorkspaceFiles(root)` from search.ts.

### fs.ts
- readDir: entries sorted dirs first then case-insensitive name; hide entries matching `settings.filesExclude` names
  (but always show dotfiles like `.env`, `.github`). readFile: detect binary (NUL byte in first 8 KB); images ≤10 MB →
  base64; text >5 MB → `tooLarge`. writeFile returns `FileStat`. createFile/createDir (recursive, error if exists),
  rename (create parent dirs), delete → `shell.trashItem` (fallback `rm -r`), stat, copy (recursive).
- Watcher: chokidar v5 on the workspace root, `ignoreInitial`, ignore `.git/objects`, `node_modules`, `dist`, `out`,
  `.next`, `target`, `__pycache__`; batch events for ~100 ms and send `IPC.fsChangeEvent` with `FsChangeEvent[]`.
  Export `startWatching(root)` and `stopWatching()`.
- All handlers must reject with a clear `Error(message)`.

### search.ts
- `listWorkspaceFiles(root)`: run ripgrep `rg --files --hidden --glob !.git` (respects .gitignore), cap 50 000, absolute
  paths; cache per root for 5 s. ripgrep path: `import { rgPath } from '@vscode/ripgrep'` then `unpackedPath(rgPath)`.
- `IPC.searchFind(root, opts)`: `rg --json` with flags for regex/case/word, include/exclude globs, `--max-columns 300`,
  stop after `maxResults` (default 2000) matches → `SearchResult`. Only one search at a time; `searchCancel` kills it.

### git.ts (simple-git)
- status → `GitStatus` (map porcelain codes; `staged` when index column not ' '/'?'). Not a repo → `{isRepo:false,...}`.
- diff(root, path?, staged?) → unified diff text (untracked file → diff against /dev/null via `git diff --no-index`).
- fileAtHead(root, path) → `git show HEAD:<rel>` or null. stage/unstage/discard (discard of untracked = delete file),
  commit (returns new hash), branches, checkout, createBranch (`checkoutLocalBranch`), log (limit 50), push, pull, init.
- Export `getRepoDiffForCommit(root): Promise<string>` (staged diff, or full working diff if nothing staged, truncated
  to 60 000 chars) for commit-message generation.

### terminal.ts (node-pty)
- `create(opts)` → spawn shell (settings.terminal.shell || `$SHELL` || `/bin/bash`; on Windows `powershell.exe`)
  with `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=atom-code`. Keep a 200 KB ring buffer of output
  per terminal. Batch data events (~8 ms) → `IPC.terminalDataEvent`. Exit → `IPC.terminalExitEvent`.
- If node-pty fails to load, fall back to `child_process.spawn` with pipes (`isPty:false`).
- Export `getTerminalOutput(maxChars = 8000): string` (most recently active terminal, ANSI stripped) and
  `disposeTerminals()`.

### library.ts
- Index skills/agents/commands from three scopes: `atom` = `ctx.pluginDir`, `user` = `~/.claude` (respect
  `CLAUDE_CONFIG_DIR`), `project` = `<workspace>/.claude`. Skills: `<scope>/skills/<name>/SKILL.md`; agents:
  `<scope>/agents/*.md`; commands: `<scope>/commands/**/*.md` (subfolders become `a:b` names).
- Parse YAML frontmatter (simple `key: value` lines, lists as `[a, b]` or `- item`, multiline `|`/`>` scalars) —
  write a small parser; no dependency.
- `qualifiedName`: `atom:<name>` for scope atom, plain `<name>` otherwise. `enabled` = not in
  `settings.agent.disabledSkills`. Bundled entries are `readOnly`.
- save → writes `<scope>/skills/<name>/SKILL.md` | `<scope>/agents/<name>.md` | `<scope>/commands/<name>.md`; validate
  kebab-case names; returns the path. delete → trash the skill directory / file (refuse for scope atom).
  openFolder → `shell.openPath` (create the directory first).
- Export `getEnabledSkillsOption(workspace): Promise<string[] | 'all'>` → `'all'` when nothing is disabled, otherwise
  the explicit list of enabled qualified names.

## 4. Authentication — Claude subscription

ATOM Code never implements OAuth itself. It drives the **official Claude Code CLI** that ships inside the Agent SDK
(platform package `@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude[.exe]`):

- `claude-binary.ts`: `resolveClaudeBinary(): string | null` → custom path when `settings.agent.useBundledClaude` is
  false and the path exists; else `createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk-' +
  platformKey + '/claude' + ext)` (platformKey: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`,
  `linux-x64-musl`, `linux-arm64-musl`, `win32-x64`, `win32-arm64`; try musl variants on linux as fallback), passed
  through `unpackedPath()`; else `claude` found on PATH. `getClaudeVersion(bin)` → `<bin> --version` (cached).
- `auth.ts`:
  - `getAuthStatus(refresh)` → runs `<claude> auth status --json` (env from `getAgentEnv()`), parses
    `{loggedIn, authMethod, apiProvider, email?, orgName?, subscriptionType?}` defensively (unknown keys ignored), maps
    to `AuthStatus` (`authMethod` "claude.ai"/"oauth" → `claude-subscription`, "oauth_token" → `oauth-token`,
    "api_key"/"apiKey" → `api-key`, "console" → `console`; apiProvider ≠ firstParty → `third-party`). Cache 30 s;
    broadcast changes on `IPC.authStatusEvent`. If `email`/`subscriptionType` are missing, enrich lazily from a live
    agent session's `accountInfo()` (manager exposes `getCachedAccountInfo()`).
  - `startLogin(mode)` → spawns in node-pty: `claudeai` → `claude auth login --claudeai`; `console` →
    `claude auth login --console`; `setup-token` → `claude setup-token`. Streams output on
    `IPC.authLoginOutputEvent`; on exit refresh status and send `IPC.authLoginExitEvent`. Detect URLs in output and
    open the first `https://claude.ai/…` / `https://console.anthropic.com/…` URL with `shell.openExternal` (the CLI
    may also open it itself; opening twice is harmless). For `setup-token`, scan the output for a token matching
    `/sk-ant-oat[0-9A-Za-z_\-]+/` and store it with `settingsService.setSecret('claudeOAuthToken', token)` — never log it.
  - `writeLogin`, `cancelLogin` (kill pty), `setApiKey`, `setOAuthToken` (stored via `settingsService.setSecret`),
    `logout` → `claude auth logout` + clear stored secrets.
  - Export `getAgentEnv(): Record<string, string>` = `process.env` + `ANTHROPIC_API_KEY` if an API key is stored, else
    `CLAUDE_CODE_OAUTH_TOKEN` if a token is stored (if neither, inherit the CLI's own login in `~/.claude`).
    Also sets `CLAUDE_AGENT_SDK_CLIENT_APP`. `disposeAuth()` kills login ptys.
- Policy note (README): subscription login is intended for the user's own personal use of ATOM Code; when distributing
  ATOM Code to others, use API-key authentication.

## 5. Agent harness (src/main/agent)

### session.ts — `AgentSession`
One chat = one long-lived SDK `query()` in **streaming-input mode** (prompt is an `AsyncIterable<SDKUserMessage>`
backed by a push queue), so follow-ups, interrupt, `setPermissionMode`, `setModel`, `applyFlagSettings`, `rewindFiles`,
`getContextUsage`, `supportedCommands/Models/Agents`, `mcpServerStatus`, `accountInfo`, `stopTask` all work live.

- Lifecycle: `start()` builds options (options.ts) and calls `query({prompt: queue, options})`, then pumps
  `for await (const msg of q)` → forward every message as `{type:'sdk', message}`, plus derived events:
  - `system/init` → `{type:'init', info}` and remember `session_id`; after init fetch capabilities
    (`supportedCommands`, `supportedModels` → `ModelOption` with `normalizeModelValue`, `supportedAgents`) → `{type:'capabilities'}`.
  - `result` → status `idle`; then refresh context usage (`getContextUsage({detail:'summary'})` → `ContextUsageInfo`).
  - `system/session_state_changed` → status running/idle/awaiting-input.
  - `rate_limit_event` → `{type:'rate-limit'}`; result/assistant errors whose text starts with one of the SDK's
    `USAGE_LIMIT_ERROR_PREFIXES` → `{type:'error', kind:'usage-limit'}`; auth failures (401, "not logged in",
    "invalid api key", "/login") → `kind:'auth'`.
  - Iterator ends/throws → status `closed`/`error`. Restartable: `send()` on a closed session restarts it with
    `resume: sessionId`.
- `send(OutgoingUserMessage)`: render attachments into the prompt (prompt.ts `renderUserPrompt`), build
  `SDKUserMessage` `{type:'user', message:{role:'user', content}, parent_tool_use_id:null, uuid: msg.uuid,
  session_id: '', origin:{kind:'human'}, priority?}` where content is a string or `[...imageBlocks, {type:'text'}]`;
  emit `{type:'user-sent'}`; status → running.
- Permissions — `canUseTool(toolName, input, {signal, suggestions, title, displayName, decisionReason, blockedPath, toolUseID})`:
  - Create a `PermissionRequest` (`kind` = `plan` for `ExitPlanMode`, `question` for `AskUserQuestion`, else `tool`),
    emit it, status `awaiting-input`, await the renderer's `PermissionResponse` (or `signal` abort → deny).
  - allow once → `{behavior:'allow', updatedInput: response.updatedInput ?? input}`; session → plus
    `updatedPermissions: suggestions` with `destination:'session'`; always → suggestions with
    `destination:'localSettings'`. Plan approval with `nextPermission` → after allowing, call
    `q.setPermissionMode(nextPermission)` and emit `mode-changed`. deny → `{behavior:'deny', message: response.message
    || 'The user declined this action.', interrupt}`.
  - Emit `permission-resolved`. Pending requests are denied on interrupt/close.
- Hooks: `PostToolUse` for `Edit|Write|MultiEdit|NotebookEdit` → emit `{type:'file-changed', path, tool}`.
- `setMode(modeId)`: if only the permission behaviour changes (both modes share tools/prompt) → `setPermissionMode`;
  otherwise restart the query with `resume` + new options (if a turn is running, apply after it ends). Emit `mode-changed`.
- `setPermission(policy)` → `setPermissionMode` (unless the mode forces plan). `setModel` → `q.setModel(model || undefined)`.
  `setEffort` → `q.applyFlagSettings({ effortLevel: effort === 'auto' ? null : effort })`.
- `interrupt()` → `q.interrupt()`; `close()` → deny pending, `q.close()`.
- `rewind(uuid, dryRun)` → `q.rewindFiles(uuid, {dryRun})`.

### options.ts — `buildQueryOptions(params)` → SDK `Options`
- `cwd: workspace`, `pathToClaudeCodeExecutable: resolveClaudeBinary()`, `env: getAgentEnv()`.
- `systemPrompt: { type:'preset', preset:'claude_code', append: buildSystemAppend(...), snapshot: false }`.
- `settingSources`: `['project','local']` plus `'user'` when `settings.agent.loadUserSettings` (loads CLAUDE.md, user/project skills).
- `plugins: [{ type:'local', path: ctx.pluginDir }]`, `skills: await getEnabledSkillsOption(workspace)`.
- `permissionMode`: `'plan'` if `mode.forcedPermissionMode === 'plan'` else the chat policy; `allowDangerouslySkipPermissions:
  true` only when policy is `bypassPermissions`. `canUseTool` from the session.
- Tools: read-only modes → `tools: READ_ONLY_TOOLS` built-ins + `allowedTools` for the IDE read tools; `mode.tools`
  overrides; `disallowedTools`: union of `mode.disallowedTools` and `settings.agent.disallowedTools`.
  `allowedTools`: `settings.agent.allowedTools` + all `mcp__atom-ide__*` read tools.
- `model` (omit when ''), `effort` (omit when 'auto'), `thinking: {type:'adaptive', display: settings.agent.thinkingDisplay}`
  only when the SDK type allows `display` on adaptive (check `ThinkingAdaptive` in sdk.d.ts), `includePartialMessages: true`,
  `forwardSubagentText: true`, `agentProgressSummaries: true`, `enableFileCheckpointing: settings.agent.enableCheckpoints`,
  `promptSuggestions`, `maxTurns`/`maxBudgetUsd` when set, `sandbox` when enabled (`{enabled:true, failIfUnavailable:false}`).
- `mcpServers`: `{ 'atom-ide': createIdeMcpServer(chatId) }` + enabled `settings.mcpServers` converted to SDK configs.
- `agents`: none here (subagents ship in the plugin). `resume`/`forkSession`/`title` when given.
- `stderr: (d) => emit({type:'stderr', data: d})` (rate-limited).
- `toolConfig: { askUserQuestion: { previewFormat: 'markdown' } }` if the type allows it.

### prompt.ts
- `buildSystemAppend({ mode, settings, workspace, projectRules })`: ATOM identity + IDE conventions:
  "You are ATOM, the coding agent inside ATOM Code … The user watches your work in an IDE: file edits appear as diffs,
  `path:line` references are clickable — always cite code that way; use the `atom-ide` tools to see open editors,
  the current selection, diagnostics (compiler/linter errors) and the integrated terminal; prefer the bundled `atom:*`
  skills when they fit; keep answers concise, use GitHub-flavoured markdown." + mode.systemPrompt + mode skill hints +
  `settings.agent.customInstructions` + contents of `<workspace>/ATOM.md` (project rules, ≤ 20 KB) if present.
- `renderUserPrompt(msg)`: prepend `<atom_context>` with `<active_editor path line language/>`, `<selection ...>` blocks,
  `<terminal_output>`, `<diagnostics>`, `<git_diff>`; file attachments become `@relative/path` mentions (the CLI expands
  them); folders become `@relative/path/`. Then the user text.

### ide-mcp.ts / ide-bridge.ts
- `ide-bridge.ts`: `requestIde(method, params, timeoutMs = 8000)` sends `IPC.ideRequestEvent` with a requestId and
  resolves when the renderer calls `IPC.ideRespond(requestId, {result}|{error})`. `registerIdeBridgeIpc()` handles responses.
- `ide-mcp.ts`: `createIdeMcpServer()` via `createSdkMcpServer({ name: 'atom-ide', version: '1.0.0', tools: [...] })`
  with zod v4 schemas and `tool()` from the SDK:
  `get_open_editors` · `get_selection` · `get_diagnostics({path?})` · `get_terminal_output({max_chars?})` (from
  terminal.ts directly) · `open_file({path, line?})` (reveals the file to the user). Results are JSON text content.

### manager.ts
- Map `chatId → AgentSession`. `registerAgentIpc()` wires every `IPC.agent*` handler. Events are sent as
  `IPC.agentEvent` `{chatId, event}`. Session history: `listSessions({dir: workspace, limit: 100})` → `SessionSummary`
  (title = customTitle || summary || firstPrompt), `getSessionMessages(id, {dir})`, `renameSession`, `deleteSession`.
  `getCachedAccountInfo()` for auth. `disposeAgents()` closes all.

### oneshot.ts — `registerAiIpc()`
- `aiInlineEdit`: a single-turn `query()` with `tools: []`, `settingSources: []`, `persistSession: false`,
  `maxTurns: 1`, custom `systemPrompt` ("You rewrite code. Output only the replacement code for the selection, no
  markdown fences, no commentary, preserve indentation…"), model `settings.agent.inlineEditModel || 'sonnet'`,
  `includePartialMessages: true` → stream accumulated text over `IPC.aiInlineEditDeltaEvent`; strip accidental fences.
  Cancel via AbortController.
- `aiCommitMessage(root)`: same pattern with the diff from `getRepoDiffForCommit`; Conventional Commits style subject
  ≤ 72 chars + optional body; model `commitMessageModel || 'haiku'`.

## 6. Renderer

### Shared UI primitives (`components/ui/`, workbench area owns them, others may use)
`Button` (variants primary/secondary/ghost/danger, sizes sm/md), `IconButton`, `Tooltip` (title-based is fine),
`Dropdown`/`Menu` (popover list with keyboard nav), `Modal` (overlay + panel, Esc closes), `Input`, `Textarea`,
`Toggle`, `Select`, `Kbd`, `Spinner`, `Badge`, `EmptyState`, `ContextMenu` (right-click menus), `Toast` system
(`toast.success/error/info(msg)` via a tiny store `stores/toast.ts`), `AtomLogo` (SVG mark: nucleus + 3 orbits, uses
accent/accent-2 gradient).

### Workbench (App.tsx + components/workbench)
- App boot: `useSettingsStore.load()`, restore `settings.lastWorkspace`, install keybindings, register core commands,
  register the IDE bridge (`lib/ide-bridge.ts`: `atom.ide.onRequest` answering from the editor store), subscribe
  `atom.app.onMenuCommand` → `executeCommand`, `onBeforeClose` → confirm when `hasDirtyTabs()`.
- Layout (react-resizable-panels): TitleBar (38 px, `drag`; mac: 78 px left inset for traffic lights; win/linux:
  138 px right inset for native window controls overlay) with ATOM logo, workspace name, a centered command-center
  search pill (opens quick open), layout toggle buttons (sidebar / panel / agent) and account avatar → ActivityBar
  (48 px: Explorer, Search, Source Control (badge = change count), Agent History, Skills; bottom: Account, Settings) →
  Sidebar → [Editor area / bottom Panel] → Agent panel (right, default ~32%) → StatusBar (24 px).
- Editor area: tabs (dirty dot, close on middle-click, preview tabs italic, context menu: close others/right/all,
  copy path, reveal in explorer), breadcrumbs, Monaco (`lib/monaco.ts`: local workers via `?worker` imports,
  `loader.config({ monaco })`, ATOM themes built from CSS variables, re-themed on theme change), Monaco diff editor
  tabs, image preview, Welcome tab (logo, "Open Folder", recent workspaces, sign-in status, shortcut cheatsheet).
  Keep one model per file; save with ⌘S (format on save if enabled); auto-save per settings; reload buffers on
  external change if not dirty; agent-edited lines get the `atom-agent-changed-*` decoration briefly.
- **Inline edit (⌘K)** in Monaco: floating input widget above the selection → `atom.ai.inlineEdit` streaming →
  shows a diff preview (decorations or inline diff) with Accept (⌘↩) / Reject (Esc).
- **Add to chat (⌘L)** in Monaco: sends the current selection as a `selection` attachment to the agent composer
  (`useAgentStore.getState().addAttachment(...)` — agent store API, see below) and focuses it.
- Explorer: lazy tree, file-type icons (`lib/file-icons.ts` — colored lucide icons by extension), git decorations
  (M/U/A colors), new file/folder inline inputs, rename (F2), delete, reveal, copy path, drag & drop move,
  collapse all, auto-reveal active file, refresh on fs events.
- Search panel: query + toggles (case, word, regex), include/exclude, results grouped by file with highlighted match,
  click → open at line.
- Source Control: branch picker, staged / changes groups with stage/unstage/discard per file and all, click → diff tab
  (HEAD vs working), commit box with "✨ Generate message" (`atom.ai.commitMessage`) and ⌘↩ to commit, push/pull.
- Bottom panel: Terminal (multiple xterm tabs, fit addon, web links, theme from CSS variables, `+`/kill buttons),
  Problems (Monaco markers grouped by file), Output (agent stderr / logs).
- Command palette (`⌘⇧P`, prefix `>` commands) + Quick open (`⌘P`, fuzzy file search over `useWorkspaceStore.files`,
  `:line` go-to-line). Fuzzy scoring: write a small subsequence scorer (no dependency).
- Status bar: branch + sync, problems counts, agent status (spinner + "ATOM is working…"), active mode, model,
  cursor position, language, plan/account badge.
- Default keybindings: `mod+p` quick open, `mod+shift+p` palette, `mod+b` sidebar, `mod+j` panel, `mod+alt+b` agent,
  `mod+l` focus agent / add selection, `mod+shift+l` new chat, `mod+k` inline edit (inside Monaco), `mod+s` save,
  `mod+alt+s` save all, `mod+w` close tab, `mod+,` settings, `mod+shift+f` search, `mod+shift+e` explorer,
  `mod+shift+g` git, `` ctrl+` `` terminal, `shift+tab` (in composer) cycle mode, `mod+.` mode picker, `mod+/` model picker.

### Agent panel (components/agent, stores/agent.ts, lib/agent-reducer.ts)
- `useAgentStore` API (others rely on it): `chats: Record<chatId, ChatState>`, `order: string[]`, `activeChatId`,
  `newChat(opts?)`, `closeChat(id)`, `setActive(id)`, `send(text)`, `interrupt()`, `addAttachment(att:
  ContextAttachment)`, `focusComposer()`, `setMode(id)`, `setPermission(p)`, `setModel(m)`, `setEffort(e)`,
  `respondPermission(reqId, response)`, `resumeSession(sessionId)`, `rewind(userMsgUuid)`.
- Reducer turns `AgentEvent`s into a chat transcript: user messages (text, attachments chips, images, checkpoint
  button), assistant turns made of ordered blocks — streamed text (markdown), thinking (collapsible "Thought for Ns",
  shimmer while streaming), tool calls (built from `stream_event` content_block_start/input_json_delta, finalized by
  `assistant` messages, completed by `user` tool_result blocks + `tool_use_result`), subagent tasks (nested under the
  Agent tool card via `parent_tool_use_id`; `task_started/task_progress/task_notification`), compaction dividers,
  API-retry banners, errors, and a turn footer (duration, turns, ≈cost, tokens) from `result`.
- Tool cards (compact, expandable, status icon, elapsed time):
  Read (file chip + line range, click opens file), Edit/MultiEdit/Write (path, +/− counts, inline unified diff using
  `diff` package `structuredPatch`, "Open diff" → `openDiff`, "Open file"), Bash (description, `$ command`, output in
  mono with ANSI stripped, exit status), Grep/Glob (pattern, path, result count, file list), WebSearch/WebFetch (query /
  URL), Agent/Task (subagent type + description, live progress, nested tool list, final report), TodoWrite (checklist),
  Skill (skill name chip), NotebookEdit, MCP tools (server/tool name + JSON input/output), generic fallback.
- Live **Todo/Plan strip** pinned above the composer showing the latest TodoWrite list with progress.
- Permission card inline at the end of the transcript (and focusable): title, rendered input (command, diff preview
  for edits, URL), buttons Allow (↩) · Allow for session · Always allow · Deny (Esc) + optional feedback text.
  Plan card (ExitPlanMode): renders the plan markdown with "Approve & auto-accept edits", "Approve (ask for edits)",
  "Keep planning" (deny with feedback). Question card (AskUserQuestion): per question tabs/options (single/multi
  select + "Other" free text), submit → `updatedInput.answers` keyed by question text.
- Composer: auto-growing textarea, `@` mention menu (files from workspace store + "current file", "selection",
  "terminal", "problems", "git diff"), `/` slash menu (capabilities.commands + local commands: /clear → new chat,
  /compact, /init, /review, /model, /mode), image paste/drop (≤ 5 MB → base64), attachment chips, mode picker (icons/
  colors from modes, Shift+Tab cycles), permission picker, model picker (capabilities.models or FALLBACK_MODELS),
  effort picker, context-usage ring, Send (↩) / newline (⇧↩) / Stop button while running (messages typed while
  running are queued with priority 'next').
- Header: chat tabs (title from first prompt / session), new chat, history dropdown (`listSessions`), close.
- Empty state: ATOM logo, mode cards, example prompts, sign-in CTA if not logged in.
- History sidebar view (`components/agent/HistoryPanel.tsx`): sessions for the workspace, search, open (resume),
  rename, delete.

### Settings / Auth / Skills
- `stores/auth.ts` implements `AuthStoreApi`. `components/auth/LoginDialog.tsx`: modal with an embedded xterm bound to
  `atom.auth.startLogin(mode)` output (`writeLogin` for typed input so the user can paste the code), explanatory copy,
  status, success state. `components/auth/AuthGate.tsx`: friendly onboarding card shown in the agent panel when
  logged out: "Sign in with Claude (Pro/Max)" primary, "Use long-lived token", "Use API key" (input → `setApiKey`).
- `components/settings/SettingsView.tsx`: full-screen overlay (or editor-area page) with left nav sections:
  Account (status, plan, sign in/out, API key/token), Models & Agent (defaults: model, effort, mode, permission
  policy, thinking display, checkpoints, budget/turn limits, prompt suggestions, sandbox, Claude binary), Modes
  (list built-ins read-only + CRUD custom modes: name, icon, color, description, permission (plan/inherit),
  read-only, tools, prompt), Rules (global custom instructions textarea + "Create ATOM.md for this project"),
  Permissions (allowed/disallowed tool rules list editor), MCP Servers (CRUD stdio/http/sse with env/headers,
  enable toggle), Editor, Terminal, Appearance (theme cards with preview, UI font size), About.
- `components/skills/SkillsPanel.tsx` (sidebar view): tabs Skills / Agents / Commands, grouped by scope (ATOM,
  User, Project), search, enable toggle for skills (updates `disabledSkills`), click → opens SKILL.md in the editor
  (read-only for bundled), "New skill" (scope + name + template → `library.save` then open), duplicate bundled skill
  to user scope, delete, open folder. `stores/library.ts` caches `LibraryIndex` and refreshes on workspace change.

## 7. Bundled ATOM plugin (resources/atom-plugin)

High-quality, practical skills written for an agent, each with YAML frontmatter `name` + `description` (description
says *when* to use it — that is what triggers it), a concise body with concrete steps, checklists and examples:
skills: `systematic-debugging`, `test-driven-development`, `code-review`, `writing-plans`, `executing-plans`,
`refactoring`, `git-workflow`, `frontend-design`, `api-design`, `security-audit`, `performance-optimization`,
`documentation`, `project-onboarding`, `dependency-upgrades`, `database-migrations`, `error-handling`, `writing-skills`.
agents: `code-reviewer`, `debugger`, `test-engineer`, `architect`, `security-auditor`, `docs-writer`, `refactorer`,
`explorer` (frontmatter `name`, `description`, `tools`, `model`).
commands: `review`, `test`, `commit`, `explain`, `fix`, `plan`, `init`, `pr`, `refactor`, `docs`, `optimize`,
`security` (frontmatter `description`, `argument-hint`, optional `allowed-tools`; body uses `$ARGUMENTS`).
