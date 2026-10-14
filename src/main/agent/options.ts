/**
 * Builds the Claude Agent SDK `Options` for an ATOM Code chat (see docs/ARCHITECTURE.md §5).
 *
 * Pure helpers (tool surface, permission mode, model/effort resolution, MCP conversion) are exported
 * separately so the session can compare the effective configuration of two modes without spawning.
 */
import { existsSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CanUseTool,
  HookCallbackMatcher,
  HookEvent,
  McpSdkServerConfigWithInstance,
  McpServerConfig,
  Options,
  PermissionMode,
  SettingSource
} from '@anthropic-ai/claude-agent-sdk'
import { READ_ONLY_TOOLS, normalizeModelValue } from '../../shared/modes'
import type { AgentModeDefinition, AppSettings, EffortLevel, McpServerSetting, PermissionPolicy } from '../../shared/types'
import { ctx } from '../context'
import { getAgentEnv } from '../services/auth'
import { createClaudeSpawner, resolveClaudeBinary } from '../services/claude-binary'
import { getEnabledSkillsOption } from '../services/library'
import { createIdeMcpServer } from './ide-mcp'
import { PROJECT_RULES_MAX_CHARS, buildSystemAppend } from './prompt'
import { isPathTrusted, resolveInsideWorkspace } from './trust'

/** Name of the in-process MCP server exposing the IDE tools (tool prefix `mcp__atom-ide__`). */
export const IDE_SERVER_NAME = 'atom-ide'

/** Tools whose PostToolUse hook reports a changed file to the renderer. */
export const FILE_EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const

/** Search tools some native builds only expose when listed explicitly (see `Options.tools` docs). */
const SEARCH_TOOLS = ['Glob', 'Grep']

const IDE_READ_TOOLS = READ_ONLY_TOOLS.filter((t) => t.startsWith(`mcp__${IDE_SERVER_NAME}__`))

export interface ModeToolConfig {
  /** Base set of built-in tools; undefined = Claude Code's default preset. */
  tools?: string[]
  /** Auto-approved tools / permission rules. */
  allowedTools: string[]
  disallowedTools: string[]
}

