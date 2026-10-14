---
name: writing-skills
description: Author, improve and test agent skills for ATOM Code and Claude Code - SKILL.md anatomy and frontmatter, descriptions that trigger at the right time, progressive disclosure with reference files, templates and scripts, keeping instructions general instead of overfitted, choosing personal, project or plugin scope, and testing with realistic prompts. Use when asked to create, write, edit, review or debug a skill, turn a repeated workflow or team playbook into a skill, or when a skill does not trigger or is not followed.
---

# Writing Skills

A skill is a folder of instructions and resources that an agent loads on demand. It is the best way to
teach an agent something it would otherwise get wrong or do inconsistently: a team's release process, a
house style, a tricky toolchain, a domain checklist. A good skill reads like a briefing from a senior
colleague - short, concrete, explaining the reasons - and it is only as useful as its description, because
the description is the only part the model sees before deciding to load it.

## When to use

- The user asks to create, edit or review a skill, or to "make this repeatable".
- The same multi-step workflow or set of corrections keeps coming up in chats.
- A team has a playbook (review checklist, incident runbook, migration procedure) agents should follow.
- An existing skill does not trigger when it should, triggers when it should not, or is ignored once loaded.

## When not to use - pick the right mechanism

| Need | Use |
| --- | --- |
| Always-on project facts and rules (commands, conventions) | `ATOM.md` / `CLAUDE.md` (see `atom:project-onboarding`) |
| A prompt the *user* triggers explicitly, possibly with arguments | Slash command (`.claude/commands/<name>.md`) |
| Delegated work in an isolated context with its own tool set | Subagent (`.claude/agents/<name>.md`) |
| Something that must happen every time, deterministically (format on save, block a command) | A hook in `settings.json` - the harness runs it, not the model |
| Access to an external system's live data or actions | An MCP server |
| Know-how the *model* should pull in when a task calls for it | **A skill** |

## How skills load (why structure matters)

1. **Session start:** only each skill's `name` and `description` enter the context - for every installed skill.
2. **Trigger:** when a task matches a description, the agent invokes the Skill tool and the SKILL.md body loads.
3. **On demand:** files bundled next to SKILL.md cost nothing until the agent Reads them; scripts it runs
   with Bash contribute only their output.

So: the description must carry the triggers, SKILL.md must carry the core process, and long reference
material belongs in separate files that SKILL.md points to with a clear "Read this when...".

## Where skills live

| Scope | Path | Shared with | Name in ATOM |
| --- | --- | --- | --- |
| Personal | `~/.claude/skills/<name>/SKILL.md` (honors `CLAUDE_CONFIG_DIR`) | Only you, every project | `<name>` |
| Project (team) | `<project>/.claude/skills/<name>/SKILL.md` - commit it | Everyone who clones the repo | `<name>` |
| Plugin | `<plugin>/skills/<name>/SKILL.md` | Everyone with the plugin | `<plugin>:<name>`, e.g. `atom:code-review` |

- Personal skills load in ATOM when **Settings -> Models & Agent -> Load user settings (~/.claude)** is on
  (the default). Project skills load for that workspace.
- ATOM's bundled `atom:*` skills are read-only. To customize one, duplicate it to user scope from the Skills
  panel and edit the copy (give it a different name), then disable the original there if needed.
- Plugin skills are namespaced, so they never collide. Avoid giving a personal and a project skill the same
  name - which one wins is not something to rely on.
- Choose project scope for anything tied to one codebase, personal scope for your own habits across projects.

## Process

### 1. Collect real material first

Write a skill from evidence, not imagination. Gather: two or three real tasks the skill should help with,
what the agent did wrong or inconsistently without it, the team's actual commands, files and conventions,
and any existing docs or runbooks. If the user's request is vague, ask with AskUserQuestion what tasks it
should cover and what good output looks like.

### 2. Name it

Kebab-case, lowercase letters, digits and hyphens, at most 64 characters, identical to the directory name.
Name the activity or domain: `release-checklist`, `pdf-forms`, `django-migrations` - not `helper`, `utils`, `my-skill`.

### 3. Write the description - the trigger

The description decides whether the skill is ever used. Write it as a noun phrase or in the third person,
state **what** it does and **when** to use it, and pack in the words a user would actually say. Keep it under
about 600 characters (the hard limit is 1024) and avoid angle brackets.

```yaml
# Bad: vague, no triggers - the model cannot tell when this applies
description: Helps with documents.

# Bad: describes the skill's history instead of the task
description: Our new improved process that the platform team wrote in 2024.

# Good: capability + concrete triggers + file types + boundary
description: Fill, extract and merge PDF forms with pypdf - read field names, fill values, flatten, and
  verify output. Use when the user mentions PDF forms, fillable fields, AcroForm, or asks to populate a PDF
  from data. Not for generating PDFs from HTML.
```

More patterns, near-miss tests and fixes for over- and under-triggering:
[references/description-guide.md](references/description-guide.md).

### 4. Write the body

Start from [templates/SKILL.template.md](templates/SKILL.template.md). Principles:

