import type { LibraryKind } from '@shared/types'

export interface TemplateInput {
  name: string
  description: string
  /** Agents: comma separated tool list ('' = inherit all tools). */
  tools?: string
  /** Agents: sonnet | opus | haiku | inherit. */
  model?: string
  /** Commands: e.g. "[file or area]". */
  argumentHint?: string
}

export const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function validateLibraryName(name: string): string | null {
  if (!name) return 'Required.'
  if (name.length > 64) return 'Keep it under 64 characters.'
  if (!KEBAB_RE.test(name)) return 'Use kebab-case: lowercase letters, digits and single dashes (e.g. api-review).'
  return null
}

/** "api-review" → "Api Review" */
export function titleCase(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Quote a YAML scalar only when needed (keeps simple frontmatter readable). */
export function yamlScalar(value: string): string {
  const v = value.replace(/\s*\n\s*/g, ' ').trim()
  if (!v) return '""'
  const needsQuotes = /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(v) || /:\s|\s#/.test(v) || /^(true|false|null|yes|no|on|off|~)$/i.test(v) || /^[\d.+-]+$/.test(v)
  return needsQuotes ? JSON.stringify(v) : v
}

function skillTemplate({ name, description }: TemplateInput): string {
  const title = titleCase(name)
  const desc = description.trim() || `Use when … (describe the situations, keywords and file types that should trigger ${title.toLowerCase()})`
  return `---
name: ${name}
description: ${yamlScalar(desc)}
---

# ${title}

One or two sentences on what this skill achieves and why it matters. Write for an expert engineer
who has never seen this codebase: be concrete, skip the obvious.

## When to use
- The user asks to … (paraphrase the typical requests)
- You notice … in the code (symptoms, file types, frameworks)

## When NOT to use
- Small one-line changes where the full process is overkill
- Situations better handled by another skill (name it)

## Steps
1. **Understand the context.** Read the relevant files first; identify conventions to follow.
2. **Plan.** List the concrete changes before editing. Ask with AskUserQuestion if requirements are ambiguous.
3. **Do the work.** Make focused, minimal changes that match the surrounding style.
4. **Verify.** Run the typecheck / tests / the code itself and read the output — never assume.
5. **Report.** Summarise what changed (with \`path:line\` references) and anything left to do.

## Checklist
- [ ] Followed existing patterns and naming in the codebase
- [ ] Handled errors and edge cases (empty input, missing files, network failures)
- [ ] Verified the result by actually running it
- [ ] No leftover debug output, TODOs or unrelated changes

## Examples

### Example: <a typical request>
**Input:** “<what the user says>”

**Good approach:**
1. …
2. …

**Avoid:** <a common mistake and why it is wrong>

## Notes
- Gotchas, links to internal docs, commands worth remembering.
`
}

function agentTemplate({ name, description, tools, model }: TemplateInput): string {
  const title = titleCase(name)
  const desc = description.trim() || `Use this agent when … (describe the tasks to delegate to the ${title.toLowerCase()})`
  const toolList = (tools ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const lines = ['---', `name: ${name}`, `description: ${yamlScalar(desc)}`]
  if (toolList.length > 0) lines.push(`tools: ${toolList.join(', ')}`)
  if (model && model !== 'inherit') lines.push(`model: ${model}`)
  lines.push('---')
  return `${lines.join('\n')}

You are the **${title}**, a specialist subagent working inside ATOM Code. The main agent delegates focused
tasks to you; you work independently and return a concise, high-signal report.

## Your responsibilities
- …
- …

## Process
1. Restate the task in one sentence and identify what "done" looks like.
2. Gather evidence: read the relevant files, search the codebase, run read-only commands.
3. Do the work step by step. Prefer precise, verifiable statements over speculation.
4. Double-check your conclusions against the code before reporting.

## Output format
Return a short report:
- **Summary** — the answer or outcome in 1–3 sentences
- **Details** — findings with \`path:line\` references
- **Next steps** — concrete recommendations (if any)

## Constraints
- Stay within the scope of the task you were given.
- Do not modify files unless the task explicitly asks for it.
- If information is missing, say what you need instead of guessing.
`
}

function commandTemplate({ name, description, argumentHint }: TemplateInput): string {
  const title = titleCase(name)
  const desc = description.trim() || `${title} for the given target`
  const lines = ['---', `description: ${yamlScalar(desc)}`]
  if (argumentHint?.trim()) lines.push(`argument-hint: ${yamlScalar(argumentHint.trim())}`)
  lines.push('---')
  return `${lines.join('\n')}

${desc}.

Target: $ARGUMENTS

If no target was given, infer it from the current context (open file, selection, recent changes) and say what you chose.

## Steps
1. Read the relevant code and understand its intent before changing anything.
2. …
3. Verify the result (typecheck, tests or running the code).

## Output
- A short summary of what you did and why
- \`path:line\` references for every change or finding
`
}

export function generateTemplate(kind: LibraryKind, input: TemplateInput): string {
  switch (kind) {
    case 'skill':
      return skillTemplate(input)
    case 'agent':
      return agentTemplate(input)
    case 'command':
      return commandTemplate(input)
  }
}

export const KIND_LABELS: Record<LibraryKind, { singular: string; plural: string; folder: string }> = {
  skill: { singular: 'Skill', plural: 'Skills', folder: 'skills' },
  agent: { singular: 'Subagent', plural: 'Agents', folder: 'agents' },
  command: { singular: 'Command', plural: 'Commands', folder: 'commands' }
}

/** Relative location of a new item inside a scope root, for display. */
export function itemRelativePath(kind: LibraryKind, name: string): string {
  const n = name || '<name>'
  if (kind === 'skill') return `skills/${n}/SKILL.md`
  return `${KIND_LABELS[kind].folder}/${n}.md`
}