function uniq(items: Iterable<string>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    const item = raw.trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/** The tool surface of a mode, merged with the user's global allow/deny rules. */
export function resolveToolConfig(mode: AgentModeDefinition, settings: AppSettings): ModeToolConfig {
  const disallowedTools = uniq([...(mode.disallowedTools ?? []), ...settings.agent.disallowedTools])
  const denied = new Set(disallowedTools)

  let tools: string[] | undefined
  const extraAllowed: string[] = []
  if (mode.tools && mode.tools.length > 0) {
    // Explicit allowlist: built-ins form the base set, MCP names are pre-approved.
    tools = uniq(mode.tools.filter((t) => !t.startsWith('mcp__')))
    extraAllowed.push(...mode.tools.filter((t) => t.startsWith('mcp__')))
  } else if (mode.readOnly) {
    tools = uniq(READ_ONLY_TOOLS.filter((t) => !t.startsWith('mcp__')))
  }

  const searchTools = tools ? SEARCH_TOOLS.filter((t) => tools.includes(t)) : SEARCH_TOOLS
  const allowedTools = uniq([...settings.agent.allowedTools, ...IDE_READ_TOOLS, ...searchTools, ...extraAllowed]).filter(
    (t) => !denied.has(t)
  )
  return { tools: tools?.filter((t) => !denied.has(t)), allowedTools, disallowedTools }
}

/** SDK permission mode for a mode + chat policy ('plan' when the mode forces it). */
export function resolvePermissionMode(mode: AgentModeDefinition, policy: PermissionPolicy): PermissionMode {
  return mode.forcedPermissionMode === 'plan' ? 'plan' : policy
}

/** The chat's model wins; '' falls back to the mode's preferred model ('' = Claude Code default). */
export function resolveModel(chatModel: string, mode: AgentModeDefinition): string {
  // The CLI lists its default model as "default"; ATOM Code passes "no model" for it instead.
  return normalizeModelValue(chatModel.trim()) || normalizeModelValue(mode.model?.trim()) || ''
}

/** The chat's effort wins; 'auto' falls back to the mode's effort (undefined = model default). */
export function resolveEffort(chatEffort: EffortLevel | 'auto', mode: AgentModeDefinition): EffortLevel | undefined {
  if (chatEffort !== 'auto') return chatEffort
  return mode.effort
}

/**
 * A stable fingerprint of everything a running query cannot change live (tool surface, system
 * prompt append and the launch-only agent settings). Two modes with the same signature can be
 * switched with `setPermissionMode` alone; a settings change that alters it restarts idle chats.
 */
export function computeConfigSignature(
  mode: AgentModeDefinition,
  settings: AppSettings,
  workspace: string,
  projectRules: string | null
): string {
  const toolConfig = resolveToolConfig(mode, settings)
  const systemAppend = buildSystemAppend({ mode, settings, workspace, projectRules })
  const agent = settings.agent
  return JSON.stringify({
    tools: toolConfig.tools ?? null,
    allowed: [...toolConfig.allowedTools].sort(),
    disallowed: [...toolConfig.disallowedTools].sort(),
    systemAppend,
    // Trusting (or revoking) the workspace changes which setting sources and MCP servers load.
    trusted: isPathTrusted(settings.trustedWorkspaces, workspace),
    // Options that are only read when the CLI is spawned (see buildQueryOptions).
    launch: {
      disabledSkills: [...agent.disabledSkills].sort(),
      mcpServers: toSdkMcpServers(settings.mcpServers),
      loadUserSettings: agent.loadUserSettings,
      thinkingDisplay: agent.thinkingDisplay,
      enableCheckpoints: agent.enableCheckpoints,
      promptSuggestions: agent.promptSuggestions,
      maxTurns: agent.maxTurns,
      maxBudgetUsd: agent.maxBudgetUsd,
      sandbox: agent.sandbox,
      claudeBinary: agent.useBundledClaude ? 'bundled' : (agent.claudeExecutablePath ?? '').trim()
    }
  })
}

/**
 * Read `<workspace>/ATOM.md` (project rules for agents), capped at ~20 KB. Null when absent, unreadable,
 * the workspace is not trusted, or the file (through symlinks) lies outside the workspace — a link to
 * `~/.ssh/id_rsa` or `/proc/self/environ` must never end up in the system prompt.
 */
export async function readProjectRules(workspace: string, trusted: boolean): Promise<string | null> {
  if (!trusted) return null
  const link = join(workspace, 'ATOM.md')
  if (!existsSync(link)) return null
  const file = resolveInsideWorkspace(workspace, link)
  if (!file) return null
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(file, 'r')
    if (!(await handle.stat()).isFile()) return null
    // UTF-8 can use up to 4 bytes per char; read enough for the char cap plus a truncation marker.
    const maxBytes = PROJECT_RULES_MAX_CHARS * 4 + 4
    const buffer = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
    const text = buffer.subarray(0, bytesRead).toString('utf8').replace(/^﻿/, '')
    return text.trim() ? text : null
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/** Convert enabled MCP server settings into SDK configs (invalid or reserved entries are skipped). */
export function toSdkMcpServers(servers: McpServerSetting[]): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {}
  for (const s of servers) {
    const name = s.name?.trim()
    if (!s.enabled || !name || name === IDE_SERVER_NAME || out[name]) continue
    if (s.type === 'stdio') {
      const command = s.command?.trim()
      if (!command) continue
      out[name] = {
        type: 'stdio',
        command,
        ...(s.args && s.args.length > 0 ? { args: s.args } : {}),
        ...(s.env && Object.keys(s.env).length > 0 ? { env: s.env } : {})
      }
    } else if (s.type === 'http' || s.type === 'sse') {
      const url = s.url?.trim()
      if (!url) continue
      const headers = s.headers && Object.keys(s.headers).length > 0 ? { headers: s.headers } : {}
      out[name] = s.type === 'http' ? { type: 'http', url, ...headers } : { type: 'sse', url, ...headers }
    }
  }
  return out
}

export interface BuildQueryOptionsParams {
  chatId: string
  workspace: string
  mode: AgentModeDefinition
  settings: AppSettings
  /** Chat model ('' = default). */
  model: string
  effort: EffortLevel | 'auto'
  permission: PermissionPolicy
  /**
   * The user trusts this workspace's Claude Code project configuration (see workspace-trust.ts). When
   * false, project/local settings (hooks, env, permissions), `.mcp.json` servers, CLAUDE.md and ATOM.md
   * are not loaded.
   */
  trusted: boolean
  /** Already-read ATOM.md contents (avoid reading twice); undefined = read now. */
  projectRules?: string | null
  /** Permission rules the user allowed "for this chat" (re-applied on every launch of the chat). */
  sessionAllowRules?: string[]
  /** Extra working directories the user allowed for this chat. */
  sessionDirectories?: string[]
  /** Spending limit for this launch in USD (what is left of the chat's budget); undefined = settings value. */
  maxBudgetUsd?: number | null
  resume?: string
  forkSession?: boolean
  title?: string
  canUseTool: CanUseTool
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>
  onStderr?: (data: string) => void
  abortController?: AbortController
}

/**
 * A fresh in-process IDE server per launch (an MCP server instance cannot be reused across
 * processes). The chat id is passed for implementations that scope IDE requests per chat; the
 * documented signature takes no arguments, so the extra argument is harmless either way.
 */
function createIdeServer(chatId: string): McpSdkServerConfigWithInstance {
  const create = createIdeMcpServer as (chatId?: string) => McpSdkServerConfigWithInstance
  return create(chatId)
}

async function enabledSkills(workspace: string): Promise<string[] | 'all' | undefined> {
  try {
    return await getEnabledSkillsOption(workspace)
  } catch {
    // Library unavailable: fall back to the CLI's defaults instead of failing the chat.
    return undefined
  }
}

/** Build the full SDK `Options` for one `query()` run of a chat. */
export async function buildQueryOptions(params: BuildQueryOptionsParams): Promise<Options> {
  const { workspace, mode, settings, trusted } = params
  const agent = settings.agent
  const projectRules = params.projectRules === undefined ? await readProjectRules(workspace, trusted) : params.projectRules

  // 'local' is repository content too (.claude/settings.local.json can be committed or shipped in an archive).
  const settingSources: SettingSource[] = trusted ? ['project', 'local'] : []
  if (agent.loadUserSettings) settingSources.unshift('user')

  const toolConfig = resolveToolConfig(mode, settings)
  const denied = new Set(toolConfig.disallowedTools)
  const allowedTools = uniq([...toolConfig.allowedTools, ...(params.sessionAllowRules ?? [])]).filter((t) => !denied.has(t))
  const model = resolveModel(params.model, mode)
  const effort = resolveEffort(params.effort, mode)
  const skills = await enabledSkills(workspace)
  const claudeBinary = resolveClaudeBinary()
  const pluginDir = ctx.pluginDir
  const maxBudgetUsd = params.maxBudgetUsd === undefined ? agent.maxBudgetUsd : params.maxBudgetUsd

  const options: Options = {
    cwd: workspace,
    env: getAgentEnv(),
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: buildSystemAppend({ mode, settings, workspace, projectRules }),
      // The append changes with the mode and is re-applied on resume, so never record it.
      snapshot: false
    },
    settingSources,
    permissionMode: resolvePermissionMode(mode, params.permission),
    canUseTool: params.canUseTool,
    allowedTools,
    disallowedTools: toolConfig.disallowedTools,
    mcpServers: {
      ...toSdkMcpServers(settings.mcpServers),
      [IDE_SERVER_NAME]: createIdeServer(params.chatId)
    },
    thinking: { type: 'adaptive', display: agent.thinkingDisplay },
    includePartialMessages: true,
    forwardSubagentText: true,
    agentProgressSummaries: true,
    enableFileCheckpointing: agent.enableCheckpoints,
    promptSuggestions: agent.promptSuggestions,
    toolConfig: { askUserQuestion: { previewFormat: 'markdown' } }
  }

  if (claudeBinary) {
    options.pathToClaudeCodeExecutable = claudeBinary
    const spawner = createClaudeSpawner(claudeBinary, params.onStderr)
    if (spawner) options.spawnClaudeCodeProcess = spawner
  }
  // Untrusted workspace: only ATOM's own MCP servers (settings + atom-ide), never the project's .mcp.json.
  if (!trusted) options.strictMcpConfig = true
  if (existsSync(pluginDir)) options.plugins = [{ type: 'local', path: pluginDir }]
  if (skills !== undefined) options.skills = skills
  if (toolConfig.tools) options.tools = toolConfig.tools
  if (params.sessionDirectories && params.sessionDirectories.length > 0) options.additionalDirectories = [...params.sessionDirectories]
  if (params.permission === 'bypassPermissions') options.allowDangerouslySkipPermissions = true
  if (model) options.model = model
  if (effort) options.effort = effort
  if (agent.maxTurns !== null && agent.maxTurns > 0) options.maxTurns = Math.floor(agent.maxTurns)
  if (maxBudgetUsd !== null && maxBudgetUsd > 0) options.maxBudgetUsd = maxBudgetUsd
  if (agent.sandbox) options.sandbox = { enabled: true, failIfUnavailable: false }
  if (params.hooks) options.hooks = params.hooks
  if (params.onStderr) options.stderr = params.onStderr
  if (params.abortController) options.abortController = params.abortController

  if (params.resume) {
    options.resume = params.resume
    if (params.forkSession) options.forkSession = true
  } else if (params.title?.trim()) {
    options.title = params.title.trim()
  }

  return options
}