- **Assume a capable reader.** Do not explain what a pull request or a unit test is; spend words on what is
  specific to this task, this team, or easy to get wrong. Once loaded, every line competes with the user's
  code for context.
- **Explain the why** behind each rule in a clause. A model that understands the reason generalizes to
  cases you did not list; one that only has a rule follows it rigidly or not at all. Prefer calm reasoning
  over ALL-CAPS and walls of MUST.
- **Give a process** - numbered steps with a checklist for multi-step work, and a definition of done the
  agent can verify (a command to run, a property to check).
- **Show, do not just tell.** Short good-vs-bad examples with real code teach faster than paragraphs.
- **Match freedom to fragility.** Judgment tasks (reviews, design) get heuristics; fragile operations
  (a release, a migration, a binary file format) get exact commands or a bundled script.
- **Offer a default, not a menu.** "Use pdfplumber; for scanned PDFs fall back to OCR" beats listing five libraries.
- **Name the real tools:** Read, Edit, Write, Grep, Glob, Bash, TodoWrite, Agent (subagents), WebFetch,
  WebSearch, AskUserQuestion, and in ATOM the `mcp__atom-ide__*` tools (diagnostics, selection, open editors,
  terminal output, open_file).
- **Stay timeless:** no "currently" or "as of this year" claims that rot; put legacy approaches in a clearly
  labeled section if they still matter.
- Keep SKILL.md roughly 100-300 lines, never more than about 500.

### 5. Push detail into bundled files

```text
release-checklist/
  SKILL.md                    # overview, when to use, process, definition of done
  references/rollback.md      # long, situational material - loaded only when needed
  templates/release-notes.md  # output the agent should fill in
  scripts/check_versions.py   # deterministic work the agent runs instead of re-deriving
```

- Link every file from SKILL.md with a relative path **and** say when to read it ("Read
  references/rollback.md if a deploy fails"). Unlinked files are effectively invisible.
- Keep references one level deep (SKILL.md -> file), not chains of files linking to files.
- Give reference files longer than about 100 lines a short table of contents at the top.
- Scripts: say whether to run or read them, handle their own errors with clear messages, list their
  dependencies, and do not assume packages are installed. Use forward slashes in paths.

Layout examples and frontmatter details: [references/skill-structure.md](references/skill-structure.md).

### 6. Keep it general, not overfitted

Test prompts are samples of the tasks the skill will meet, not the whole set. When a test fails, ask what
general principle was missing and add that - not a special case for the exact prompt, file name or repo you
tested with. Warning signs of overfitting: hard-coded paths from one project, examples that only cover the
test case, rules like "if the file is called `orders.ts`...", and steadily growing lists of exceptions.

### 7. Test with realistic prompts

1. Write 4-8 test prompts: most should trigger the skill using different phrasings (including indirect
   ones that never name it), and two or three are **near misses** that should not trigger it.
2. Get a baseline: run a couple of the tasks with the skill disabled (toggle it off in ATOM's Skills panel)
   and note what goes wrong - the skill should fix exactly those gaps.
3. Run each prompt in a fresh chat (new chat in ATOM after creating or editing the skill, so it is discovered).
   Check: did a Skill tool card with the skill's name appear? Did the agent follow the process, read the right
   reference files, produce the expected output, and run the verification?
4. Diagnose: not triggered or wrongly triggered -> fix the description; triggered but not followed -> fix the
   body (clearer steps, the reason behind the rule, an example); reference never read -> make the link and its
   "when" explicit.
5. Re-run the whole set after each change to catch regressions, then hand the skill to the user with the
   prompts you used so they can re-test later.

A full test worksheet is in [references/description-guide.md](references/description-guide.md#test-worksheet).

### 8. Create the files

Use Write to create `<scope>/skills/<name>/SKILL.md` and any bundled files (or the **New skill** button in
ATOM's Skills panel, which creates the folder from a template). Ask before writing to a project's
`.claude/skills/` - it is committed and affects the whole team.

## Common pitfalls

- **A great body behind a weak description** - it never loads. Spend real effort on the description.
- **Everything in SKILL.md** - 900 lines of reference material loaded for every use. Split it.
- **Explaining basics** the model already knows instead of the team-specific details it does not.
- **Rules without reasons** - followed rigidly where they do not fit, ignored where they matter.
- **Too many options** without a default - the agent picks randomly or asks needlessly.
- **Untested scripts** or scripts that assume a package is installed.
- **Secrets or personal data** in a committed project skill.
- **Overlapping skills** with similar descriptions - the model cannot choose; merge them or sharpen the
  boundary ("Not for X - use Y").

## Definition of done

- [ ] Directory and `name` match, kebab-case, at most 64 characters; file is `SKILL.md` with valid frontmatter.
- [ ] Description states what and when, with realistic trigger words, under ~600 characters, no angle brackets.
- [ ] Body: overview, when (and when not) to use, process, examples, pitfalls, definition of done.
- [ ] Long material moved to linked reference files, each with a "read this when".
- [ ] Bundled scripts run successfully; commands in the skill verified.
- [ ] Tested with should-trigger and near-miss prompts in fresh chats; results reported to the user.
- [ ] Placed in the right scope; project skills only written with the user's agreement.
