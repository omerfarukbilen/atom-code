import type { AgentModeDefinition, ModelOption, PermissionPolicy } from './types'

/**
 * Built-in agent modes. A mode bundles a permission behaviour, a tool surface and extra system
 * instructions. Users can add their own modes in Settings → Modes (stored in AppSettings.customModes).
 */
export const BUILTIN_MODES: AgentModeDefinition[] = [
  {
    id: 'agent',
    name: 'Agent',
    description: 'Autonomous coding: explores, edits files and runs commands to finish the task.',
    icon: 'Bot',
    color: '#7c8cff',
    builtin: true,
    order: 1,
    systemPrompt: [
      'You are in AGENT mode: you are expected to complete the task end-to-end.',
      'Explore just enough to understand the code, make focused changes, then verify them (build, typecheck, tests, or running the code) before you report back.',
      'For multi-step work, keep a todo list with the TodoWrite tool and update it as you go so the user can follow your progress.',
      'Prefer small, reviewable edits that match the surrounding code style. Never claim something works unless you verified it.'
    ].join('\n')
  },
  {
    id: 'plan',
    name: 'Plan',
    description: 'Researches the codebase read-only and proposes a step-by-step plan for your approval.',
    icon: 'ListChecks',
    color: '#4fd1c5',
    builtin: true,
    order: 2,
    forcedPermissionMode: 'plan',
    skills: ['atom:writing-plans'],
    systemPrompt: [
      'You are in PLAN mode. Do not modify any files or run state-changing commands.',
      'Investigate the relevant code thoroughly (read files, search, trace call paths), ask clarifying questions with AskUserQuestion when requirements are ambiguous, then present a concrete implementation plan.',
      'A good plan lists: the goal, the files to change and why, the step-by-step changes, risks/edge cases, and how the result will be verified.',
      'When the plan is ready, call ExitPlanMode so the user can approve it.'
    ].join('\n')
  },
  {
    id: 'ask',
    name: 'Ask',
    description: 'Answers questions about your code without changing anything.',
    icon: 'MessageCircleQuestion',
    color: '#f6ad55',
    builtin: true,
    order: 3,
    readOnly: true,
    systemPrompt: [
      'You are in ASK mode: answer the user\'s question about the codebase. You cannot edit files or run commands in this mode.',
      'Ground every answer in the actual code — read the relevant files first and cite them as `path:line`.',
      'Be direct and concise. If the user asks for changes, explain what you would change and suggest switching to Agent mode.'
    ].join('\n')
  },
  {
    id: 'debug',
    name: 'Debug',
    description: 'Systematic root-cause debugging: reproduce, isolate, fix and verify.',
    icon: 'Bug',
    color: '#fc8181',
    builtin: true,
    order: 4,
    skills: ['atom:systematic-debugging'],
    systemPrompt: [
      'You are in DEBUG mode. Follow a disciplined root-cause process (use the atom:systematic-debugging skill):',
      '1. Reproduce the problem and capture the exact error/output.',
      '2. Form hypotheses ranked by likelihood and gather evidence for each (read code, add temporary logging, run targeted commands).',
      '3. Identify the root cause — not just the symptom — and explain it in one or two sentences.',
      '4. Make the minimal fix, then re-run the reproduction to prove it is fixed and check for regressions.',
      '5. Remove any temporary instrumentation. Use the IDE diagnostics tool to see compiler/linter errors the user sees.'
    ].join('\n')
  },
  {
    id: 'review',
    name: 'Review',
    description: 'Reviews your current changes for bugs, security issues and quality. Never edits.',
    icon: 'ScanSearch',
    color: '#b794f4',
    builtin: true,
    order: 5,
    disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
    skills: ['atom:code-review'],
    systemPrompt: [
      'You are in REVIEW mode. Review the user\'s changes (use `git diff`, `git diff --staged` and `git status` unless the user points at specific code). Do not modify files.',
      'Use the atom:code-review skill. Look for correctness bugs first, then security, performance, error handling, tests and readability.',
      'Report findings ranked by severity as a list: **[severity] path:line — problem → suggested fix**. Only report issues you can justify from the code; say so explicitly when everything looks good.'
    ].join('\n')
  },
  {
    id: 'tdd',
    name: 'TDD',
    description: 'Test-driven development: failing test first, then the code, then refactor.',
    icon: 'FlaskConical',
    color: '#68d391',
    builtin: true,
    order: 6,
    skills: ['atom:test-driven-development'],
    systemPrompt: [
      'You are in TDD mode. Use the atom:test-driven-development skill and follow red → green → refactor strictly:',
      '1. Find the project\'s test framework and conventions.',
      '2. Write a failing test that captures the requirement and run it to see it fail for the right reason.',
      '3. Write the minimal code to make it pass and run the tests again.',
      '4. Refactor with the tests green. Repeat for the next behaviour. Report the final test run output.'
    ].join('\n')
  }
]

