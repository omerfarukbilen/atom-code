import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addUserMessage,
  applyHistory,
  createChatState,
  findToolCall,
  historyFromStoredMessages,
  isRunning,
  parsePartialJson,
  reduceAgentEvent,
  titleFromPrompt,
  todoProgress,
  transcriptFromStoredMessages
} from '../src/renderer/src/lib/agent-reducer.ts'
import type { AgentEvent, PermissionRequest, StoredSessionMessage } from '../src/shared/types.ts'
import type { AssistantItem, ChatState, ResultItem, ToolCall } from '../src/renderer/src/lib/agent-types.ts'

const NOW = 1_700_000_000_000

function newChat(): ChatState {
  return createChatState({ id: 'c1', workspace: '/ws', modeId: 'agent', permission: 'default', model: '', effort: 'auto', now: NOW })
}

function sdk(message: Record<string, unknown>): AgentEvent {
  return { type: 'sdk', message: { type: String(message.type), ...message } }
}

function stream(event: Record<string, unknown>, parent: string | null = null): AgentEvent {
  return sdk({ type: 'stream_event', event, parent_tool_use_id: parent, uuid: 'se', session_id: 's1' })
}

function run(chat: ChatState, events: AgentEvent[]): ChatState {
  let c = chat
  let t = NOW
  for (const e of events) c = reduceAgentEvent(c, e, ++t)
  return c
}

function assistantItems(chat: ChatState): AssistantItem[] {
  return chat.items.filter((i): i is AssistantItem => i.kind === 'assistant')
}

function assistantFrame(
  messageId: string,
  block: Record<string, unknown>,
  parent: string | null = null,
  uuid = `u-${Math.random()}`
): AgentEvent {
  return sdk({
    type: 'assistant',
    uuid,
    session_id: 's1',
    parent_tool_use_id: parent,
    message: { id: messageId, type: 'message', role: 'assistant', model: 'claude-test', content: [block], stop_reason: null }
  })
}

function toolResult(toolUseId: string, content: unknown, opts: { isError?: boolean; structured?: unknown; parent?: string | null } = {}): AgentEvent {
  return sdk({
    type: 'user',
    uuid: `tr-${toolUseId}`,
    session_id: 's1',
    parent_tool_use_id: opts.parent ?? null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: opts.isError ?? false }] },
    ...(opts.structured !== undefined ? { tool_use_result: opts.structured } : {})
  })
}

test('streams text deltas into one assistant block and reconciles without duplication', () => {
  let chat = newChat()
  chat = run(chat, [
    stream({ type: 'message_start', message: { id: 'msg_1', model: 'claude-test', content: [] } }),
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } }),
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } })
  ])
  let items = assistantItems(chat)
  assert.equal(items.length, 1)
  assert.equal(items[0].id, 'msg_1')
  assert.equal(items[0].model, 'claude-test')
  assert.equal(items[0].blocks.length, 1)
  const b0 = items[0].blocks[0]
  assert.equal(b0.kind, 'text')
  assert.equal(b0.kind === 'text' && b0.text, 'Hello world')
  assert.equal(b0.kind === 'text' && b0.streaming, true)

  chat = run(chat, [
    stream({ type: 'content_block_stop', index: 0 }),
    assistantFrame('msg_1', { type: 'text', text: 'Hello world' }),
    stream({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
    stream({ type: 'message_stop' })
  ])
  items = assistantItems(chat)
  assert.equal(items.length, 1)
  assert.equal(items[0].blocks.length, 1, 'complete frame must confirm, not duplicate, the streamed block')
  const b = items[0].blocks[0]
  assert.ok(b.kind === 'text' && !b.streaming && b.final)
  assert.equal(items[0].stopReason, 'end_turn')
  assert.deepEqual(chat.streams, {})

  // An exact replay of the same complete frame is ignored.
  chat = run(chat, [assistantFrame('msg_1', { type: 'text', text: 'Hello world' })])
  assert.equal(assistantItems(chat)[0].blocks.length, 1)
})

test('complete frames without stream events are appended in order', () => {
  const chat = run(newChat(), [
    assistantFrame('msg_a', { type: 'thinking', thinking: 'Let me think', signature: 'x' }),
    assistantFrame('msg_a', { type: 'text', text: 'First' }),
    assistantFrame('msg_a', { type: 'text', text: 'Second' })
  ])
  const [item] = assistantItems(chat)
  assert.deepEqual(
    item.blocks.map((b) => [b.kind, b.kind === 'tool' ? b.name : b.text]),
    [
      ['thinking', 'Let me think'],
      ['text', 'First'],
      ['text', 'Second']
    ]
  )
})

