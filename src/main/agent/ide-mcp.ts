/**
 * The in-process `atom-ide` MCP server: gives the agent eyes on the user's IDE — open editors,
 * selection, diagnostics, the integrated terminal — and a way to show the user a location
 * (docs/ARCHITECTURE.md §5). Tools are exposed to the model as `mcp__atom-ide__<name>`.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpSdkServerConfigWithInstance, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { IdeDiagnostic, IdeOpenEditorsResult, IdeSelectionResult } from '../../shared/types'
import { getTerminalOutput } from '../services/terminal'
import { requestIde } from './ide-bridge'

type CallToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>

export const IDE_MCP_SERVER_NAME = 'atom-ide'

const DEFAULT_TERMINAL_CHARS = 8000
const MAX_TERMINAL_CHARS = 100_000
const MAX_DIAGNOSTICS = 300
const MAX_SELECTION_CHARS = 100_000
const RENDERER_FALLBACK_TIMEOUT_MS = 3000

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

const SERVER_INSTRUCTIONS = [
  'These tools connect you to the ATOM Code IDE the user is working in.',
  'Use get_open_editors / get_selection whenever the user refers to "this file", "this code", "here" or "the selection" without naming it.',
  'Use get_diagnostics to see the compiler/linter problems the user sees, and again after your edits to confirm you did not introduce new ones.',
  'Use get_terminal_output when the user mentions an error or output in their terminal.',
  'Use open_file to show the user the exact location you are talking about.'
].join(' ')

// ─────────────────────────────────────────────────────────────────────────────
// Result helpers
// ─────────────────────────────────────────────────────────────────────────────

function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

function jsonResult(value: unknown): CallToolResult {
  return textResult(JSON.stringify(value, null, 2))
}

function errorResult(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err)
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}

/** Run a tool body and turn any thrown error into an MCP error result (never throws). */
async function safely(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run()
  } catch (err) {
    return errorResult(err)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const SEVERITY_ORDER: Record<IdeDiagnostic['severity'], number> = { error: 0, warning: 1, info: 2, hint: 3 }

/** Normalize the renderer's diagnostics answer, sort by severity/location and summarize it. */
export function summarizeDiagnostics(raw: unknown, limit = MAX_DIAGNOSTICS): {
  total: number
  errors: number
  warnings: number
  others: number
  truncated: boolean
  diagnostics: IdeDiagnostic[]
} {
  const list: unknown = isRecord(raw) ? raw.diagnostics : raw
  const diagnostics = (Array.isArray(list) ? list : []).filter(
    (d): d is IdeDiagnostic => isRecord(d) && typeof d.path === 'string' && typeof d.message === 'string'
  )
  diagnostics.sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      a.path.localeCompare(b.path) ||
      a.line - b.line ||
      a.column - b.column
  )
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length
  return {
    total: diagnostics.length,
    errors,
    warnings,
    others: diagnostics.length - errors - warnings,
    truncated: diagnostics.length > limit,
    diagnostics: diagnostics.slice(0, limit)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Server
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the `atom-ide` MCP server for one chat. `chatId` is forwarded to the renderer with every
 * request so it can attribute IDE actions to a chat (optional).
 */
export function createIdeMcpServer(chatId?: string): McpSdkServerConfigWithInstance {
  const withChat = (params: Record<string, unknown> = {}): Record<string, unknown> => (chatId ? { ...params, chatId } : params)

  const getOpenEditors = tool(
    'get_open_editors',
    [
      'List the files the user has open in the ATOM Code editor: which one is active (focused), the cursor position in it, and which editors have unsaved changes (dirty).',
      'Use this first whenever the user says "this file", "here", "the current file" or otherwise refers to code without naming a path, and to discover what the user is working on.',
      'Dirty editors contain unsaved edits, so their content may differ from what Read returns from disk — mention this if it matters.'
    ].join(' '),
    {},
    async () =>
      safely(async () => {
        const result = await requestIde<IdeOpenEditorsResult>('getOpenEditors', withChat())
        if (!isRecord(result)) throw new Error('The editor returned an unexpected answer.')
        const editors = Array.isArray(result.editors) ? result.editors : []
        return jsonResult({
          ...result,
          ...(editors.length === 0 ? { note: 'No files are open in the editor.' } : {})
        })
      }),
    { annotations: { title: 'Get open editors', ...READ_ONLY } }
  )

  const getSelection = tool(
    'get_selection',
    [
      'Get the text the user currently has selected in the active editor, with its file path and 1-based start/end lines.',
      'Use this when the user says "this", "this function", "the selected code", "explain this" or "fix this" — they usually mean their selection.',
      'If nothing is selected, the result contains the cursor line instead; call get_open_editors to see the active file.'
    ].join(' '),
    {},
    async () =>
      safely(async () => {
        const result = await requestIde<IdeSelectionResult>('getSelection', withChat())
        if (!isRecord(result)) throw new Error('The editor returned an unexpected answer.')
        if (!result.path) return jsonResult({ ...result, note: 'No editor is active, so there is no selection.' })
        if (!result.text) {
          return jsonResult({ ...result, note: `Nothing is selected. The cursor is on line ${result.startLine} of ${result.path}.` })
        }
        const text = String(result.text)
        return jsonResult(
          text.length > MAX_SELECTION_CHARS
            ? { ...result, text: text.slice(0, MAX_SELECTION_CHARS), truncated: true, note: 'The selection was truncated; use Read with the line range for the rest.' }
            : result
        )
      }),
    { annotations: { title: 'Get editor selection', ...READ_ONLY } }
  )

  const getDiagnostics = tool(
    'get_diagnostics',
    [
      'Get the problems (type errors, compiler errors, lint warnings) the editor currently reports — the same list as the Problems panel and the red/yellow squiggles the user sees.',
      'Use it when the user mentions errors or squiggles, when debugging a build/type error, and after editing files to verify you did not introduce new problems.',
      'Pass `path` (a file or folder, absolute or workspace-relative) to filter; omit it for every file.',
      'Diagnostics come from the editor\'s language services and only cover files the editor has loaded, so for a complete check also run the project\'s typecheck/lint/build command.',
      'Lines and columns are 1-based. Results are sorted by severity.'
    ].join(' '),
    {
      path: z
        .string()
        .min(1)
        .optional()
        .describe('File or folder to filter by (absolute, or relative to the workspace root). Omit for all files.')
    },
    async ({ path }) =>
      safely(async () => {
        const raw = await requestIde<unknown>('getDiagnostics', withChat(path ? { path } : {}))
        const summary = summarizeDiagnostics(raw)
        if (summary.total === 0) {
          return jsonResult({
            ...summary,
            note: path ? `The editor reports no problems for ${path}.` : 'The editor reports no problems in the files it has loaded.'
          })
        }
        return jsonResult(
          summary.truncated ? { ...summary, note: `Showing the first ${MAX_DIAGNOSTICS} of ${summary.total} problems; pass a path to narrow down.` } : summary
        )
      }),
    { annotations: { title: 'Get diagnostics', ...READ_ONLY } }
  )

  const getTerminalOutputTool = tool(
    'get_terminal_output',
    [
      'Read the recent output of the user\'s integrated terminal in ATOM Code (the most recently active terminal tab, colors stripped).',
      'Use it when the user refers to something in their terminal: "the error in the terminal", "why did this command fail", "check the dev server log", test output they just ran.',
      'This only reads the user\'s own terminal; to run commands yourself use the Bash tool instead.'
    ].join(' '),
    {
      max_chars: z
        .number()
        .int()
        .min(200)
        .max(MAX_TERMINAL_CHARS)
        .optional()
        .describe(`Maximum number of trailing characters to return (default ${DEFAULT_TERMINAL_CHARS}).`)
    },
    async ({ max_chars }) =>
      safely(async () => {
        const maxChars = max_chars ?? DEFAULT_TERMINAL_CHARS
        let output = ''
        try {
          output = getTerminalOutput(maxChars)
        } catch {
          output = ''
        }
        if (!output.trim()) {
          // The main-process buffer is authoritative; the renderer copy is a best-effort fallback.
          try {
            const res = await requestIde<unknown>('getTerminalOutput', withChat({ maxChars }), RENDERER_FALLBACK_TIMEOUT_MS)
            if (isRecord(res) && typeof res.output === 'string') output = res.output
          } catch {
            /* no renderer terminal either */
          }
        }
        if (!output.trim()) {
          return textResult('The integrated terminal has no output yet (no terminal is open, or nothing has been printed).')
        }
        return textResult(`Last ${output.length} characters of the user's terminal:\n\n${output}`)
      }),
    { annotations: { title: 'Get terminal output', ...READ_ONLY } }
  )

  const openFile = tool(
    'open_file',
    [
      'Open a file in the user\'s editor and scroll to a line, so the user sees the code you are talking about.',
      'Use it to point the user at a specific location — e.g. the root cause of a bug, the function you are explaining, or an important change — when that helps them follow along.',
      'It does not return the file\'s content (use Read for that) and does not modify anything. Do not use it for every file you read.'
    ].join(' '),
    {
      path: z.string().min(1).describe('File to open: absolute, or relative to the workspace root.'),
      line: z.number().int().min(1).optional().describe('1-based line to reveal and place the cursor on.')
    },
    async ({ path, line }) =>
      safely(async () => {
        const res = await requestIde<unknown>('openFile', withChat(line ? { path, line } : { path }))
        const opened = isRecord(res) && typeof res.path === 'string' ? res.path : path
        return jsonResult({ opened, ...(line ? { line } : {}), note: 'The file is now visible to the user in the editor.' })
      }),
    { annotations: { title: 'Open file in editor', ...READ_ONLY } }
  )

  return createSdkMcpServer({
    name: IDE_MCP_SERVER_NAME,
    version: '1.0.0',
    instructions: SERVER_INSTRUCTIONS,
    // Five small tools the agent should always see (never deferred behind tool search).
    alwaysLoad: true,
    timeout: 30_000,
    tools: [getOpenEditors, getSelection, getDiagnostics, getTerminalOutputTool, openFile]
  })
}
