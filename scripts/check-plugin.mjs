#!/usr/bin/env node
// Validates the bundled ATOM plugin (resources/atom-plugin).
//
//   node scripts/check-plugin.mjs                       static checks + load through the Claude Agent SDK
//   node scripts/check-plugin.mjs --static              static checks only (no Claude Code process)
//   node scripts/check-plugin.mjs --plugin-dir=<path>   check another copy of the plugin (default
//                                                       resources/atom-plugin, relative to the repo root)
//
// Part (a) parses every skill, subagent and command, checks frontmatter and relative links.
// Part (b) starts a Claude Agent SDK session with the plugin loaded and asks the harness which
// skills, commands and agents it discovered. No prompt is ever sent, so no model call is made:
// the prompt stream is an async generator that never yields, and every tool use is denied.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Run from the repository root so the relative plugin path and `cwd: process.cwd()` agree wherever the
// script is started from.
process.chdir(ROOT)
const PLUGIN_REL = process.argv.find((a) => a.startsWith('--plugin-dir='))?.slice('--plugin-dir='.length) || 'resources/atom-plugin'
const PLUGIN_DIR = resolve(ROOT, PLUGIN_REL)
const PLUGIN_NAME = 'atom'
const TIMEOUT_MS = 60_000
const STATIC_ONLY = process.argv.includes('--static')

const EXPECTED = {
  skills: [
    'systematic-debugging', 'test-driven-development', 'code-review', 'writing-plans', 'executing-plans',
    'refactoring', 'git-workflow', 'frontend-design', 'api-design', 'security-audit',
    'performance-optimization', 'documentation', 'project-onboarding', 'dependency-upgrades',
    'database-migrations', 'error-handling', 'writing-skills',
  ],
  agents: [
    'code-reviewer', 'debugger', 'test-engineer', 'architect', 'security-auditor', 'docs-writer',
    'refactorer', 'explorer',
  ],
  commands: [
    'review', 'test', 'commit', 'explain', 'fix', 'plan', 'init', 'pr', 'refactor', 'docs', 'optimize',
    'security',
  ],
}

// Tools that exist in the Claude Code harness ATOM runs, plus ATOM's IDE MCP server.
// `Task` is the legacy name of `Agent` and is still accepted as an alias.
const KNOWN_TOOLS = new Set([
  'Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'NotebookEdit', 'TodoWrite', 'Agent', 'Task',
  'WebSearch', 'WebFetch', 'AskUserQuestion', 'Skill', 'TaskStop', 'ExitPlanMode', 'EnterPlanMode',
  'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList', 'Monitor',
])
// Tools older Claude Code versions had; listing them is harmless but they no longer exist.
const LEGACY_TOOLS = new Set(['MultiEdit', 'BashOutput', 'KillShell', 'SlashCommand', 'LS'])
const IDE_TOOLS = new Set(['get_diagnostics', 'get_open_editors', 'get_selection', 'get_terminal_output', 'open_file'])
const MODELS = new Set(['inherit', 'sonnet', 'opus', 'haiku'])
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DESCRIPTION_MAX = 600
const SKILL_MAX_LINES = 320

const errors = []
const warnings = []
// Paths inside the repository print relative to its root, others (a --plugin-dir copy) absolute.
const rel = (file) => (file.startsWith(ROOT + '/') ? relative(ROOT, file) : file)
const err = (file, msg) => errors.push(`${rel(file)}: ${msg}`)
const warn = (file, msg) => warnings.push(`${rel(file)}: ${msg}`)

// ---------------------------------------------------------------------------------------------
// Frontmatter parsing: js-yaml when it is resolvable (it is a transitive dev dependency),
// otherwise a strict parser for the flat `key: value` subset the plugin uses.

let yamlLoad = null
try {
  yamlLoad = (await import('js-yaml')).load
} catch {
  yamlLoad = null
}