test('streams thinking then text; reconciles each by order within the message', () => {
  const chat = run(newChat(), [
    stream({ type: 'message_start', message: { id: 'msg_2', model: 'm' } }),
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan: ' } }),
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'read files' } }),
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } }),
    stream({ type: 'content_block_stop', index: 0 }),
    assistantFrame('msg_2', { type: 'thinking', thinking: 'Plan: read files', signature: 'sig' }),
    stream({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
    stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Done.' } }),
    stream({ type: 'content_block_stop', index: 1 }),
    assistantFrame('msg_2', { type: 'text', text: 'Done.' }),
    stream({ type: 'message_stop' })
  ])
  const [item] = assistantItems(chat)
  assert.equal(item.blocks.length, 2)
  const [th, tx] = item.blocks
  assert.ok(th.kind === 'thinking')
  assert.equal(th.text, 'Plan: read files')
  assert.equal(th.streaming, false)
  assert.ok(typeof th.endedAt === 'number' && th.endedAt >= th.startedAt)
  assert.ok(tx.kind === 'text' && tx.text === 'Done.')
})

test('tool call: input_json_delta accumulates, parses on stop, tool_result completes it', () => {
  let chat = run(newChat(), [
    stream({ type: 'message_start', message: { id: 'msg_3', model: 'm' } }),
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} } }),
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command": "npm te' } })
  ])
  let tool = findToolCall(chat, 'toolu_1')
  assert.ok(tool)
  assert.equal(tool.status, 'streaming')
  assert.equal(tool.input.command, 'npm te', 'lenient live preview of partial input')

  chat = run(chat, [
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'st", "description": "Run tests"}' } }),
    stream({ type: 'content_block_stop', index: 0 })
  ])
  tool = findToolCall(chat, 'toolu_1')
  assert.ok(tool)
  assert.equal(tool.status, 'running')
  assert.deepEqual(tool.input, { command: 'npm test', description: 'Run tests' })
  assert.equal(tool.inputJson, '{"command": "npm test", "description": "Run tests"}')

  chat = run(chat, [
    assistantFrame('msg_3', { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } }),
    stream({ type: 'message_stop' }),
    sdk({ type: 'tool_progress', tool_use_id: 'toolu_1', tool_name: 'Bash', parent_tool_use_id: null, elapsed_time_seconds: 3 }),
    toolResult('toolu_1', [{ type: 'text', text: 'All tests passed' }], { structured: { stdout: 'All tests passed', stderr: '' } })
  ])
  const items = assistantItems(chat)
  assert.equal(items.length, 1)
  assert.equal(items[0].blocks.length, 1, 'tool_use reconciled by id')
  tool = findToolCall(chat, 'toolu_1')
  assert.ok(tool)
  assert.equal(tool.status, 'success')
  assert.equal(tool.elapsedSeconds, 3)
  assert.deepEqual(tool.result, { text: 'All tests passed', isError: false })
  assert.deepEqual(tool.structured, { stdout: 'All tests passed', stderr: '' })
  assert.equal(typeof tool.endedAt, 'number')
})

test('tool errors, denials and interrupts map to statuses', () => {
  let chat = run(newChat(), [
    assistantFrame('m', { type: 'tool_use', id: 't_err', name: 'Read', input: { file_path: '/x' } }),
    assistantFrame('m', { type: 'tool_use', id: 't_den', name: 'Bash', input: { command: 'rm -rf /' } }),
    assistantFrame('m', { type: 'tool_use', id: 't_int', name: 'Bash', input: { command: 'sleep 100' } }),
    toolResult('t_err', '<tool_use_error>File does not exist.</tool_use_error>', { isError: true }),
    toolResult('t_den', "The user doesn't want to proceed with this tool use.", { isError: true }),
    toolResult('t_int', '[Request interrupted by user for tool use]', { isError: true })
  ])
  assert.equal(findToolCall(chat, 't_err')?.status, 'error')
  assert.equal(findToolCall(chat, 't_err')?.result?.text, 'File does not exist.')
  assert.equal(findToolCall(chat, 't_den')?.status, 'denied')
  assert.equal(findToolCall(chat, 't_int')?.status, 'interrupted')

  // permission_denied system message
  chat = run(chat, [
    assistantFrame('m2', { type: 'tool_use', id: 't_auto', name: 'WebFetch', input: { url: 'https://x' } }),
    sdk({ type: 'system', subtype: 'permission_denied', tool_name: 'WebFetch', tool_use_id: 't_auto', message: 'Blocked by rule' })
  ])
  assert.equal(findToolCall(chat, 't_auto')?.status, 'denied')
  assert.equal(findToolCall(chat, 't_auto')?.result?.text, 'Blocked by rule')
})

