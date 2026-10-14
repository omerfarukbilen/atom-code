# ATOM plugin (`atom`)

The built-in Claude Code plugin that ships with ATOM Code and is loaded into every agent session. It gives
the ATOM agent a curated harness of **17 skills**, **8 subagents** and **12 slash commands**, all written for
an expert coding agent: concrete processes, checklists, real code examples across TypeScript, Python, Go and
Rust, and a verifiable definition of done.

Everything here is namespaced by the plugin name:

| Kind | Location | Exposed as | How it is used |
| --- | --- | --- | --- |
| Skill | `skills/<name>/SKILL.md` (+ bundled reference files) | `atom:<name>` | Loaded by the model on demand when a task matches the skill's description |
| Subagent | `agents/<name>.md` | `atom:<name>` | Delegated to with the Agent tool; runs in its own context with its own tools |
| Slash command | `commands/<name>.md` | `/atom:<name>` | Typed by the user in the composer (`/` menu) |

```text
resources/atom-plugin/
  .claude-plugin/plugin.json      # plugin manifest: {"name": "atom", ...}
  skills/<name>/SKILL.md          # skill entry point (frontmatter: name, description)
  skills/<name>/references/*.md   # long reference material, read only when needed
  skills/<name>/templates/*       # output skeletons the agent fills in
  agents/<name>.md                # subagent (frontmatter: name, description, tools, model)
  commands/<name>.md              # slash command (frontmatter: description, argument-hint, allowed-tools)
```

## Skills

### Plan and execute

| Skill | Use it for |
| --- | --- |
| `atom:writing-plans` | A written implementation plan before touching code - goal, success criteria, file-by-file changes, ordered steps with verification, risks. Recommended in Plan mode. |
| `atom:executing-plans` | Carrying out an approved plan step by step with TodoWrite, verifying each step and keeping the plan in sync with reality. |
| `atom:project-onboarding` | Rapidly understanding an unfamiliar codebase - entry points, verified commands, architecture and data flow map, conventions, gotchas; creating ATOM.md / CLAUDE.md. |

### Build

| Skill | Use it for |
| --- | --- |
| `atom:test-driven-development` | Red-green-refactor: one failing test, the smallest passing code, refactor under green. Recommended in TDD mode. |
| `atom:frontend-design` | Distinctive, accessible, production-grade UI - layout, type, color and contrast, dark mode, responsive design, component states. |
| `atom:api-design` | Designing or reviewing REST, RPC/gRPC and GraphQL APIs - naming, status codes, errors, pagination, idempotency, versioning, OpenAPI. |
| `atom:error-handling` | Failing fast on bugs and recovering deliberately - typed errors and result types, boundaries, retries with backoff and jitter, timeouts, idempotency, logging without secrets. |
| `atom:database-migrations` | Safe schema and data changes - expand/contract, concurrent indexes, two-step constraints, batched backfills, reversibility, ORM notes (Prisma, Drizzle, Django, Alembic, Rails). |

### Quality

| Skill | Use it for |
| --- | --- |
| `atom:systematic-debugging` | Root-cause debugging - reproduce, isolate, rank hypotheses, prove the cause, minimal fix, regression test. Recommended in Debug mode. |
| `atom:code-review` | Severity-ranked, verified review of a diff, branch or PR with path:line findings and suggested fixes. Recommended in Review mode. |
| `atom:security-audit` | Threat-model-first review - untrusted input to dangerous sinks, auth flaws, secrets, crypto misuse, vulnerable dependencies, Electron hardening. |
| `atom:performance-optimization` | Measure, profile, fix the real bottleneck (algorithms, I/O, N+1, caching, bundles, re-renders) and prove the gain with numbers. |
| `atom:refactoring` | Behaviour-preserving restructuring in small verified steps under green tests, including large migrations via parallel change and codemods. |

### Maintain and collaborate

| Skill | Use it for |
| --- | --- |
| `atom:git-workflow` | Safe Git - atomic commits, Conventional Commits, branching, rebase vs merge, conflict resolution, PR descriptions, recovery with reflog. |
| `atom:documentation` | Docs that stay true - READMEs, docstrings, ADRs, API reference, changelogs - with every command and example verified. |
| `atom:dependency-upgrades` | Safe upgrades - changelogs and migration guides, one major at a time, codemods, lockfile hygiene, peer conflicts, security patches. |
| `atom:writing-skills` | Authoring and testing new skills - SKILL.md anatomy, descriptions that trigger, progressive disclosure, scopes, realistic test prompts. |

