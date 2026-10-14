# Skill structure reference

Contents: frontmatter fields - layout examples - writing reference files - writing scripts - companion
commands and subagents - managing skills in ATOM - security.

## Frontmatter

```yaml
---
name: release-checklist          # required: kebab-case, = directory name, max 64 chars
description: ...                 # required: what + when, max 1024 chars (aim for under ~600), no angle brackets
allowed-tools: Read, Grep, Bash  # optional (Claude Code): tool list scoped to this skill - check current docs for exact semantics
---
```

`name` and `description` are the portable core that every loader understands. Claude Code supports
additional optional fields that vary by version; if you need one, confirm it in the current Claude Code
skills documentation (WebSearch "Claude Code skills frontmatter") rather than guessing - unknown keys are
generally ignored, so a typo fails silently.

## Layout examples

A process skill with a checklist and a template:

```text
code-review/
  SKILL.md                  # rubric, process, report format
  references/checklist.md   # long per-category checklist, read during the review
```

A tool skill with deterministic helpers:

```text
pdf-forms/
  SKILL.md
  scripts/list_fields.py    # prints form field names and types as JSON
  scripts/fill_form.py      # fills fields from a JSON file, writes output.pdf
  references/troubleshooting.md
```

A team skill tied to one repository (lives in `<repo>/.claude/skills/`):

```text
billing-providers/
  SKILL.md                  # how to add a provider: interface, config, webhooks, tests
  templates/provider.ts     # skeleton adapter to copy
  references/webhooks.md    # signature verification details per provider
```

## Writing reference files

- One topic per file, named for the topic (`rollback.md`, `postgres-locks.md`), not `notes.md` or `misc.md`.
- Start files longer than about 100 lines with a one-line table of contents so a partial read still shows
  what is there.
- Link each file from SKILL.md with the situation that calls for it. Avoid files that link onward to more
  files - deep chains get partially read.
- Templates should be valid, fillable skeletons with obvious placeholders (`<project name>`), plus HTML
  comments explaining non-obvious sections.

## Writing scripts

Scripts are worth it when the agent would otherwise re-derive the same fiddly code each time, or when
exactness matters (binary formats, validation, API calls with strict schemas).

- Say in SKILL.md whether to **run** the script (most common - only its output enters the context) or
  **read** it as a reference.
- Reference scripts by their path relative to the skill directory; the agent resolves it from the skill's
  base directory, which the harness reports when the skill loads.
- Handle errors inside the script with clear messages and non-zero exit codes; do not leave the agent to
  interpret a raw stack trace.
- Document dependencies and check for them (`python3 -c "import pypdf"`); never assume they are installed,
  and ask before installing packages.
- Prefer the standard library; make scripts non-interactive (no prompts, no TTY assumptions - the Bash tool
  has no TTY); accept arguments instead of editing constants.
- Print machine-readable output (JSON) when the agent needs to act on it.

```python
#!/usr/bin/env python3
"""List the fillable fields of a PDF as JSON. Usage: list_fields.py <file.pdf>"""
import json
import sys

try:
    from pypdf import PdfReader
except ImportError:
    sys.exit("pypdf is not installed. Ask the user before running: pip install pypdf")

if len(sys.argv) != 2:
    sys.exit(__doc__)

fields = PdfReader(sys.argv[1]).get_fields() or {}
print(json.dumps({name: str(f.get("/FT", "")) for name, f in fields.items()}, indent=2))
```

## Companion commands and subagents

Skills pair well with the other two extension points:

- A **slash command** (`.claude/commands/<name>.md`, frontmatter `description`, `argument-hint`, optional
  `allowed-tools`; body uses `$ARGUMENTS` or `$1`, `$2`) gives the user a one-word way to start the workflow
  - its body can simply say "Use the <skill> skill to ...".
- A **subagent** (`.claude/agents/<name>.md`, frontmatter `name`, `description`, `tools`, `model`; the body
  is its system prompt) runs a skill's process in an isolated context - useful for wide searches or long
  reviews whose raw output would flood the main conversation.

## Managing skills in ATOM

- **Skills panel** (activity bar): browse skills, subagents and commands grouped by scope (ATOM, User,
  Project), search, enable or disable each skill, open its SKILL.md in the editor.
- **New skill**: pick scope and name; ATOM creates the folder from a template and opens it.
- **Duplicate** a bundled `atom:*` skill into user scope to customize it; bundled skills are read-only.
- **Disable** a skill to exclude it from new chats - handy for a baseline test run.
- New or edited skills are picked up by new chats; start one after changing a skill.

## Security

Skills can instruct the agent to run commands and can ship scripts. Only install skills from sources you
trust, read bundled scripts before running them, and never put credentials, tokens or personal data into a
skill - project skills are committed and shared.