test('subagent messages route into the parent Agent tool children (nested, streamed)', () => {
  let chat = run(newChat(), [
    assistantFrame('msg_main', {
      type: 'tool_use',
      id: 'agent_1',
      name: 'Agent',
      input: { description: 'Explore code', prompt: 'Find X', subagent_type: 'atom:explorer' }
    }),
    sdk({
      type: 'system',
      subtype: 'task_started',
      task_id: 'task_9',
      tool_use_id: 'agent_1',
      description: 'Explore code',
      subagent_type: 'atom:explorer'
    }),
    // subagent prompt (user text with parent) must not become a user item
    sdk({ type: 'user', uuid: 'sp', parent_tool_use_id: 'agent_1', message: { role: 'user', content: 'Find X' } }),
    // subagent streams text
    stream({ type: 'message_start', message: { id: 'msg_sub', model: 'haiku' } }, 'agent_1'),
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, 'agent_1'),
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Searching' } }, 'agent_1'),
    stream({ type: 'content_block_stop', index: 0 }, 'agent_1'),
    assistantFrame('msg_sub', { type: 'text', text: 'Searching' }, 'agent_1'),
    assistantFrame('msg_sub', { type: 'tool_use', id: 'sub_grep', name: 'Grep', input: { pattern: 'X' } }, 'agent_1'),
    stream({ type: 'message_stop' }, 'agent_1'),
    toolResult('sub_grep', 'src/a.ts', { parent: 'agent_1' }),
    // a nested-nested agent
    assistantFrame('msg_sub2', { type: 'tool_use', id: 'agent_2', name: 'Agent', input: { description: 'Deeper', prompt: 'p' } }, 'agent_1'),
    assistantFrame('msg_deep', { type: 'tool_use', id: 'deep_read', name: 'Read', input: { file_path: '/a' } }, 'agent_2'),
    toolResult('deep_read', 'contents', { parent: 'agent_2' }),
    sdk({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'task_9',
      tool_use_id: 'agent_1',
      description: 'Explore code',
      usage: { total_tokens: 1200, tool_uses: 2, duration_ms: 4000 },
      last_tool_name: 'Grep',
      summary: 'Grepping for X'
    })
  ])

  assert.equal(chat.items.filter((i) => i.kind === 'user').length, 0)
  const main = assistantItems(chat)
  assert.equal(main.length, 1, 'subagent messages do not create top-level items')
  const agent = findToolCall(chat, 'agent_1') as ToolCall
  assert.equal(agent.children.length, 3)
  assert.deepEqual(
    agent.children.map((b) => b.kind),
    ['text', 'tool', 'tool']
  )
  const subText = agent.children[0]
  assert.ok(subText.kind === 'text' && subText.text === 'Searching' && subText.final)
  assert.equal(findToolCall(chat, 'sub_grep')?.status, 'success')
  assert.equal(findToolCall(chat, 'sub_grep')?.parentToolUseId, 'agent_1')
  assert.equal(findToolCall(chat, 'deep_read')?.status, 'success')
  assert.equal(findToolCall(chat, 'deep_read')?.parentToolUseId, 'agent_2')
  assert.equal(agent.subagent?.taskId, 'task_9')
  assert.equal(agent.subagent?.status, 'running')
  assert.equal(agent.subagent?.summary, 'Grepping for X')
  assert.equal(agent.subagent?.totalTokens, 1200)

  // task_updated has no tool_use_id: matched by task id
  chat = run(chat, [sdk({ type: 'system', subtype: 'task_updated', task_id: 'task_9', patch: { status: 'completed' } })])
  assert.equal(findToolCall(chat, 'agent_1')?.subagent?.status, 'completed')

  chat = run(chat, [
    toolResult('agent_1', [{ type: 'text', text: 'Found X in src/a.ts' }], {
      structured: { status: 'completed', agentId: 'a', content: [], totalToolUseCount: 2, totalDurationMs: 4100, totalTokens: 1300 }
    })
  ])
  const done = findToolCall(chat, 'agent_1') as ToolCall
  assert.equal(done.status, 'success')
  assert.equal(done.result?.text, 'Found X in src/a.ts')
  assert.equal(done.subagent?.toolUses, 2)
})

test('background agent launch keeps the subagent running until task_notification', () => {
  let chat = run(newChat(), [
    assistantFrame('m', { type: 'tool_use', id: 'bg', name: 'Agent', input: { description: 'Bg', prompt: 'p' } }),
    toolResult('bg', 'Async agent launched', {
      structured: { status: 'async_launched', agentId: 'ag1', description: 'Bg', prompt: 'p', outputFile: '/tmp/o' }
    }),
    sdk({ type: 'result', subtype: 'success', is_error: false, duration_ms: 10, duration_api_ms: 5, num_turns: 1, result: 'ok', stop_reason: 'end_turn', total_cost_usd: 0.01, usage: {}, permission_denials: [] })
  ])
  let bg = findToolCall(chat, 'bg') as ToolCall
  assert.equal(bg.status, 'success')
  assert.equal(bg.subagent?.status, 'running')
  assert.equal(bg.subagent?.backgrounded, true)
  chat = run(chat, [
    sdk({ type: 'system', subtype: 'task_notification', task_id: 'ag1', tool_use_id: 'bg', status: 'completed', output_file: '', summary: 'All done' })
  ])
  bg = findToolCall(chat, 'bg') as ToolCall
  assert.equal(bg.subagent?.status, 'completed')
  assert.equal(bg.subagent?.summary, 'All done')
})