## Subagents

The main agent delegates to these with the Agent tool. Each runs in a fresh context, so wide searches and
long reviews do not flood the main conversation, and several can run in parallel.

| Subagent | Delegate when | Edits files | Model |
| --- | --- | --- | --- |
| `atom:explorer` | You need to know where something lives or how it is wired; broad searches before planning or editing in unfamiliar code | No | haiku |
| `atom:architect` | A task needs a design decision - new module, data model, API or dependency; several approaches are plausible; the change is hard to reverse | No | inherit |
| `atom:code-reviewer` | After significant changes, before a commit or PR, or to review a large change in parallel by area | No | inherit |
| `atom:debugger` | A test fails, code crashes, behaviour is flaky, or a first fix did not work - delegate with the exact error and repro command | Yes | inherit |
| `atom:test-engineer` | A feature or fix lacks tests, tests fail after a change, a bug needs a regression test, or coverage gaps need closing | Yes (tests) | inherit |
| `atom:refactorer` | Behaviour-preserving restructuring or large mechanical changes across many call sites | Yes | inherit |
| `atom:security-auditor` | Code handles untrusted input, auth, files, shell, SQL, secrets or IPC; before a release; triaging scanner findings | No | inherit |
| `atom:docs-writer` | A feature or API change needs documentation, docs are outdated, or release notes are due | Yes (docs only) | sonnet |

## Slash commands

| Command | Arguments | What it does |
| --- | --- | --- |
| `/atom:init` | `[focus or notes]` | Analyzes the repository and creates or updates `ATOM.md` project rules with verified commands. |
| `/atom:explain` | `[file \| symbol \| path:line \| question]` | Explains code (or the current selection) - purpose, flow, key decisions, gotchas - with clickable references. |
| `/atom:plan` | `[feature or change]` | Produces a step-by-step implementation plan without editing anything. |
| `/atom:fix` | `[error \| failing test \| issue]` | Diagnoses and fixes a problem at its root cause using IDE diagnostics, then proves the fix. |
| `/atom:test` | `[behaviour, file or symbol \| run [path]]` | Writes tests test-first, adds tests to existing code, or runs and triages the suite. |
| `/atom:refactor` | `[target] [goal]` | Behaviour-preserving refactoring in small steps with typecheck and tests green after each. |
| `/atom:review` | `[path \| ref range \| branch \| PR] [--deep]` | Reviews changes for bugs, security and quality - severity-ranked path:line findings, no edits. |
| `/atom:security` | `[path \| feature \| diff \| blank for repo]` | Security audit - threat model, source-to-sink tracing, dependency audit, findings with fixes. |
| `/atom:optimize` | `[slow operation or metric]` | Profile-first performance work with before/after numbers. |
| `/atom:docs` | `[file, module, API or doc type]` | Writes or updates documentation grounded in the code and verified. |
| `/atom:commit` | `[hint]` | Groups current changes into logical Conventional Commits; asks before including unrelated files; never pushes. |
| `/atom:pr` | `[base branch] [--draft] [--create]` | Prepares a pull request title and description from the branch diff, with real test evidence. |

## How ATOM loads the plugin

1. **Location.** The plugin lives at `resources/atom-plugin` in development and is copied to
   `<app resources>/atom-plugin` in packaged builds (`extraResources` in `electron-builder.yml`). The main
   process resolves it as `ctx.pluginDir` (`src/main/context.ts`).
2. **Session options.** For every chat, `buildQueryOptions()` in `src/main/agent/options.ts` passes
   `plugins: [{ type: 'local', path: ctx.pluginDir }]` to the Agent SDK's `query()`. The Claude Code harness
   reads `.claude-plugin/plugin.json`, discovers the skills, agents and commands, and namespaces them as `atom:*`.
3. **Progressive disclosure.** Only each skill's `name` and `description` are in the model's context at the
   start. The SKILL.md body loads when the model invokes the Skill tool; bundled reference files load only
   when the agent Reads them. That is why descriptions lead with concrete triggers and long material lives
   in `references/`.
