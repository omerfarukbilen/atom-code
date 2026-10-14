#!/usr/bin/env node
// Non-model smoke test for the Claude Agent SDK integration ATOM Code relies on.
//
//   node scripts/smoke-sdk.mjs
//
// Starts a query() in streaming-input mode whose prompt stream never yields a message, with the
// bundled ATOM plugin loaded, then asks the harness for its initialization result, slash commands,
// models and subagents, prints counts plus every `atom:*` entry, and closes the query.
// No user message is ever sent, so no model/API call happens. Every tool use is denied anyway.
//
// Exit code 0 on success, 1 on failure or when it does not finish within 60 s.
// Optional: CLAUDE_BIN=/path/to/claude to drive a specific Claude Code executable.

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { query } from '@anthropic-ai/claude-agent-sdk'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_DIR = resolve(ROOT, 'resources/atom-plugin')
const TIMEOUT_MS = 60_000
const PLUGIN_PREFIX = 'atom:'

function fail(message, err) {
  const detail = err instanceof Error ? err.message : err === undefined ? '' : String(err)
  console.error(`[smoke-sdk] FAIL: ${message}${detail ? ` — ${detail}` : ''}`)
  process.exit(1)
}

/** A prompt stream that stays open and never yields; `end()` finishes it so the CLI can exit. */
function silentPrompt() {
  let release = () => undefined
  const ended = new Promise((r) => (release = r))
  return {
    end: () => release(),
    async *[Symbol.asyncIterator]() {
      await ended
    }
  }
}

const watchdog = setTimeout(() => fail(`did not finish within ${TIMEOUT_MS / 1000}s`), TIMEOUT_MS)
watchdog.unref()

if (!existsSync(PLUGIN_DIR)) fail(`plugin directory not found: ${PLUGIN_DIR}`)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.CLAUDE_AGENT_SDK_CLIENT_APP = 'atom-code-smoke/0'

const stderrTail = []
const prompt = silentPrompt()
const options = {
  cwd: ROOT,
  env,
  plugins: [{ type: 'local', path: PLUGIN_DIR }],
  settingSources: ['project', 'local'],
  permissionMode: 'default',
  persistSession: false,
  canUseTool: async () => ({ behavior: 'deny', message: 'smoke test: tools are disabled' }),
  stderr: (data) => {
    stderrTail.push(data)
    if (stderrTail.length > 40) stderrTail.shift()
  }
}
if (process.env.CLAUDE_BIN) options.pathToClaudeCodeExecutable = process.env.CLAUDE_BIN

const started = Date.now()
const q = query({ prompt, options })

// Drain the output stream so the transport never back-pressures; record what arrives unprompted.
const unprompted = []
const drained = (async () => {
  try {
    for await (const msg of q) unprompted.push(msg.subtype ? `${msg.type}/${msg.subtype}` : msg.type)
  } catch (err) {
    return err
  }
  return null
})()

function printEntries(label, names) {
  const atom = names.filter((n) => n.startsWith(PLUGIN_PREFIX)).sort()
  console.log(`${label}: ${names.length} total, ${atom.length} from the ATOM plugin`)
  for (const name of atom) console.log(`  - ${name}`)
}

try {
  const init = await q.initializationResult()
  console.log(`[smoke-sdk] initialized in ${Date.now() - started} ms`)
  console.log(
    `initializationResult: ${init.commands?.length ?? 0} commands, ${init.models?.length ?? 0} models, ${init.agents?.length ?? 0} agents`
  )

  const [commands, models, agents] = await Promise.all([q.supportedCommands(), q.supportedModels(), q.supportedAgents()])
  printEntries('supportedCommands', commands.map((c) => c.name))
  console.log(`supportedModels: ${models.length} total`)
  for (const m of models) console.log(`  - ${m.value}${m.displayName ? ` (${m.displayName})` : ''}`)
  printEntries('supportedAgents', agents.map((a) => a.name))

  const atomTotal =
    commands.filter((c) => c.name.startsWith(PLUGIN_PREFIX)).length + agents.filter((a) => a.name.startsWith(PLUGIN_PREFIX)).length
  if (atomTotal === 0) console.warn('[smoke-sdk] warning: no atom:* commands/skills/agents were discovered (plugin incomplete?)')
} catch (err) {
  const tail = stderrTail.join('').trim().split('\n').slice(-10).join('\n')
  q.close()
  fail('the SDK control requests failed', tail ? `${err instanceof Error ? err.message : String(err)}\n${tail}` : err)
}

prompt.end()
q.close()
const drainError = await Promise.race([drained, new Promise((r) => setTimeout(() => r(null), 5000))])
if (drainError && !/abort/i.test(String(drainError?.name ?? drainError))) {
  console.warn(`[smoke-sdk] note: output stream ended with: ${drainError instanceof Error ? drainError.message : String(drainError)}`)
}
console.log(`messages received without a prompt: ${unprompted.length ? unprompted.join(', ') : 'none'}`)
console.log(`[smoke-sdk] OK in ${Date.now() - started} ms — no prompt was sent`)
clearTimeout(watchdog)
process.exit(0)