test('TodoWrite replaces the todo list; TaskCreate/TaskUpdate update it incrementally', () => {
  let chat = run(newChat(), [
    stream({ type: 'message_start', message: { id: 'mt', model: 'm' } }),
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'todo1', name: 'TodoWrite', input: {} } }),
    stream({
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json:
          '{"todos":[{"content":"Read code","status":"completed","activeForm":"Reading code"},{"content":"Fix bug","status":"in_progress","activeForm":"Fixing bug"},'
      }
    })
  ])
  assert.equal(chat.todos, null, 'todos only update once the input is complete')
  chat = run(chat, [
    stream({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"content":"Run tests","status":"pending","activeForm":"Running tests"}]}' }
    }),
    stream({ type: 'content_block_stop', index: 0 })
  ])
  assert.equal(chat.todos?.length, 3)
  assert.deepEqual(todoProgress(chat.todos), { total: 3, completed: 1, current: chat.todos?.[1] ?? null })
  assert.equal(chat.todos?.[1].activeForm, 'Fixing bug')

  // TaskCreate (id assigned from the structured result), TaskUpdate by id, deletion.
  chat = run(createChatState({ id: 'c2', modeId: 'agent', permission: 'default', model: '', effort: 'auto', now: NOW }), [
    assistantFrame('mk', { type: 'tool_use', id: 'tc1', name: 'TaskCreate', input: { subject: 'Write tests', description: 'd', activeForm: 'Writing tests' } }),
    toolResult('tc1', 'Task #1 created successfully: Write tests', { structured: { task: { id: '1', subject: 'Write tests' } } }),
    assistantFrame('mk', { type: 'tool_use', id: 'tc2', name: 'TaskCreate', input: { subject: 'Ship it', description: 'd' } }),
    toolResult('tc2', 'Task #2 created successfully: Ship it'),
    assistantFrame('mk2', { type: 'tool_use', id: 'tu1', name: 'TaskUpdate', input: { taskId: '1', status: 'in_progress' } })
  ])
  assert.deepEqual(
    chat.todos?.map((t) => [t.id, t.content, t.status]),
    [
      ['1', 'Write tests', 'in_progress'],
      ['2', 'Ship it', 'pending']
    ]
  )
  // Replaying the TaskCreate frame must not duplicate the task.
  chat = run(chat, [
    assistantFrame('mk', { type: 'tool_use', id: 'tc1', name: 'TaskCreate', input: { subject: 'Write tests', description: 'd', activeForm: 'Writing tests' } }),
    assistantFrame('mk3', { type: 'tool_use', id: 'tu2', name: 'TaskUpdate', input: { taskId: '2', status: 'deleted' } })
  ])
  assert.deepEqual(
    chat.todos?.map((t) => t.id),
    ['1']
  )

  // Subagent todos never clobber the main list.
  chat = run(chat, [
    assistantFrame('ma', { type: 'tool_use', id: 'ag', name: 'Agent', input: { description: 'x', prompt: 'y' } }),
    assistantFrame('ms', { type: 'tool_use', id: 'subtodo', name: 'TodoWrite', input: { todos: [{ content: 'sub', status: 'pending', activeForm: 's' }] } }, 'ag')
  ])
  assert.deepEqual(
    chat.todos?.map((t) => t.content),
    ['Write tests']
  )
})

