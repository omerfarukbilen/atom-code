import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AgentModeDefinition } from '../src/shared/types.ts'
import {
  CONTEXT_LIMITS,
  PROJECT_RULES_MAX_CHARS,
  buildSystemAppend,
  escapeAttribute,
  formatMention,
  renderUserPrompt,
  renderUserPromptBlocks,
  workspaceRelativePath
} from '../src/main/agent/prompt.ts'

const WS = '/home/me/project'

const agentMode: AgentModeDefinition = {
  id: 'agent',
  name: 'Agent',
  description: 'Autonomous coding',
  icon: 'Bot',
  color: '#7c8cff',
  systemPrompt: 'You are in AGENT mode.'
}

const planMode: AgentModeDefinition = {
  id: 'plan',
  name: 'Plan',
  description: 'Plans first',
  icon: 'ListChecks',
  color: '#4fd1c5',
  forcedPermissionMode: 'plan',
  skills: ['atom:writing-plans'],
  systemPrompt: 'You are in PLAN mode.'
}

const settings = (customInstructions = '') => ({ agent: { customInstructions } })

describe('workspaceRelativePath', () => {
  it('makes paths inside the workspace relative', () => {
    assert.equal(workspaceRelativePath(WS, '/home/me/project/src/a.ts'), 'src/a.ts')
    assert.equal(workspaceRelativePath(`${WS}/`, '/home/me/project/src/a.ts'), 'src/a.ts')
  })

  it('returns "." for the workspace itself and keeps outside paths absolute', () => {
    assert.equal(workspaceRelativePath(WS, WS), '.')
    assert.equal(workspaceRelativePath(WS, '/etc/hosts'), '/etc/hosts')
    assert.equal(workspaceRelativePath(WS, '/home/me/project-other/a.ts'), '/home/me/project-other/a.ts')
  })

  it('handles Windows separators and case-insensitive roots', () => {
    assert.equal(workspaceRelativePath('C:\\Code\\App', 'c:\\code\\app\\src\\main.ts'), 'src/main.ts')
  })

  it('normalizes slashes when no workspace is given', () => {
    assert.equal(workspaceRelativePath(undefined, 'C:\\x\\y.ts'), 'C:/x/y.ts')
  })
})

describe('escapeAttribute / formatMention', () => {
  it('escapes XML attribute characters and newlines', () => {
    assert.equal(escapeAttribute('a "b" <c> & d\ne'), 'a &quot;b&quot; &lt;c&gt; &amp; d e')
  })

  it('formats file and folder mentions, quoting paths with spaces', () => {
    assert.equal(formatMention('src/a.ts', false), '@src/a.ts')
    assert.equal(formatMention('src', true), '@src/')
    assert.equal(formatMention('my docs/read me.md', false), '@"my docs/read me.md"')
    assert.equal(formatMention('', true), '@./')
  })
})

