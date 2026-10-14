import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createChatState, findToolCall, isToolActive, reduceAgentEvent } from '../src/renderer/src/lib/agent-reducer.ts'
import { orphanedTaskNotification } from '../src/main/agent/session-logic.ts'
import type { AgentEvent } from '../src/shared/types.ts'
import type { ChatState, ToolCall } from '../src/renderer/src/lib/agent-types.ts'

const NOW = 1_700_000_000_000

function sdk(message: Record<string, unknown>): AgentEvent {
  return { type: 'sdk', message: { type: String(message.type), ...message } }
}

function run(chat: ChatState, events: AgentEvent[]): ChatState {
  let c = chat
  let t = NOW
  for (const e of events) c = reduceAgentEvent(c, e, ++t)
  return c
}

test('a background Bash card settles when main reports its task orphaned by a CLI restart', () => {
  let chat = run(createChatState({ id: 'c1', workspace: '/ws', modeId: 'agent', permission: 'default', model: '', effort: 'auto', now: NOW }), [
    { type: 'status', status: 'running' },
    sdk({
      type: 'assistant',
      uuid: 'a1',
      session_id: 's1',
      parent_tool_use_id: null,
      message: { id: 'm1', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'tool_use', id: 'tb', name: 'Bash', input: { command: 'npm run dev', run_in_background: true } }], stop_reason: 'tool_use' }
    }),
    sdk({ type: 'system', subtype: 'task_started', task_id: 'b1', tool_use_id: 'tb', description: 'npm run dev', task_type: 'local_bash', is_backgrounded: true, session_id: 's1', uuid: 'ts' }),
    sdk({ type: 'user', uuid: 'tr', session_id: 's1', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tb', content: 'Command running in background with ID: b1' }] } }),
    sdk({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1, duration_api_ms: 1, num_turns: 1, result: 'ok', stop_reason: 'end_turn', total_cost_usd: 0.01, usage: {}, permission_denials: [], session_id: 's1', uuid: 'r1' }),
    { type: 'status', status: 'idle' },
    // Mode switch: main restarts the CLI.
    { type: 'status', status: 'starting', detail: 'Applying the new configuration…' }
  ])
  assert.equal(isToolActive(findToolCall(chat, 'tb') as ToolCall), true, 'still running before the restart')

  chat = run(chat, [
    { type: 'sdk', message: orphanedTaskNotification('b1', { toolUseId: 'tb', description: 'npm run dev' }, 'Stopped: the agent restarted.', 's1', 'u1') },
    { type: 'status', status: 'idle' }
  ])
  const tool = findToolCall(chat, 'tb') as ToolCall
  assert.equal(tool.subagent?.status, 'stopped')
  assert.equal(isToolActive(tool), false)
})