test('permission request / resolve; deny marks the tool denied', () => {
  const request: PermissionRequest = {
    requestId: 'r1',
    chatId: 'c1',
    kind: 'tool',
    toolName: 'Bash',
    toolUseId: 'tb',
    input: { command: 'git push' },
    title: 'Claude wants to run git push',
    createdAt: NOW
  }
  let chat = run(newChat(), [
    { type: 'status', status: 'running' },
    assistantFrame('mp', { type: 'tool_use', id: 'tb', name: 'Bash', input: { command: 'git push' } }),
    { type: 'permission-request', request },
    { type: 'permission-request', request }
  ])
  assert.equal(chat.pendingRequests.length, 1, 'duplicate requests are ignored')
  assert.equal(chat.status, 'awaiting-input')
  assert.ok(isRunning(chat))
  chat = run(chat, [{ type: 'permission-resolved', requestId: 'r1', behavior: 'deny' }])
  assert.equal(chat.pendingRequests.length, 0)
  assert.equal(chat.status, 'running')
  assert.equal(findToolCall(chat, 'tb')?.status, 'denied')
  // the CLI's rejection tool_result keeps the denied status
  chat = run(chat, [toolResult('tb', 'The user declined this action.', { isError: true })])
  assert.equal(findToolCall(chat, 'tb')?.status, 'denied')
  assert.equal(findToolCall(chat, 'tb')?.result?.isError, true)

  // allow keeps the tool running
  chat = run(chat, [
    assistantFrame('mp2', { type: 'tool_use', id: 'tw', name: 'Write', input: { file_path: '/a', content: 'x' } }),
    { type: 'permission-request', request: { ...request, requestId: 'r2', toolUseId: 'tw', toolName: 'Write' } },
    { type: 'permission-resolved', requestId: 'r2', behavior: 'allow' }
  ])
  assert.equal(findToolCall(chat, 'tw')?.status, 'running')
})

test('result: turn stats, cost delta, idle status, interrupted tools on error', () => {
  let chat = run(addUserMessage(newChat(), { uuid: 'u1', text: 'Fix it', checkpoint: true }, NOW), [
    { type: 'user-sent', uuid: 'u1', text: '<atom_context></atom_context>Fix it', images: 0 },
    { type: 'status', status: 'running' },
    assistantFrame('mr', { type: 'text', text: 'Fixed.' }),
    sdk({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 12_000,
      duration_api_ms: 9000,
      num_turns: 3,
      result: 'Fixed.',
      stop_reason: 'end_turn',
      total_cost_usd: 0.25,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10 },
      permission_denials: [],
      queued_turn_count: 0
    })
  ])
  const user = chat.items[0]
  assert.ok(user.kind === 'user' && !user.pending && user.text === 'Fix it')
  assert.equal(chat.items.filter((i) => i.kind === 'user').length, 1, 'user-sent does not duplicate the optimistic item')
  const res = chat.items[chat.items.length - 1] as ResultItem
  assert.equal(res.kind, 'result')
  assert.equal(res.durationMs, 12_000)
  assert.equal(res.numTurns, 3)
  assert.equal(res.costUsd, 0.25)
  assert.equal(res.inputTokens, 100)
  assert.equal(res.outputTokens, 50)
  assert.equal(res.cacheReadTokens, 1000)
  assert.equal(res.isError, false)
  assert.equal(res.stopReason, 'end_turn')
  assert.equal(chat.status, 'idle')
  assert.equal(chat.totalCostUsd, 0.25)
  assert.equal(chat.turnStartedAt, null)

  // second turn: cumulative total → per-turn delta; interrupted turn marks running tools interrupted
  chat = run(chat, [
    { type: 'status', status: 'running' },
    assistantFrame('mr2', { type: 'tool_use', id: 'slow', name: 'Bash', input: { command: 'sleep 9' } }),
    sdk({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      duration_ms: 500,
      duration_api_ms: 100,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0.3,
      usage: { input_tokens: 1, output_tokens: 1 },
      permission_denials: [],
      errors: [],
      terminal_reason: 'aborted_tools'
    })
  ])
  const res2 = chat.items[chat.items.length - 1] as ResultItem
  assert.ok(Math.abs(res2.costUsd - 0.05) < 1e-9)
  assert.equal(res2.interrupted, true)
  assert.equal(findToolCall(chat, 'slow')?.status, 'interrupted')
  assert.equal(chat.status, 'idle')
})

test('result errors: errorText unless already visible; error events do not repeat visible text', () => {
  const resultMsg = (extra: Record<string, unknown>) =>
    sdk({
      type: 'result',
      duration_ms: 1,
      duration_api_ms: 1,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0,
      usage: {},
      permission_denials: [],
      ...extra
    })
  // max turns: error text comes from the subtype
  let chat = run(newChat(), [resultMsg({ subtype: 'error_max_turns', is_error: true, errors: [] })])
  let res = chat.items[chat.items.length - 1] as ResultItem
  assert.equal(res.isError, true)
  assert.match(res.errorText ?? '', /maximum number of turns/)
  chat = run(chat, [{ type: 'error', message: res.errorText ?? '', kind: 'unknown' }])
  assert.equal(chat.items.filter((i) => i.kind === 'notice').length, 0, 'already shown in the result footer')
  assert.equal(chat.error?.kind, 'unknown')

  // API error already rendered as the synthetic assistant text: neither footer nor notice repeat it
  chat = run(addUserMessage(chat, { uuid: 'u2', text: 'again' }, NOW), [
    sdk({
      type: 'assistant',
      uuid: 'ae',
      parent_tool_use_id: null,
      error: 'overloaded',
      message: { id: 'me', model: '<synthetic>', content: [{ type: 'text', text: 'API Error: overloaded' }] }
    }),
    { type: 'error', message: 'API Error: overloaded', kind: 'unknown' },
    resultMsg({ subtype: 'success', is_error: true, result: 'API Error: overloaded' })
  ])
  res = chat.items[chat.items.length - 1] as ResultItem
  assert.equal(res.isError, true)
  assert.equal(res.errorText, undefined)
  const errItem = chat.items.find((i) => i.kind === 'assistant' && i.id === 'me')
  assert.ok(errItem && errItem.kind === 'assistant' && errItem.error === 'overloaded')
  assert.equal(chat.items.filter((i) => i.kind === 'notice').length, 0)

  // a fresh auth error with no visible text becomes a notice
  chat = run(addUserMessage(chat, { uuid: 'u3', text: 'hi' }, NOW), [{ type: 'error', message: 'Not logged in · Please run /login', kind: 'auth' }])
  const last = chat.items[chat.items.length - 1]
  assert.ok(last.kind === 'notice' && last.variant === 'error' && last.errorKind === 'auth')
})

