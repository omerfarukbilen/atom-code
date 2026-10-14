import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import {
  accountCost,
  applySessionGrants,
  budgetExhausted,
  reconcileOutstanding,
  remainingBudget,
  replaceBackgroundTasks,
  ruleString,
  type BackgroundTaskInfo
} from '../src/main/agent/session-logic.ts'

describe('reconcileOutstanding', () => {
  it('retires exactly the sends a result names', () => {
    const out = new Set(['a', 'b', 'c'])
    reconcileOutstanding(out, ['b'], 0)
    assert.deepEqual([...out], ['a', 'c'])
  })

  it('clears everything when nothing is queued and the result names no send', () => {
    const out = new Set(['a', 'b'])
    reconcileOutstanding(out, undefined, undefined)
    assert.equal(out.size, 0)
  })

  it('never retires a send the CLI still has queued (meta turn without uuids)', () => {
    // A background-task notification turn ends while the user's message M is queued behind it.
    const out = new Set(['M'])
    reconcileOutstanding(out, null, 1)
    assert.deepEqual([...out], ['M'])
  })

  it('retires the oldest sends down to the queued count', () => {
    const out = new Set(['a', 'b', 'c'])
    reconcileOutstanding(out, [], 1)
    assert.deepEqual([...out], ['c'])
  })
})

describe('applySessionGrants', () => {
  const allow = (destination: PermissionUpdate['destination'], ...rules: { toolName: string; ruleContent?: string }[]): PermissionUpdate => ({
    type: 'addRules',
    behavior: 'allow',
    destination,
    rules
  })

  it('keeps allow rules and directories granted for this chat only', () => {
    const rules = new Set<string>()
    const dirs = new Set<string>()
    applySessionGrants(rules, dirs, [
      allow('session', { toolName: 'Bash', ruleContent: 'npm test:*' }, { toolName: 'WebFetch' }),
      allow('localSettings', { toolName: 'Bash', ruleContent: 'rm:*' }),
      { type: 'addRules', behavior: 'deny', destination: 'session', rules: [{ toolName: 'Write' }] },
      { type: 'addDirectories', destination: 'session', directories: ['/tmp/extra'] },
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' }
    ])
    assert.deepEqual([...rules], ['Bash(npm test:*)', 'WebFetch'])
    assert.deepEqual([...dirs], ['/tmp/extra'])
  })

  it('applies removals and replacements', () => {
    const rules = new Set(['Bash(ls:*)', 'Read'])
    const dirs = new Set(['/a', '/b'])
    applySessionGrants(rules, dirs, [
      { type: 'removeRules', behavior: 'allow', destination: 'session', rules: [{ toolName: 'Read' }] },
      { type: 'removeDirectories', destination: 'session', directories: ['/a'] }
    ])
    assert.deepEqual([...rules], ['Bash(ls:*)'])
    assert.deepEqual([...dirs], ['/b'])
    applySessionGrants(rules, dirs, [{ type: 'replaceRules', behavior: 'allow', destination: 'session', rules: [{ toolName: 'Edit' }] }])
    assert.deepEqual([...rules], ['Edit'])
  })

  it('formats rule strings like allowedTools', () => {
    assert.equal(ruleString({ toolName: 'Bash', ruleContent: 'git status' }), 'Bash(git status)')
    assert.equal(ruleString({ toolName: 'mcp__srv__tool' }), 'mcp__srv__tool')
    assert.equal(ruleString({ toolName: ' ' }), null)
  })
})

describe('per-chat spending', () => {
  it('accumulates the cumulative total of one CLI process', () => {
    let s = { spent: 0, processTotal: 0 }
    s = accountCost(s, 0.25)
    s = accountCost(s, 0.5)
    assert.equal(s.spent, 0.5)
  })

  it('continues across a restart whose resume restored the saved total', () => {
    let s = { spent: 0.5, processTotal: 0.5 } // baseline after relaunch = what was spent
    s = accountCost(s, 0.75) // restored 0.5 + this turn 0.25
    assert.equal(s.spent, 0.75)
  })

  it('handles a process (or /clear) that starts counting from zero again', () => {
    let s = { spent: 1, processTotal: 1 }
    s = accountCost(s, 0.2)
    assert.ok(Math.abs(s.spent - 1.2) < 1e-9)
    s = accountCost(s, 0.3)
    assert.ok(Math.abs(s.spent - 1.3) < 1e-9)
  })

  it('ignores zeroed and invalid totals', () => {
    const s = { spent: 1, processTotal: 1 }
    assert.equal(accountCost(s, 0), s)
    assert.equal(accountCost(s, Number.NaN), s)
    assert.equal(accountCost(s, undefined), s)
  })

  it('passes what is left of the budget to the next launch and reports exhaustion', () => {
    assert.equal(remainingBudget(null, 5), null)
    assert.equal(remainingBudget(0, 5), null)
    assert.equal(remainingBudget(2, 0.5), 1.5)
    assert.equal(remainingBudget(2, 3), 0.01)
    assert.equal(budgetExhausted(2, 1.99), false)
    assert.equal(budgetExhausted(2, 2), true)
    assert.equal(budgetExhausted(null, 100), false)
  })
})

describe('replaceBackgroundTasks', () => {
  it('replaces the set, skips ambient watchers and keeps tool_use ids', () => {
    const tasks = new Map<string, BackgroundTaskInfo>([['old', { description: 'gone' }]])
    replaceBackgroundTasks(
      tasks,
      [
        { task_id: 't1', task_type: 'local_bash', description: 'npm run dev' },
        { task_id: 'w1', task_type: 'monitor', description: 'watch', ambient: true }
      ],
      new Map([['t1', 'toolu_1']])
    )
    assert.deepEqual([...tasks.entries()], [['t1', { toolUseId: 'toolu_1', description: 'npm run dev' }]])
    replaceBackgroundTasks(tasks, [], new Map())
    assert.equal(tasks.size, 0)
  })

  it('ignores malformed payloads', () => {
    const tasks = new Map<string, BackgroundTaskInfo>([['t1', {}]])
    replaceBackgroundTasks(tasks, null, new Map())
    assert.equal(tasks.size, 1)
  })
})
