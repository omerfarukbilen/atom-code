/**
 * Developer aid: a scripted stand-in for the Agent SDK's `query()`.
 *
 * Enabled with `ATOM_FAKE_AGENT=1`. It emits realistic SDK messages (system init, streamed thinking and text,
 * tool calls with results, TodoWrite, permission prompts through `canUseTool`, plan approval, questions and a
 * result) so the whole chat UI can be exercised and screenshotted without signing in or calling the API.
 * It never touches the file system or runs commands.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

type Json = Record<string, unknown>

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function textOf(msg: SDKUserMessage): string {
  const content = (msg.message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && (b as Json).type === 'text' ? String((b as Json).text ?? '') : ''))
      .join('\n')
  }
  return ''
}

export function createFakeQuery(params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }): Query {
  const options = params.options ?? {}
  const cwd = options.cwd ?? process.cwd()
  const sessionId = options.resume ?? randomUUID()
  let permissionMode: string = options.permissionMode ?? 'default'
  let model = options.model || 'claude-opus-5-5'
  let closed = false
  let interrupted = false
  let turn = 0
  const outbox: SDKMessage[] = []
  let wake: (() => void) | null = null
  let costUsd = 0

  const push = (m: Json): void => {
    outbox.push(m as unknown as SDKMessage)
    wake?.()
  }

  const base = (): Json => ({ uuid: randomUUID(), session_id: sessionId })

  async function streamBlock(messageId: string, index: number, block: Json, deltas: Json[], parent: string | null = null): Promise<void> {
    push({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: block }, parent_tool_use_id: parent, ...base() })
    for (const delta of deltas) {
      if (interrupted) break
      await sleep(18)
      push({ type: 'stream_event', event: { type: 'content_block_delta', index, delta }, parent_tool_use_id: parent, ...base() })
    }
    push({ type: 'stream_event', event: { type: 'content_block_stop', index }, parent_tool_use_id: parent, ...base() })
    void messageId
  }

  function chunk(text: string, size = 14): string[] {
    const out: string[] = []
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
    return out
  }

  async function assistantText(text: string, parent: string | null = null): Promise<void> {
    const id = `msg_${randomUUID().slice(0, 12)}`
    push({ type: 'stream_event', event: { type: 'message_start', message: { id, role: 'assistant', model, content: [] } }, parent_tool_use_id: parent, ...base() })
    await streamBlock(id, 0, { type: 'text', text: '' }, chunk(text).map((t) => ({ type: 'text_delta', text: t })), parent)
    push({ type: 'assistant', message: { id, type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } }, parent_tool_use_id: parent, ...base() })
  }

  async function assistantThinking(text: string): Promise<void> {
    const id = `msg_${randomUUID().slice(0, 12)}`
    push({ type: 'stream_event', event: { type: 'message_start', message: { id, role: 'assistant', model, content: [] } }, parent_tool_use_id: null, ...base() })
    await streamBlock(id, 0, { type: 'thinking', thinking: '' }, chunk(text, 20).map((t) => ({ type: 'thinking_delta', thinking: t })))
    push({ type: 'assistant', message: { id, type: 'message', role: 'assistant', model, content: [{ type: 'thinking', thinking: text, signature: 'fake' }], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } }, parent_tool_use_id: null, ...base() })
  }

  /** Streams a tool_use block, asks canUseTool when `ask` is set, then emits the tool_result. */
  async function tool(name: string, input: Json, result: string, opts: { ask?: boolean; parent?: string | null; structured?: unknown; isError?: boolean } = {}): Promise<{ allowed: boolean; input: Json }> {
    const parent = opts.parent ?? null
    const id = `toolu_${randomUUID().replace(/-/g, '').slice(0, 20)}`
    const msgId = `msg_${randomUUID().slice(0, 12)}`
    const json = JSON.stringify(input)
    push({ type: 'stream_event', event: { type: 'message_start', message: { id: msgId, role: 'assistant', model, content: [] } }, parent_tool_use_id: parent, ...base() })
    await streamBlock(msgId, 0, { type: 'tool_use', id, name, input: {} }, chunk(json, 24).map((p) => ({ type: 'input_json_delta', partial_json: p })), parent)
    push({ type: 'assistant', message: { id: msgId, type: 'message', role: 'assistant', model, content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use', usage: { input_tokens: 0, output_tokens: 0 } }, parent_tool_use_id: parent, ...base() })

    let allowed = true
    let finalInput = input
    let denyMessage = ''
    if (opts.ask && options.canUseTool && permissionMode !== 'bypassPermissions' && !(permissionMode === 'acceptEdits' && ['Edit', 'Write', 'MultiEdit'].includes(name))) {
      const controller = new AbortController()
      const decision = await options.canUseTool(name, input, {
        signal: controller.signal,
        toolUseID: id,
        suggestions: [{ type: 'addRules', rules: [{ toolName: name }], behavior: 'allow', destination: 'session' }],
        title: name === 'Bash' ? `Claude wants to run ${String(input.command)}` : `Claude wants to ${name === 'Edit' ? 'edit' : 'use'} ${String(input.file_path ?? name)}`,
        displayName: name === 'Bash' ? 'Run command' : name === 'Edit' ? 'Edit file' : name
      } as Parameters<NonNullable<Options['canUseTool']>>[2])
      if (decision && decision.behavior === 'deny') {
        allowed = false
        denyMessage = decision.message
        if (decision.interrupt) interrupted = true
      } else if (decision && decision.updatedInput) {
        finalInput = decision.updatedInput
      }
    }
    await sleep(250)
    const content = allowed ? result : `The user doesn't want to proceed with this tool use. ${denyMessage}`
    push({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: !allowed || !!opts.isError }] },
      parent_tool_use_id: parent,
      tool_use_result: allowed ? (opts.structured ?? content) : content,
      ...base()
    })
    return { allowed, input: finalInput }
  }

  async function runTurn(user: SDKUserMessage): Promise<void> {
    const started = Date.now()
    interrupted = false
    turn++
    const text = textOf(user).toLowerCase()
    if (turn === 1) {
      push({
        type: 'system',
        subtype: 'init',
        apiKeySource: 'none',
        claude_code_version: '2.1.299 (fake)',
        cwd,
        tools: ['Agent', 'Bash', 'Edit', 'Glob', 'Grep', 'Read', 'TodoWrite', 'WebFetch', 'WebSearch', 'Write', 'mcp__atom-ide__get_diagnostics'],
        mcp_servers: [{ name: 'atom-ide', status: 'connected', source: 'sdk' }],
        model,
        permissionMode,
        slash_commands: ['atom:review', 'atom:test', 'atom:commit', 'compact', 'init'],
        output_style: 'default',
        skills: ['atom:systematic-debugging', 'atom:code-review', 'atom:test-driven-development'],
        plugins: [{ name: 'atom', path: join(cwd, 'resources/atom-plugin') }],
        ...base()
      })
    }
    push({ type: 'system', subtype: 'session_state_changed', state: 'running', ...base() })

    await assistantThinking('The user wants me to look into the project. I should start by exploring the structure, then read the key files before making a focused change and verifying it.')
    if (permissionMode === 'plan') {
      await assistantText("I'll research the codebase first and then propose a plan.")
      await tool('Glob', { pattern: 'src/**/*.ts' }, 'src/main/index.ts\nsrc/main/context.ts\nsrc/shared/types.ts\nsrc/shared/ipc.ts', { structured: { filenames: ['src/main/index.ts', 'src/main/context.ts'], numFiles: 4 } })
      await tool('Read', { file_path: join(cwd, 'package.json') }, '1\t{\n2\t  "name": "atom-code",\n3\t  "version": "0.1.0"\n4\t}')
      const plan = '## Plan: Add a health check endpoint\n\n1. **`src/server/routes.ts`** — register `GET /health` returning `{ status: "ok", uptime }`.\n2. **`src/server/routes.test.ts`** — add a test asserting status 200 and the JSON shape.\n3. Run `npm test` and fix any failures.\n\n**Risks:** none — additive change.\n**Verification:** unit test + manual `curl localhost:3000/health`.'
      const res = await tool('ExitPlanMode', { plan }, 'User has approved your plan. You can now start coding.', { ask: true })
      if (res.allowed) await assistantText('Plan approved — switching to implementation. I will start with the route and its test.')
      else await assistantText('Understood, I will keep refining the plan. What would you like to change?')
    } else if (text.includes('question') || text.includes('soru')) {
      const res = await tool(
        'AskUserQuestion',
        {
          questions: [
            {
              question: 'Which test framework should I use for the new tests?',
              header: 'Framework',
              multiSelect: false,
              options: [
                { label: 'Vitest', description: 'Fast, Vite-native, Jest-compatible API' },
                { label: 'Jest', description: 'Most widely used, large ecosystem' },
                { label: 'node:test', description: 'Built into Node, zero dependencies' }
              ]
            }
          ]
        },
        'User answered the questions.',
        { ask: true }
      )
      const answers = (res.input.answers ?? {}) as Record<string, string>
      await assistantText(`Great — I'll go with **${Object.values(answers)[0] ?? 'Vitest'}**.`)
    } else {
      await assistantText("I'll explore the project structure first, then make the change and verify it.")
      await tool('TodoWrite', { todos: [
        { content: 'Explore the project structure', status: 'completed', activeForm: 'Exploring the project structure' },
        { content: 'Add input validation to parseConfig', status: 'in_progress', activeForm: 'Adding input validation' },
        { content: 'Run the test suite', status: 'pending', activeForm: 'Running the test suite' }
      ] }, 'Todos have been modified successfully.')
      await tool('Grep', { pattern: 'parseConfig', output_mode: 'files_with_matches' }, 'src/config.ts\nsrc/config.test.ts', { structured: { filenames: ['src/config.ts', 'src/config.test.ts'], numFiles: 2 } })
      await tool('Read', { file_path: join(cwd, 'src/config.ts'), offset: 1, limit: 40 }, '1\texport function parseConfig(raw: string) {\n2\t  return JSON.parse(raw)\n3\t}')
      const agentRes = await (async () => {
        const id = `toolu_${randomUUID().replace(/-/g, '').slice(0, 20)}`
        const msgId = `msg_${randomUUID().slice(0, 12)}`
        const input = { description: 'Find config call sites', prompt: 'Find every caller of parseConfig and report how errors are handled.', subagent_type: 'atom:explorer' }
        push({ type: 'assistant', message: { id: msgId, type: 'message', role: 'assistant', model, content: [{ type: 'tool_use', id, name: 'Agent', input }], stop_reason: 'tool_use', usage: { input_tokens: 0, output_tokens: 0 } }, parent_tool_use_id: null, ...base() })
        push({ type: 'system', subtype: 'task_started', task_id: 'task_1', tool_use_id: id, description: input.description, ...base() })
        await tool('Grep', { pattern: 'parseConfig\\(', output_mode: 'content' }, 'src/cli.ts:14:  const cfg = parseConfig(text)\nsrc/server.ts:8:  config = parseConfig(env.CONFIG)', { parent: id })
        await assistantText('Two call sites: `src/cli.ts:14` and `src/server.ts:8`. Neither catches JSON errors.', id)
        push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Found 2 call sites (src/cli.ts:14, src/server.ts:8); neither handles parse errors.' }] }, parent_tool_use_id: null, tool_use_result: { status: 'completed', content: [{ type: 'text', text: 'Found 2 call sites; neither handles parse errors.' }] }, ...base() })
        return true
      })()
      void agentRes
      const edit = await tool(
        'Edit',
        {
          file_path: join(cwd, 'src/config.ts'),
          old_string: 'export function parseConfig(raw: string) {\n  return JSON.parse(raw)\n}',
          new_string: "export function parseConfig(raw: string): Config {\n  let data: unknown\n  try {\n    data = JSON.parse(raw)\n  } catch (err) {\n    throw new ConfigError('Config is not valid JSON', { cause: err })\n  }\n  return validateConfig(data)\n}"
        },
        'The file src/config.ts has been updated successfully.',
        { ask: true }
      )
      if (edit.allowed && !interrupted) {
        await tool('Bash', { command: 'npm test -- --run config', description: 'Run config tests' }, '\n > atom-demo@1.0.0 test\n > vitest --run config\n\n ✓ src/config.test.ts (6 tests) 41ms\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)\n', { ask: true })
        await assistantText(
          "Done. `parseConfig` now validates its input:\n\n- Invalid JSON throws a `ConfigError` with the original error as `cause` (`src/config.ts:4`).\n- The parsed value goes through `validateConfig` before it is returned.\n\n```ts\nconst cfg = parseConfig('{\"port\": 3000}')\n```\n\nAll **6 tests pass**. The two call sites (`src/cli.ts:14`, `src/server.ts:8`) will now surface a clear error message instead of a raw `SyntaxError`."
        )
      } else {
        await assistantText('No problem — I left the file unchanged. Tell me how you would like to handle invalid configs instead.')
      }
    }

    costUsd += 0.0421
    const duration = Date.now() - started
    push({
      type: 'result',
      subtype: interrupted ? 'error_during_execution' : 'success',
      is_error: false,
      duration_ms: duration,
      duration_api_ms: Math.round(duration * 0.8),
      num_turns: 6,
      result: 'done',
      stop_reason: 'end_turn',
      total_cost_usd: costUsd,
      usage: { input_tokens: 18234, output_tokens: 1290, cache_read_input_tokens: 15200, cache_creation_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      ...base()
    })
    push({ type: 'system', subtype: 'session_state_changed', state: 'idle', ...base() })
    push({ type: 'prompt_suggestion', suggestion: 'Add a test for the invalid JSON case', ...base() })
  }

  // Consume the prompt stream: one scripted turn per user message.
  void (async () => {
    try {
      for await (const msg of params.prompt) {
        if (closed) break
        await runTurn(msg)
      }
    } catch {
      /* prompt stream ended */
    }
  })()

  async function* iterate(): AsyncGenerator<SDKMessage, void> {
    while (!closed) {
      if (outbox.length) {
        yield outbox.shift() as SDKMessage
        continue
      }
      await new Promise<void>((r) => (wake = r))
      wake = null
    }
  }

  const gen = iterate()
  const models = [
    { value: 'default', displayName: 'Default (recommended)', description: 'Opus for complex work', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { value: 'opus', displayName: 'Opus', description: 'Most capable for complex work', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { value: 'sonnet', displayName: 'Sonnet', description: 'Best for everyday tasks', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { value: 'haiku', displayName: 'Haiku', description: 'Fastest for quick answers', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] }
  ]
  const commands = [
    { name: 'atom:review', description: '(atom) Review current changes', argumentHint: '[scope]' },
    { name: 'atom:test', description: '(atom) Write or run tests', argumentHint: '[target]' },
    { name: 'atom:commit', description: '(atom) Create well-structured commits', argumentHint: '' },
    { name: 'compact', description: 'Clear conversation history but keep a summary in context', argumentHint: '<instructions>', builtin: true },
    { name: 'init', description: 'Initialize a CLAUDE.md file with codebase documentation', argumentHint: '', builtin: true }
  ]

  const api = {
    next: () => gen.next(),
    return: (v?: void) => {
      closed = true
      wake?.()
      return gen.return(v)
    },
    throw: (e?: unknown) => gen.throw(e),
    [Symbol.asyncIterator]() {
      return this
    },
    async interrupt() {
      interrupted = true
      return undefined
    },
    async setPermissionMode(mode: string) {
      permissionMode = mode
    },
    async setModel(m?: string) {
      model = m || 'claude-opus-5-5'
    },
    async applyFlagSettings() {},
    async initializationResult() {
      return { commands, agents: [], models, account: { email: 'demo@atom.dev', subscriptionType: 'max' } }
    },
    async supportedCommands() {
      return commands
    },
    async supportedModels() {
      return models
    },
    async supportedAgents() {
      return [{ name: 'atom:explorer', description: 'Fast codebase reconnaissance' }, { name: 'atom:code-reviewer', description: 'Reviews diffs' }]
    },
    async mcpServerStatus() {
      return [{ name: 'atom-ide', status: 'connected' }]
    },
    async getContextUsage() {
      return { totalTokens: 18234 * turn, maxTokens: 1_000_000, rawMaxTokens: 1_000_000, percentage: (18234 * turn) / 10_000, categories: [] }
    },
    async accountInfo() {
      return { email: 'demo@atom.dev', subscriptionType: 'max', apiProvider: 'firstParty' }
    },
    async rewindFiles() {
      return { canRewind: true, filesChanged: ['src/config.ts'], insertions: 1, deletions: 7 }
    },
    async stopTask() {},
    async streamInput() {},
    close() {
      closed = true
      wake?.()
    }
  }

  // Any other Query method resolves to undefined so callers never crash in fake mode.
  return new Proxy(api, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      if (typeof prop === 'string') return async () => undefined
      return undefined
    }
  }) as unknown as Query
}