test('system notices: compact boundary, collapsing retries, mode change, errors, command output', () => {
  let chat = run(newChat(), [
    assistantFrame('m0', { type: 'text', text: 'hi' }),
    sdk({ type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, retry_delay_ms: 2000, error_status: 529, error: 'overloaded' }),
    sdk({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, retry_delay_ms: 4000, error_status: 529, error: 'overloaded' })
  ])
  const retries = chat.items.filter((i) => i.kind === 'notice' && i.variant === 'retry')
  assert.equal(retries.length, 1, 'repeated retries collapse')
  assert.ok(retries[0].kind === 'notice' && retries[0].attempt === 2)

  chat = run(chat, [assistantFrame('m1', { type: 'text', text: 'recovered' })])
  assert.equal(chat.items.filter((i) => i.kind === 'notice' && i.variant === 'retry').length, 0, 'retry banner is transient')

  chat = run(chat, [
    sdk({ type: 'system', subtype: 'status', status: 'compacting' }),
    sdk({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 150_000, post_tokens: 20_000 } }),
    { type: 'mode-changed', modeId: 'agent', permission: 'acceptEdits' },
    { type: 'error', message: 'Not logged in', kind: 'auth' },
    { type: 'error', message: 'Not logged in', kind: 'auth' },
    sdk({ type: 'system', subtype: 'local_command_output', content: 'Total cost: $0.10' })
  ])
  assert.equal(chat.compacting, false)
  const notices = chat.items.filter((i) => i.kind === 'notice')
  assert.deepEqual(
    notices.map((n) => n.kind === 'notice' && n.variant),
    ['compact', 'mode', 'error', 'command-output']
  )
  const compact = notices[0]
  assert.ok(compact.kind === 'notice' && compact.compactTrigger === 'auto' && compact.preTokens === 150_000)
  assert.equal(chat.permission, 'acceptEdits')
  assert.deepEqual(chat.error, { message: 'Not logged in', kind: 'auth' })
})

test('ATOM events: init, capabilities, context usage, file-changed, suggestions, status close', () => {
  let chat = run(newChat(), [
    {
      type: 'init',
      info: {
        sessionId: 'sess-1',
        model: 'claude-opus',
        cwd: '/ws',
        tools: ['Read'],
        slashCommands: [],
        skills: [],
        agents: [],
        plugins: [],
        mcpServers: [],
        permissionMode: 'default',
        claudeCodeVersion: '3.0.0',
        apiKeySource: 'none'
      }
    },
    { type: 'capabilities', capabilities: { commands: [], models: [{ value: 'opus', label: 'Opus' }], agents: [] } },
    { type: 'context-usage', usage: { totalTokens: 5000, maxTokens: 200_000, percentage: 2.5 } },
    { type: 'file-changed', path: '/ws/a.ts', tool: 'Edit' },
    { type: 'file-changed', path: '/ws/b.ts', tool: 'Write' },
    { type: 'file-changed', path: '/ws/a.ts', tool: 'Edit' },
    sdk({ type: 'prompt_suggestion', suggestion: 'Run the tests', uuid: 'p', session_id: 'sess-1' }),
    sdk({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: 1_700_000_500, rateLimitType: 'five_hour', utilization: 0.9 } })
  ])
  assert.equal(chat.sessionId, 'sess-1')
  assert.equal(chat.started, true)
  assert.equal(chat.capabilities?.models[0].value, 'opus')
  assert.equal(chat.contextUsage?.percentage, 2.5)
  assert.deepEqual(chat.editedFiles, ['/ws/b.ts', '/ws/a.ts'])
  assert.equal(chat.suggestion, 'Run the tests')
  assert.equal(chat.rateLimit?.window, 'five_hour')
  assert.equal(chat.rateLimit?.resetsAt, 1_700_000_500_000)
  assert.equal(chat.items.length, 0, 'none of these touch the transcript')

  chat = run(chat, [
    { type: 'status', status: 'running' },
    stream({ type: 'message_start', message: { id: 'mx', model: 'm' } }),
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tx', name: 'Edit', input: {} } }),
    { type: 'status', status: 'closed' }
  ])
  assert.equal(chat.status, 'closed')
  assert.equal(findToolCall(chat, 'tx')?.status, 'interrupted')
  assert.deepEqual(chat.streams, {})
})