4. **Enabling and disabling.** The `skills` option is `'all'` unless the user disabled some skills in the
   Skills panel (`settings.agent.disabledSkills`), in which case ATOM passes the explicit list of enabled
   qualified names.
5. **Modes.** ATOM's system prompt tells the agent to prefer `atom:*` skills, and each mode recommends its
   skill: Plan -> `atom:writing-plans`, Debug -> `atom:systematic-debugging`, Review -> `atom:code-review`,
   TDD -> `atom:test-driven-development`.
6. **In the UI.** The Skills panel lists bundled entries under **ATOM** (read-only), next to **User** and
   **Project** entries. Plugin commands appear in the composer's `/` menu; subagent runs show as nested
   cards under the Agent tool call.

Changes to the plugin take effect in new chats (restart the app if a running build does not pick them up).

## Adding your own skills, subagents and commands

ATOM also loads the standard Claude Code locations, so anything you write works in the Claude Code CLI too:

| Scope | Skills | Subagents | Commands | Loaded when |
| --- | --- | --- | --- | --- |
| Personal | `~/.claude/skills/<name>/SKILL.md` | `~/.claude/agents/<name>.md` | `~/.claude/commands/<name>.md` | **Settings -> Models & Agent -> Load user settings (~/.claude)** is on (default). Honors `CLAUDE_CONFIG_DIR`. |
| Project | `<workspace>/.claude/skills/<name>/SKILL.md` | `<workspace>/.claude/agents/<name>.md` | `<workspace>/.claude/commands/<name>.md` | Always, for that workspace. Commit them to share with your team. |

Personal and project entries use plain names (`release-checklist`, `/deploy`), without the `atom:` prefix.
Names are kebab-case.

The quickest ways to create one:

- **Skills panel -> New skill**: choose skill, subagent or command, the scope and a name; ATOM creates the
  file from a template and opens it in the editor.
- **Duplicate** a bundled `atom:*` skill to user scope and edit the copy to fit your team.
- **Ask the agent**: "turn our release process into a skill" - it will use `atom:writing-skills`, which
  covers description writing, structure, scopes and testing (template:
  [skills/writing-skills/templates/SKILL.template.md](skills/writing-skills/templates/SKILL.template.md)).

A minimal skill:

```markdown
---
name: release-checklist
description: Acme release procedure - version bump, changelog, staging soak, production deploy and rollback. Use when cutting a release, shipping to production or preparing release notes.
---

# Release checklist

1. Confirm `main` is green in CI and the changelog has an Unreleased section.
2. Bump the version with `npm version <patch|minor|major>` ...
```

For always-on project facts (commands, conventions, gotchas) use `ATOM.md` at the workspace root instead of
a skill - run `/atom:init` to generate it. ATOM injects it into every chat's system prompt.

## Contributing to the bundled plugin

- **Skills**: directory name = `name`, kebab-case. The `description` says what the skill does and when to
  use it, leads with concrete triggers, stays under about 600 characters and contains no angle brackets.
  The body has an overview, when (and when not) to use it, a step-by-step process, examples, pitfalls and a
  definition of done - roughly 120-300 lines, with long material moved to linked `references/` or
  `templates/` files.
- **Subagents**: frontmatter `name`, `description` (when the main agent should delegate), `tools`
  (comma-separated; omit to inherit all), `model` (`inherit`, `sonnet`, `opus` or `haiku`); the body is the
  subagent's system prompt.
- **Commands**: frontmatter `description`, `argument-hint`, optional `allowed-tools`; the body is the prompt
  and may use `$ARGUMENTS`, `$1`, `$2`.
- Write for an expert agent: imperative and concrete, explain the reason behind rules, refer to real tools
  (Read, Edit, Write, Grep, Glob, Bash, TodoWrite, Agent, WebFetch, WebSearch, AskUserQuestion and the
  `mcp__atom-ide__*` IDE tools), and verify every command and flag you mention.
- Cross-reference instead of duplicating: when a topic belongs to another skill, link it by its `atom:` name
  (for example `atom:code-review` hands deep security work to `atom:security-audit`).
- Validate before committing: `node scripts/check-plugin.mjs` checks every frontmatter block, name, description
  and relative link, then loads the plugin through the Claude Agent SDK (no prompt is sent, so no model call)
  and asserts that all 17 skills, 12 commands and 8 subagents are discovered as `atom:*`. Use `--static` to
  skip the SDK step.