function parseFlatYaml(src) {
  const data = {}
  for (const [i, raw] of src.split('\n').entries()) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const m = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line)
    if (!m) throw new Error(`line ${i + 1} is not a flat "key: value" pair: ${line}`)
    let value = (m[2] ?? '').trim()
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    else if (/:\s|\s#/.test(value)) throw new Error(`line ${i + 1}: unquoted value contains ": " or " #"`)
    data[m[1]] = value
  }
  return data
}

function readFrontmatter(file) {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text)
  if (!m) {
    err(file, 'missing YAML frontmatter (file must start with a --- line and close it with ---)')
    return null
  }
  try {
    const data = yamlLoad ? yamlLoad(m[1]) : parseFlatYaml(m[1])
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      err(file, 'frontmatter is not a YAML mapping')
      return null
    }
    return { data, body: m[2], text }
  } catch (e) {
    err(file, `invalid YAML frontmatter: ${String(e.message ?? e).split('\n')[0]}`)
    return null
  }
}

function checkDescription(file, description, { max = DESCRIPTION_MAX } = {}) {
  if (typeof description !== 'string' || !description.trim()) {
    err(file, 'description is missing or empty')
    return
  }
  if (description.length > max) err(file, `description is ${description.length} chars (max ~${max})`)
  if (/[<>]/.test(description)) err(file, 'description contains angle brackets')
  if (description.trim().split(/\s+/).length < 8) warn(file, 'description is very short; lead with concrete triggers')
}