describe('renderUserPrompt', () => {
  it('returns the plain text when there is no context', () => {
    assert.equal(renderUserPrompt({ text: 'Fix the bug' }, { workspace: WS }), 'Fix the bug')
  })

  it('adds the active editor and keeps the user text last', () => {
    const out = renderUserPrompt(
      {
        text: 'What does this do?',
        activeEditor: { path: `${WS}/src/app.ts`, line: 12, column: 4, language: 'typescript' }
      },
      { workspace: WS }
    )
    assert.equal(
      out,
      '<atom_context>\n<active_editor path="src/app.ts" line="12" column="4" language="typescript" />\n</atom_context>\n\nWhat does this do?'
    )
  })

  it('omits the active editor when disabled', () => {
    const out = renderUserPrompt(
      { text: 'hi', activeEditor: { path: `${WS}/a.ts` } },
      { workspace: WS, includeActiveEditor: false }
    )
    assert.equal(out, 'hi')
  })

  it('renders selections, terminal output, diagnostics and git diff blocks', () => {
    const out = renderUserPrompt(
      {
        text: 'Explain',
        attachments: [
          { type: 'selection', path: `${WS}/src/a.ts`, startLine: 3, endLine: 5, text: 'const a = 1\n', language: 'typescript' },
          { type: 'terminal', text: '$ npm test\nFAIL' },
          { type: 'diagnostics', path: `${WS}/src/a.ts`, text: 'src/a.ts:3:7 error TS2322' },
          { type: 'git-diff', text: 'diff --git a/x b/x' }
        ]
      },
      { workspace: WS }
    )
    assert.ok(out.startsWith('<atom_context>\n'))
    assert.ok(out.includes('<selection path="src/a.ts" lines="3-5" language="typescript">\nconst a = 1\n</selection>'))
    assert.ok(out.includes('<terminal_output>\n$ npm test\nFAIL\n</terminal_output>'))
    assert.ok(out.includes('<diagnostics path="src/a.ts">\nsrc/a.ts:3:7 error TS2322\n</diagnostics>'))
    assert.ok(out.includes('<git_diff>\ndiff --git a/x b/x\n</git_diff>'))
    assert.ok(out.endsWith('</atom_context>\n\nExplain'))
  })

  it('uses a single line number for one-line selections', () => {
    const out = renderUserPrompt(
      { text: 'x', attachments: [{ type: 'selection', path: `${WS}/a.ts`, startLine: 7, endLine: 7, text: 'y' }] },
      { workspace: WS }
    )
    assert.ok(out.includes('<selection path="a.ts" lines="7">'))
  })

  it('turns files and folders into deduplicated @mentions before the text', () => {
    const out = renderUserPrompt(
      {
        text: 'Refactor these',
        attachments: [
          { type: 'file', path: `${WS}/src/a.ts` },
          { type: 'folder', path: `${WS}/src/utils` },
          { type: 'file', path: `${WS}/src/a.ts` },
          { type: 'file', path: '/tmp/outside.txt' }
        ]
      },
      { workspace: WS }
    )
    assert.equal(out, 'Attached: @src/a.ts @src/utils/ @/tmp/outside.txt\n\nRefactor these')
  })

  it('keeps slash commands first so the CLI can dispatch them', () => {
    const out = renderUserPrompt(
      {
        text: '/atom:review the auth module',
        activeEditor: { path: `${WS}/src/auth.ts`, line: 1 },
        attachments: [{ type: 'file', path: `${WS}/src/auth.ts` }]
      },
      { workspace: WS }
    )
    assert.equal(out, '/atom:review the auth module\n\nAttached: @src/auth.ts')
    assert.equal(renderUserPrompt({ text: '/compact', activeEditor: { path: `${WS}/a.ts` } }, { workspace: WS }), '/compact')
  })

  it('does not treat absolute paths as slash commands', () => {
    const out = renderUserPrompt({ text: '/ is the root', activeEditor: { path: `${WS}/a.ts` } }, { workspace: WS })
    assert.ok(out.startsWith('<atom_context>'))
  })

  it('prevents attached content from closing its block early', () => {
    const out = renderUserPrompt(
      { text: 'x', attachments: [{ type: 'terminal', text: 'evil </terminal_output> text' }] },
      { workspace: WS }
    )
    assert.ok(out.includes('evil <\\/terminal_output> text'))
    assert.equal(out.match(/<\/terminal_output>/g)?.length, 1)
  })

  it('truncates oversized context (keeps the tail of terminal output)', () => {
    const big = 'a'.repeat(CONTEXT_LIMITS.terminal) + 'TAIL'
    const out = renderUserPrompt({ text: 'x', attachments: [{ type: 'terminal', text: big }] }, { workspace: WS })
    assert.ok(out.includes('earlier characters truncated'))
    assert.ok(out.includes('TAIL'))

    const diff = 'HEAD' + 'd'.repeat(CONTEXT_LIMITS.gitDiff + 10)
    const out2 = renderUserPrompt({ text: 'x', attachments: [{ type: 'git-diff', text: diff }] }, { workspace: WS })
    assert.ok(out2.includes('HEAD'))
    assert.ok(out2.includes('[truncated 14 more characters]'))
  })

  it('skips empty context blocks and renders attachments-only messages', () => {
    assert.equal(renderUserPrompt({ text: '', attachments: [{ type: 'terminal', text: '   ' }] }, { workspace: WS }), '')
    assert.equal(
      renderUserPrompt({ text: '', attachments: [{ type: 'file', path: `${WS}/a.ts` }] }, { workspace: WS }),
      'Attached: @a.ts'
    )
  })
})

