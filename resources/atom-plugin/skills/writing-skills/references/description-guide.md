# Writing descriptions that trigger correctly

Contents: anatomy of a description - patterns by skill type - fixing under- and over-triggering - YAML
gotchas - test worksheet.

At session start the model sees a list of every installed skill's name and description, and nothing else.
When a request arrives, it decides from that list alone whether to load a skill. A description therefore has
two jobs: make the skill obviously relevant for the tasks it covers, and obviously irrelevant for the
tasks it does not.

## Anatomy

```text
[What it does: the main actions + domain] - [notable specifics it covers].
Use when [user requests, phrased as users phrase them], [signals in code: file types, tools, error messages].
[Optional boundary: Not for X - use Y.]
```

- **Lead with the capability**, in the third person or as a noun phrase ("Generates...", "Root-cause
  debugging loop..."). Avoid "I can help" or "You can use this" - the text is inserted into a system prompt.
- **Use the user's vocabulary.** Users say "my test is flaky", "bump React", "the build is slow" - not
  "nondeterministic verification artifacts". Include synonyms: update / upgrade / bump.
- **Include concrete signals**: file extensions (`.pdf`, `.xlsx`), tool names (Prisma, Terraform), error
  strings (`ERESOLVE`, `ModuleNotFoundError`), commands (`npm audit`).
- **State a boundary** when a neighboring skill exists, so the model can choose between them.
- **Keep it tight:** under about 600 characters reads well in a long list; 1024 is the hard limit.

## Patterns by skill type

| Skill type | Pattern | Example |
| --- | --- | --- |
| Workflow / process | Process summary + situations | "Red-green-refactor workflow ... Use when implementing a feature or bug fix with clear expected behaviour, or when the user asks for TDD." |
| Tool / format | Actions on the artifact + file types + library | "Read, fill and merge PDF forms with pypdf ... Use when the user mentions PDF forms, fillable fields or AcroForm." |
| Domain checklist | Review scope + triggers | "Security review of code or a diff ... Use when asked for a security audit, before releasing code that handles user input, auth or payments." |
| Team playbook | Team process + the words the team uses | "Acme release procedure - version bump, changelog, staging soak, production deploy and rollback. Use when cutting a release, shipping to prod or preparing release notes." |
| Codebase-specific | Area + typical tasks | "How to add a new payment provider to the billing service - adapter interface, config, webhooks, tests. Use when integrating a payment provider or touching services/billing." |

## Bad to good

```yaml
# Too vague - matches nothing specifically, so it rarely loads
description: Helps with testing.
# Better
description: Write and fix pytest tests for the Django apps in this repo - factories, fixtures, database
  access, mocking external APIs with responses. Use when adding tests, a test fails, or coverage is requested.

# Only says what, never when
description: Comprehensive guide to our logging library.
# Better
description: Structured logging with the internal applog library - logger setup, fields, levels, redaction
  of secrets. Use when adding log statements, debugging missing logs, or reviewing code that logs user data.

# Overlaps with a neighbor - two skills compete for every review request
description: Reviews code.
# Better (with a boundary)
description: Accessibility review of React components - semantics, keyboard, focus, ARIA, contrast. Use when
  building or reviewing UI for accessibility or WCAG compliance. Not for general code review.
```

## Diagnosing triggering problems

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Never loads | Description is abstract or uses words users do not say | Add concrete trigger phrases, file types, error strings |
| Loads only when named explicitly | Triggers describe the skill, not the task | Rewrite "Use when..." from the user's side of the conversation |
| Loads for unrelated tasks | Description too broad ("code", "files", "help") | Narrow the domain; add "Not for..." |
| Another skill loads instead | Overlapping descriptions | Sharpen both boundaries, or merge the skills |
| Loads but steps are skipped | Body problem, not description | Clearer numbered steps, reasons, a definition of done |
| Loads, but a reference file is never read | Link has no "when" | "Read references/x.md before doing Y" |

## YAML gotchas in frontmatter

- A plain (unquoted) value must not contain `: ` (colon followed by a space) or ` #` (space then hash) - strict
  YAML parsers treat them as a nested key or a comment. Rephrase, or quote the whole value with double quotes.
- Do not start a plain value with a special character: `- `, `[`, `{`, `>`, `|`, `*`, `&`, `!`, `%`, `@`, a backtick, or a quote you do not close.
- Long descriptions can wrap onto indented continuation lines or use `>`; keep `name` on one line.
- No angle brackets in the description; some loaders reject them.
- The frontmatter must be the first thing in the file, between two `---` lines.

## Test worksheet

Copy into the chat or a scratch file and fill it in while testing.

```markdown
Skill: <name>          Version / date tested: <...>

| # | Prompt (realistic phrasing) | Should trigger? | Triggered? | Followed process? | Notes / fix |
|---|---|---|---|---|---|
| 1 | "the checkout test keeps failing on CI but passes locally" | yes | | | |
| 2 | "can you bump all our deps?" | yes | | | |
| 3 | indirect phrasing that never names the topic | yes | | | |
| 4 | request in a different but valid context (other language/framework) | yes | | | |
| 5 | near miss: similar words, different task | no | | | |
| 6 | near miss: neighbor skill's territory | no | | | |

Baseline without the skill (what went wrong): <...>
Changes made after this round: <...>
```

Good test prompts look like real messages: specific, sometimes messy, with context ("in the billing service",
"after upgrading to Node 22"). Prompts that name the skill only test whether the model can read; they say
nothing about triggering.