test('immutability: unchanged events return the same object; changes copy along the path', () => {
  const chat = run(newChat(), [assistantFrame('mi', { type: 'text', text: 'a' })])
  assert.equal(reduceAgentEvent(chat, sdk({ type: 'system', subtype: 'hook_started' })), chat)
  assert.equal(reduceAgentEvent(chat, { type: 'permission-resolved', requestId: 'nope', behavior: 'allow' }), chat)
  const before = chat.items[0]
  const after = reduceAgentEvent(chat, assistantFrame('other', { type: 'text', text: 'b' }))
  assert.notEqual(after, chat)
  assert.equal(after.items[0], before, 'untouched items keep their identity')
})

test('interrupt marker user message becomes a single notice; synthetic CLI text is hidden', () => {
  const chat = run(newChat(), [
    sdk({ type: 'user', uuid: 'i1', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
    sdk({ type: 'user', uuid: 'i2', parent_tool_use_id: null, message: { role: 'user', content: '[Request interrupted by user]' } }),
    sdk({ type: 'user', uuid: 'sk', parent_tool_use_id: null, isSynthetic: true, message: { role: 'user', content: 'Base directory for this skill: /x' } }),
    sdk({ type: 'user', uuid: 'plain', parent_tool_use_id: null, message: { role: 'user', content: 'internal CLI text' } })
  ])
  assert.deepEqual(
    chat.items.map((i) => (i.kind === 'notice' ? i.variant : i.kind)),
    ['interrupted']
  )
})

test('queued messages: consumed via user_message_uuids, cleared on result', () => {
  let chat = addUserMessage(newChat(), { uuid: 'q1', text: 'first' }, NOW)
  chat = addUserMessage({ ...chat, queuedCount: 1 }, { uuid: 'q2', text: 'also this', queued: true }, NOW)
  chat = run(chat, [
    sdk({
      type: 'assistant',
      uuid: 'a1',
      parent_tool_use_id: null,
      user_message_uuid: 'q2',
      user_message_uuids: ['q1', 'q2'],
      message: { id: 'mq', model: 'm', content: [{ type: 'text', text: 'ok' }] }
    })
  ])
  const q2 = chat.items.find((i) => i.kind === 'user' && i.uuid === 'q2')
  assert.ok(q2 && q2.kind === 'user' && !q2.queued)
  assert.equal(chat.queuedCount, 0)
})

test('stored history converts to transcript with tool results, todos and commands', () => {
  const messages: StoredSessionMessage[] = [
    {
      type: 'user',
      uuid: 'h1',
      session_id: 'S',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
          { type: 'text', text: '<atom_context>\n<active_editor path="/ws/a.ts" line="3"/>\n</atom_context>\nPlease fix the bug' }
        ]
      }
    },
    {
      type: 'assistant',
      uuid: 'h2',
      session_id: 'S',
      parent_tool_use_id: null,
      message: { id: 'msg_h', role: 'assistant', model: 'claude', content: [{ type: 'thinking', thinking: 'hmm', signature: 's' }] }
    },
    {
      type: 'assistant',
      uuid: 'h3',
      session_id: 'S',
      parent_tool_use_id: null,
      message: { id: 'msg_h', role: 'assistant', model: 'claude', content: [{ type: 'text', text: 'Looking.' }] }
    },
    {
      type: 'assistant',
      uuid: 'h4',
      session_id: 'S',
      parent_tool_use_id: null,
      message: {
        id: 'msg_h',
        role: 'assistant',
        model: 'claude',
        content: [{ type: 'tool_use', id: 'ht1', name: 'TodoWrite', input: { todos: [{ content: 'A', status: 'completed', activeForm: 'Doing A' }] } }]
      }
    },
    {
      type: 'user',
      uuid: 'h5',
      session_id: 'S',
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'ht1', content: 'Todos updated' }] }
    },
    {
      type: 'assistant',
      uuid: 'h6',
      session_id: 'S',
      parent_tool_use_id: null,
      message: { id: 'msg_h2', role: 'assistant', model: 'claude', content: [{ type: 'tool_use', id: 'ht2', name: 'Bash', input: { command: 'ls' } }] }
    },
    {
      type: 'user',
      uuid: 'h7',
      session_id: 'S',
      parent_tool_use_id: null,
      message: { role: 'user', content: 'Caveat: The messages below were generated by the user while running local commands.' }
    },
    {
      type: 'user',
      uuid: 'h8',
      session_id: 'S',
      parent_tool_use_id: null,
      message: { role: 'user', content: '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>keep tests</command-args>' }
    },
    {
      type: 'user',
      uuid: 'h9',
      session_id: 'S',
      parent_tool_use_id: null,
      message: { role: 'user', content: '<local-command-stdout>Compacted</local-command-stdout>' }
    }
  ]
  const history = historyFromStoredMessages(messages, NOW)
  assert.equal(history.sessionId, 'S')
  assert.deepEqual(
    history.items.map((i) => (i.kind === 'notice' ? `notice:${i.variant}` : i.kind)),
    ['user', 'assistant', 'assistant', 'user', 'notice:command-output']
  )
  const first = history.items[0]
  assert.ok(first.kind === 'user')
  assert.equal(first.text, 'Please fix the bug')
  assert.equal(first.imageCount, 1)
  assert.equal(first.thumbnails[0], 'data:image/png;base64,iVBOR')
  assert.equal(first.fromHistory, true)
  assert.equal(first.pending, false)
  assert.equal(first.checkpoint, true)
  const a1 = history.items[1]
  assert.ok(a1.kind === 'assistant')
  assert.deepEqual(
    a1.blocks.map((b) => b.kind),
    ['thinking', 'text', 'tool']
  )
  assert.equal(findToolCall(history.items, 'ht1')?.status, 'success')
  assert.equal(findToolCall(history.items, 'ht2')?.status, 'interrupted', 'a tool without result in history is interrupted')
  const cmd = history.items[3]
  assert.ok(cmd.kind === 'user' && cmd.text === '/compact keep tests')
  assert.deepEqual(history.todos, [{ content: 'A', status: 'completed', activeForm: 'Doing A' }])
  assert.equal(transcriptFromStoredMessages(messages, NOW).length, history.items.length)

  // applyHistory keeps messages typed before history arrived at the end
  let chat = addUserMessage(newChat(), { uuid: 'live', text: 'continue' }, NOW)
  chat = applyHistory({ ...chat, historyLoaded: false }, history, NOW)
  assert.equal(chat.historyLoaded, true)
  assert.equal(chat.items[chat.items.length - 1].id, 'live')
  assert.equal(chat.items.length, history.items.length + 1)
  assert.equal(chat.todos?.length, 1)
})