export const DEFAULT_MODE_ID = 'agent'

export function getAllModes(customModes: AgentModeDefinition[] = []): AgentModeDefinition[] {
  const builtinIds = new Set(BUILTIN_MODES.map((m) => m.id))
  const custom = customModes.filter((m) => !builtinIds.has(m.id)).map((m) => ({ ...m, builtin: false }))
  return [...BUILTIN_MODES, ...custom].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

export function findMode(modeId: string, customModes: AgentModeDefinition[] = []): AgentModeDefinition {
  return getAllModes(customModes).find((m) => m.id === modeId) ?? BUILTIN_MODES[0]
}

/** Tools that never mutate the workspace. Used for read-only modes. */
export const READ_ONLY_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'TodoWrite',
  'AskUserQuestion',
  'Skill',
  'mcp__atom-ide__get_open_editors',
  'mcp__atom-ide__get_diagnostics',
  'mcp__atom-ide__get_selection',
  'mcp__atom-ide__get_terminal_output',
  'mcp__atom-ide__open_file'
]

export const PERMISSION_POLICIES: { id: PermissionPolicy; label: string; description: string; danger?: boolean }[] = [
  { id: 'default', label: 'Ask before changes', description: 'Approve every file edit and command.' },
  { id: 'acceptEdits', label: 'Auto-accept edits', description: 'File edits apply automatically; commands still ask.' },
  { id: 'auto', label: 'Auto (smart)', description: 'A safety classifier approves routine actions and asks about risky ones.' },
  {
    id: 'bypassPermissions',
    label: 'Full auto (YOLO)',
    description: 'Never ask. The agent can run any command — use only in trusted projects.',
    danger: true
  }
]

/** Shown until the CLI reports the account's real model list via supportedModels(). Values are CLI aliases. */
export const FALLBACK_MODELS: ModelOption[] = [
  {
    value: '',
    label: 'Default',
    description: 'Recommended model for your plan',
    // The default model resolves to an effort-capable model on every plan; without this the effort picker
    // stays hidden until the CLI reports the real model list (after the first message).
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']
  },
  {
    value: 'opus',
    label: 'Opus',
    description: 'Most capable Opus — complex, long-horizon coding',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']
  },
  {
    value: 'sonnet',
    label: 'Sonnet',
    description: 'Fast and smart for everyday coding',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']
  },
  {
    value: 'haiku',
    label: 'Haiku',
    description: 'Fastest — quick edits and questions',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']
  },
  {
    value: 'fable',
    label: 'Fable',
    description: "Anthropic's most capable model (may require usage credits)",
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']
  }
]

/** The CLI reports the default model as value "default"; ATOM Code stores it as ''. */
export function normalizeModelValue(value: string | undefined | null): string {
  return !value || value === 'default' ? '' : value
}

export const EFFORT_LEVELS: { id: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
  { id: 'max', label: 'Max' }
]