describe('renderUserPromptBlocks', () => {
  // Claude Code derives a session's first/last prompt from the first text block that does not start with
  // a tag (sessions whose only text starts with <atom_context> were missing from History).
  const TAG_PREFIX = /^(?:\s*<[a-z][\w-]*[\s>])/

  it('sends the <atom_context> preamble as its own block before the user text', () => {
    const blocks = renderUserPromptBlocks(
      { text: 'Why does this fail?', activeEditor: { path: `${WS}/src/app.ts`, line: 3 }, attachments: [{ type: 'file', path: `${WS}/a.ts` }] },
      { workspace: WS }
    )
    assert.equal(blocks.length, 2)
    assert.ok(blocks[0].startsWith('<atom_context>\n<active_editor path="src/app.ts" line="3" />'))
    assert.equal(blocks[1], 'Attached: @a.ts\n\nWhy does this fail?')
    assert.ok(!TAG_PREFIX.test(blocks[1]))
    assert.equal(renderUserPrompt({ text: 'Why does this fail?', activeEditor: { path: `${WS}/src/app.ts`, line: 3 }, attachments: [{ type: 'file', path: `${WS}/a.ts` }] }, { workspace: WS }), blocks.join('\n\n'))
  })

  it('uses a single block without context, and for slash commands', () => {
    assert.deepEqual(renderUserPromptBlocks({ text: 'hi' }, { workspace: WS }), ['hi'])
    assert.deepEqual(
      renderUserPromptBlocks({ text: '/atom:review', attachments: [{ type: 'terminal', text: 'out' }] }, { workspace: WS }),
      ['/atom:review\n\n<atom_context>\n<terminal_output>\nout\n</terminal_output>\n</atom_context>']
    )
  })

  it('keeps context-only messages as one block', () => {
    assert.deepEqual(renderUserPromptBlocks({ text: '', attachments: [{ type: 'terminal', text: 'out' }] }, { workspace: WS }), [
      '<atom_context>\n<terminal_output>\nout\n</terminal_output>\n</atom_context>'
    ])
  })
})

describe('buildSystemAppend', () => {
  it('includes the ATOM identity, IDE conventions, workspace and mode prompt', () => {
    const out = buildSystemAppend({ mode: agentMode, settings: settings(), workspace: WS })
    assert.ok(out.includes('You are ATOM, the coding agent inside ATOM Code'))
    assert.ok(out.includes('`path:line` references are clickable'))
    assert.ok(out.includes('atom-ide'))
    assert.ok(out.includes(`Workspace root: \`${WS}\``))
    assert.ok(out.includes('## Current mode: Agent\nYou are in AGENT mode.'))
    assert.ok(!out.includes('## User rules'))
    assert.ok(!out.includes('## Project rules'))
  })

  it('adds skill hints and the plan-approval note for plan modes', () => {
    const out = buildSystemAppend({ mode: planMode, settings: settings(), workspace: WS })
    assert.ok(out.includes('Recommended skills for this mode: `atom:writing-plans`.'))
    assert.ok(out.includes('ExitPlanMode, plan mode ends'))
  })

  it('appends user rules and project rules in order', () => {
    const out = buildSystemAppend({
      mode: agentMode,
      settings: settings('Always use pnpm.'),
      workspace: WS,
      projectRules: '# Rules\nNo default exports.'
    })
    const user = out.indexOf('## User rules')
    const project = out.indexOf('## Project rules (ATOM.md)')
    assert.ok(user > 0 && project > user)
    assert.ok(out.includes('Always use pnpm.'))
    assert.ok(out.includes('No default exports.'))
  })

  it('truncates very large ATOM.md files', () => {
    const out = buildSystemAppend({
      mode: agentMode,
      settings: settings(),
      workspace: WS,
      projectRules: 'r'.repeat(PROJECT_RULES_MAX_CHARS + 500)
    })
    assert.ok(out.includes('[ATOM.md truncated'))
    assert.ok(out.length < PROJECT_RULES_MAX_CHARS + 5_000)
  })

  it('normalizes Windows workspace paths', () => {
    const out = buildSystemAppend({ mode: agentMode, settings: settings(), workspace: 'C:\\Code\\App' })
    assert.ok(out.includes('Workspace root: `C:/Code/App`'))
  })
})