test('history: prompts wrapped in system reminders survive; generated ids never collide with live ones', () => {
  const history = historyFromStoredMessages(
    [
      {
        type: 'user',
        uuid: 'w1',
        session_id: 'S',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '<system-reminder>ctx A</system-reminder>' },
            { type: 'text', text: 'Refactor the parser' },
            { type: 'text', text: '<system-reminder>ctx B</system-reminder>' }
          ]
        }
      },
      { type: 'user', uuid: 'w2', session_id: 'S', parent_tool_use_id: null, message: { role: 'user', content: '[Request interrupted by user]' } }
    ],
    NOW
  )
  const first = history.items[0]
  assert.ok(first.kind === 'user' && first.text === 'Refactor the parser')
  let chat = reduceAgentEvent(newChat(), { type: 'error', message: 'boom', kind: 'process' }, NOW)
  chat = applyHistory(chat, history, NOW)
  const ids = chat.items.map((i) => i.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(chat.items.length, 3)
})

test('parsePartialJson repairs truncated input', () => {
  assert.deepEqual(parsePartialJson('{"a": 1, "b": "x'), { a: 1, b: 'x' })
  assert.deepEqual(parsePartialJson('{"a": 1, "b'), { a: 1 })
  assert.deepEqual(parsePartialJson('{"a": 1, "b":'), { a: 1 })
  assert.deepEqual(parsePartialJson('{"a": [1, 2'), { a: [1, 2] })
  assert.deepEqual(parsePartialJson('{"a": {"b": tr'), { a: {} })
  assert.deepEqual(parsePartialJson('{"todos":[{"content":"x","status":"pen'), { todos: [{ content: 'x', status: 'pen' }] })
  assert.deepEqual(parsePartialJson('{"s": "line\\'), { s: 'line' })
  assert.equal(parsePartialJson(''), undefined)
})

test('titleFromPrompt trims to 40 chars and strips IDE context', () => {
  assert.equal(titleFromPrompt('  Fix the login bug\nmore details'), 'Fix the login bug')
  const long = titleFromPrompt('a'.repeat(80))
  assert.equal(long.length, 40)
  assert.ok(long.endsWith('…'))
  assert.equal(titleFromPrompt('<atom_context>x</atom_context>   '), 'New chat')
})