// Relative markdown links must resolve to existing files. Fenced code and inline code are ignored.
function checkLinks(file, text) {
  const dir = dirname(file)
  const withoutFences = text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, '')
  const targets = []
  for (const m of withoutFences.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) targets.push(m[1])
  const linked = new Set()
  for (const target of targets) {
    if (/^(?:[a-z][\w+.-]*:|#|\/\/)/i.test(target)) continue // URL, anchor, mailto
    const path = decodeURIComponent(target.split('#')[0])
    if (!path) continue
    const abs = resolve(dir, path)
    if (!abs.startsWith(PLUGIN_DIR)) {
      err(file, `link escapes the plugin directory: ${target}`)
      continue
    }
    if (!existsSync(abs)) err(file, `broken relative link: ${target}`)
    else linked.add(abs)
  }
  return linked
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

function toolNames(file, field, value, { allowPatterns = false } = {}) {
  const list = Array.isArray(value) ? value : String(value).split(',')
  for (const raw of list.map((t) => String(t).trim()).filter(Boolean)) {
    const base = allowPatterns ? raw.replace(/\(.*\)$/, '') : raw
    if (KNOWN_TOOLS.has(base)) continue
    if (LEGACY_TOOLS.has(base)) {
      warn(file, `${field}: "${raw}" is a legacy tool the current harness no longer provides`)
      continue
    }
    const ide = /^mcp__atom-ide__(.+)$/.exec(base)
    if (ide && (IDE_TOOLS.has(ide[1]) || ide[1] === '*')) continue
    if (base.startsWith('mcp__')) {
      warn(file, `${field}: MCP tool ${raw} is not one of ATOM's bundled servers`)
      continue
    }
    err(file, `${field}: unknown tool "${raw}"`)
  }
}

// ---------------------------------------------------------------------------------------------
// (a) Static validation

const found = { skills: [], agents: [], commands: [] }
const rows = []
// Frontmatter per qualified name, compared with what the harness reports in part (b).
const meta = new Map()

function staticChecks() {
  const manifest = join(PLUGIN_DIR, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifest)) err(manifest, 'plugin manifest is missing')
  else {
    try {
      const json = JSON.parse(readFileSync(manifest, 'utf8'))
      if (json.name !== PLUGIN_NAME) err(manifest, `plugin name is "${json.name}", expected "${PLUGIN_NAME}"`)
      if (!json.description) warn(manifest, 'manifest has no description')
    } catch (e) {
      err(manifest, `invalid JSON: ${e.message}`)
    }
  }

  // Skills
  const skillsDir = join(PLUGIN_DIR, 'skills')
  const skillDirs = existsSync(skillsDir)
    ? readdirSync(skillsDir).filter((d) => statSync(join(skillsDir, d)).isDirectory())
    : []
  for (const dir of skillDirs) {
    const file = join(skillsDir, dir, 'SKILL.md')
    if (!existsSync(file)) {
      err(join(skillsDir, dir), 'skill directory has no SKILL.md')
      continue
    }
    found.skills.push(dir)
    if (!KEBAB.test(dir)) err(file, `directory name "${dir}" is not kebab-case`)
    const fm = readFrontmatter(file)
    if (!fm) continue
    const { data, body, text } = fm
    if (data.name !== dir) err(file, `frontmatter name "${data.name}" does not match directory "${dir}"`)
    checkDescription(file, data.description)
    const lines = text.split('\n').length
    if (lines > SKILL_MAX_LINES) warn(file, `${lines} lines; move long material into references/`)
    if (!/^#\s+\S/m.test(body)) warn(file, 'body has no top-level heading')

    // Links from SKILL.md and references/ must resolve; templates/ are output skeletons whose links
    // point into the user's project, so they are not checked. Bundled files nobody links to are orphans.
    const skillRoot = join(skillsDir, dir)
    const linked = new Set()
    const files = walk(skillRoot)
    const templatesDir = join(skillRoot, 'templates')
    for (const f of files.filter((f) => f.endsWith('.md') && !f.startsWith(templatesDir))) {
      for (const l of checkLinks(f, readFileSync(f, 'utf8'))) linked.add(l)
    }
    for (const f of files) {
      if (f === file) continue
      if (!linked.has(f)) warn(f, 'bundled file is not linked from SKILL.md or any sibling file')
    }
    meta.set(`${PLUGIN_NAME}:${dir}`, { file, description: data.description })
    rows.push({ kind: 'skill', name: `${PLUGIN_NAME}:${dir}`, lines, desc: String(data.description ?? '').length, extra: `${files.length - 1} bundled` })
  }

  // Agents
  const agentsDir = join(PLUGIN_DIR, 'agents')
  for (const f of existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith('.md')) : []) {
    const file = join(agentsDir, f)
    const base = f.replace(/\.md$/, '')
    found.agents.push(base)
    const fm = readFrontmatter(file)
    if (!fm) continue
    const { data, body, text } = fm
    if (data.name !== base) err(file, `frontmatter name "${data.name}" does not match file name "${base}"`)
    if (!KEBAB.test(base)) err(file, `file name "${base}" is not kebab-case`)
    checkDescription(file, data.description, { max: 1000 })
    if (data.tools === undefined || data.tools === null || data.tools === '') err(file, 'tools is missing')
    else toolNames(file, 'tools', data.tools)
    if (!data.model) err(file, 'model is missing')
    else if (!MODELS.has(String(data.model))) err(file, `model "${data.model}" is not one of ${[...MODELS].join(', ')}`)
    if (body.trim().split('\n').length < 20) warn(file, 'system prompt body looks thin')
    checkLinks(file, text)
    meta.set(`${PLUGIN_NAME}:${base}`, { file, description: data.description, model: data.model })
    rows.push({ kind: 'agent', name: `${PLUGIN_NAME}:${base}`, lines: text.split('\n').length, desc: String(data.description ?? '').length, extra: `${data.model}; ${String(data.tools)}` })
  }

  // Commands
  const commandsDir = join(PLUGIN_DIR, 'commands')
  for (const f of existsSync(commandsDir) ? readdirSync(commandsDir).filter((f) => f.endsWith('.md')) : []) {
    const file = join(commandsDir, f)
    const base = f.replace(/\.md$/, '')
    found.commands.push(base)
    if (!KEBAB.test(base)) err(file, `file name "${base}" is not kebab-case`)
    const fm = readFrontmatter(file)
    if (!fm) continue
    const { data, body, text } = fm
    checkDescription(file, data.description, { max: 300 })
    if (typeof data['argument-hint'] !== 'string' || !data['argument-hint'].trim()) err(file, 'argument-hint is missing')
    if (data['allowed-tools'] !== undefined) toolNames(file, 'allowed-tools', data['allowed-tools'], { allowPatterns: true })
    if (!/\$ARGUMENTS|\$\d/.test(body)) warn(file, 'body never uses $ARGUMENTS / $1, so user arguments are dropped')
    if (data.name !== undefined && data.name !== base) err(file, `frontmatter name "${data.name}" does not match file name "${base}"`)
    checkLinks(file, text)
    meta.set(`${PLUGIN_NAME}:${base}`, { file, description: data.description, argumentHint: data['argument-hint'] })
    rows.push({ kind: 'command', name: `/${PLUGIN_NAME}:${base}`, lines: text.split('\n').length, desc: String(data.description ?? '').length, extra: String(data['argument-hint'] ?? '') })
  }

  // Skills and commands share the slash-command namespace, so the same name would shadow one of them.
  for (const name of found.skills.filter((n) => found.commands.includes(n))) {
    errors.push(`${PLUGIN_REL}: skill and command are both named "${name}"; ${PLUGIN_NAME}:${name} would be ambiguous`)
  }

  for (const kind of Object.keys(EXPECTED)) {
    for (const name of EXPECTED[kind]) {
      if (!found[kind].includes(name)) errors.push(`${PLUGIN_REL}: expected ${kind.slice(0, -1)} "${name}" is missing`)
    }
    for (const name of found[kind]) {
      if (!EXPECTED[kind].includes(name)) warnings.push(`${PLUGIN_REL}: unexpected ${kind.slice(0, -1)} "${name}" (add it to EXPECTED if intentional)`)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// (b) Load through the Claude Agent SDK without any model call

let activeQuery = null

async function sdkCheck() {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')

  async function* silentPrompt() {
    // Keeps the streaming-input session open without ever sending a user message.
    await new Promise(() => {})
  }

  const q = (activeQuery = query({
    prompt: silentPrompt(),
    options: {
      cwd: process.cwd(),
      plugins: [{ type: 'local', path: PLUGIN_REL }],
      skills: 'all',
      settingSources: [],
      canUseTool: async () => ({ behavior: 'deny', message: 'check' }),
      stderr: (data) => {
        if (process.env.CHECK_PLUGIN_DEBUG) process.stderr.write(data)
      },
    },
  }))

  try {
    const [commands, agents] = await Promise.all([q.supportedCommands(), q.supportedAgents()])
    const commandNames = new Set(commands.map((c) => c.name))
    const agentNames = new Set(agents.map((a) => a.name))

    // The harness parses frontmatter itself; if its view differs from ours, a YAML subtlety (an unquoted
    // colon, a stray quote) changed the text the model will actually see.
    const strip = (d) => String(d ?? '').replace(new RegExp(`^\\(${PLUGIN_NAME}\\)\\s*`), '').trim()
    for (const entry of [...commands, ...agents]) {
      const m = meta.get(entry.name)
      if (!m) continue
      const ours = String(m.description ?? '').trim()
      const theirs = strip(entry.description)
      if (theirs !== ours) {
        if (ours.startsWith(theirs.replace(/(\.\.\.|…)$/, '').slice(0, 80))) {
          warnings.push(`${rel(m.file)}: harness shortens the description to ${theirs.length} chars`)
        } else {
          errors.push(`${rel(m.file)}: harness reads a different description: "${theirs.slice(0, 80)}..."`)
        }
      }
      if (m.argumentHint !== undefined && entry.argumentHint !== m.argumentHint) {
        errors.push(`${rel(m.file)}: harness reads argument-hint "${entry.argumentHint}"`)
      }
      if (m.model !== undefined && entry.model !== undefined && entry.model !== m.model) {
        errors.push(`${rel(m.file)}: harness reads model "${entry.model}", frontmatter says "${m.model}"`)
      }
    }
    const sdkRows = []
    const missing = []
    for (const s of EXPECTED.skills) {
      const name = `${PLUGIN_NAME}:${s}`
      const ok = commandNames.has(name)
      if (!ok) missing.push(`skill ${name}`)
      sdkRows.push(['skill', name, ok])
    }
    for (const c of EXPECTED.commands) {
      const name = `${PLUGIN_NAME}:${c}`
      const ok = commandNames.has(name)
      if (!ok) missing.push(`command /${name}`)
      sdkRows.push(['command', `/${name}`, ok])
    }
    for (const a of EXPECTED.agents) {
      const name = `${PLUGIN_NAME}:${a}`
      const ok = agentNames.has(name)
      if (!ok) missing.push(`agent ${name}`)
      sdkRows.push(['agent', name, ok])
    }
    const extra = [...commandNames, ...agentNames].filter(
      (n) => n.startsWith(`${PLUGIN_NAME}:`) && !sdkRows.some(([, row]) => row.replace(/^\//, '') === n),
    )
    return { sdkRows, missing, extra, totalCommands: commands.length, totalAgents: agents.length }
  } finally {
    q.close()
    activeQuery = null
  }
}

// ---------------------------------------------------------------------------------------------

function table(header, data) {
  const widths = header.map((h, i) => Math.max(h.length, ...data.map((r) => String(r[i]).length)))
  const line = (r) => r.map((c, i) => String(c).padEnd(widths[i])).join('  ')
  return [line(header), widths.map((w) => '-'.repeat(w)).join('  '), ...data.map(line)].join('\n')
}

async function main() {
  const timer = setTimeout(() => {
    console.error(`\nFAIL: timed out after ${TIMEOUT_MS / 1000}s`)
    activeQuery?.close()
    process.exit(1)
  }, TIMEOUT_MS)

  staticChecks()

  console.log(`ATOM plugin check - ${PLUGIN_REL}  (frontmatter parser: ${yamlLoad ? 'js-yaml' : 'built-in flat YAML'})\n`)
  console.log(table(
    ['kind', 'name', 'lines', 'desc', 'details'],
    rows.map((r) => [r.kind, r.name, r.lines, r.desc, r.extra.length > 70 ? `${r.extra.slice(0, 67)}...` : r.extra]),
  ))
  console.log(`\nStatic: ${found.skills.length} skills, ${found.agents.length} agents, ${found.commands.length} commands; ${errors.length} error(s), ${warnings.length} warning(s)`)

  let sdkFailed = false
  if (!STATIC_ONLY) {
    try {
      const { sdkRows, missing, extra, totalCommands, totalAgents } = await sdkCheck()
      console.log('\nClaude Agent SDK discovery (no prompt sent):\n')
      console.log(table(['kind', 'name', 'loaded'], sdkRows.map(([k, n, ok]) => [k, n, ok ? 'yes' : 'MISSING'])))
      const loaded = sdkRows.filter(([, , ok]) => ok).length
      console.log(`\nSDK: ${loaded}/${sdkRows.length} expected atom:* entries loaded (session lists ${totalCommands} commands/skills, ${totalAgents} agents)`)
      if (extra.length) warnings.push(`SDK lists unexpected plugin entries: ${extra.join(', ')}`)
      for (const m of missing) errors.push(`SDK did not load ${m}`)
    } catch (e) {
      sdkFailed = true
      errors.push(`SDK load failed: ${e?.stack ?? e}`)
    }
  }

  if (warnings.length) console.log(`\nWarnings:\n${warnings.map((w) => `  - ${w}`).join('\n')}`)
  if (errors.length) console.log(`\nErrors:\n${errors.map((e) => `  - ${e}`).join('\n')}`)

  clearTimeout(timer)
  const ok = errors.length === 0
  console.log(`\n${ok ? 'PASS' : 'FAIL'}${STATIC_ONLY ? ' (static only)' : ''}${sdkFailed ? ' (SDK load failed)' : ''}`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
