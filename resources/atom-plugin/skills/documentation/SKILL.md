---
name: documentation
description: Write and maintain documentation that stays true - READMEs, docstrings and JSDoc/TSDoc, Go and Rust doc comments, code comments that explain why, Architecture Decision Records, API reference and guides, and changelogs in Keep a Changelog format - and verify that every command and example actually runs. Use when asked to document code, write or update a README, ADR, CHANGELOG or API docs, add docstrings, explain a module for other developers, or when a code change makes existing docs outdated.
---

# Documentation

Documentation is a product for a specific reader with a specific question. Bad docs answer the writer's questions
("what did I build?"); good docs answer the reader's ("how do I get this running?", "what does this function
guarantee?", "why on earth is it done this way?"). And docs that are wrong are worse than none - so the job is not
done until every example has been run.

## When to use

- Writing or updating a README, CONTRIBUTING guide, setup instructions or a docs page.
- Adding docstrings / JSDoc / TSDoc / doc comments to public APIs.
- Recording an architectural or technology decision (ADR).
- Updating CHANGELOG.md for a release or a user-visible change.
- A code change altered behavior, configuration, CLI flags or APIs that are documented somewhere.

Not for: commit messages and PR descriptions (`atom:git-workflow`), API *design* (`atom:api-design`), or explaining
code to the user in chat (just answer).

For large documentation efforts, the `atom:docs-writer` subagent can draft independent sections in parallel.

## Step 1 - Identify reader and document type

Ask: who reads this, what do they already know, and what are they trying to do? Then choose the type
(the Diataxis model) - mixing types is the most common reason docs feel confusing:

| Type | Reader's need | Form | Example |
| --- | --- | --- | --- |
| Tutorial | "Teach me" (new user) | A guided lesson with a guaranteed outcome | "Build your first plugin in 15 minutes" |
| How-to guide | "Help me do X" (has a goal) | Numbered steps for one task, assumes basics | "Configure SSO with Okta" |
| Reference | "What exactly is Y?" | Complete, precise, consistently structured, generated where possible | CLI flags, API endpoints, config keys, docstrings |
| Explanation | "Why is it like this?" | Discussion of concepts, trade-offs, history | Architecture overview, ADRs |

## Step 2 - Gather facts from the code, not from memory

- Read the actual code paths (Read, Grep) - entry points, configuration loading, CLI argument parsing, public exports.
  Document what the code does, not what the task description or an old doc claims.
- Find existing docs and conventions: Glob `**/*.md`, `docs/**`, `mkdocs.yml`, `docusaurus.config.*`, `typedoc.json`,
  `conf.py` (Sphinx). Match their tone, heading style and structure.
- Collect real values: the package name from `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod`, required
  runtime versions (`engines`, `requires-python`, `rust-version`, `go` directive), scripts (`npm run`), environment
  variables (Grep `process.env.`, `os.environ`, `os.Getenv`, `std::env::var`).
- If something is ambiguous (intended audience, whether a behavior is a supported guarantee or an accident), ask the
  user with AskUserQuestion instead of guessing - documenting accidental behavior turns it into a promise.

## Step 3 - Write it

### READMEs

A README answers, in this order: what is this, why would I use it, how do I get it running, where do I go next.
Start from [templates/readme.md](templates/readme.md).

- First paragraph: what it does and for whom, in plain words. No marketing adjectives ("blazing fast", "powerful").
- Quick start: the shortest copy-pasteable path from zero to a working result, with prerequisites and versions.
- Configuration: every environment variable/option with type, default and an example.
- Development: how to install dependencies, run tests, lint, build.
- Link out for depth instead of growing the README into a manual.

### Code comments: explain why, not what

The code already says *what* it does. Comments carry what the code cannot: intent, constraints, the reason for a
surprising choice, the link to the bug or spec.

```ts
// Bad: restates the code
// increment retries by one
retries++;

// Good: explains a non-obvious constraint
// The payment provider rate-limits per card for 60s after a decline; retrying sooner
// counts as a new attempt and can trigger fraud locks. See INC-2291.
await sleep(60_000);
```

```python
# Bad: stale and misleading after someone changed the value
TIMEOUT = 30  # 10 seconds

# Good: no duplicated fact to drift; explains the choice
TIMEOUT_S = 30  # Upstream p99 is ~12s during nightly batch jobs; 30s avoids false timeouts.
```

- Prefer making code self-explanatory (better names, extracted functions) over commenting unclear code.
- `TODO` comments include context and an owner or issue: `// TODO(#1432): remove after all clients send v2 tokens`.
- Delete commented-out code; Git remembers it.
- When you change code, update or delete the comments around it - a wrong comment is a bug.

### Docstrings and API reference

Document the **contract** of public functions, classes and modules: purpose, parameters (meaning, units, valid
ranges - not just types the signature already states), return value, errors/exceptions, side effects, thread-safety
or async behavior, and a short example for non-trivial APIs. Private helpers rarely need more than a one-liner, if
anything. Per-language conventions and full examples: [references/docstring-styles.md](references/docstring-styles.md).

```ts
/**
 * Splits text into chunks that fit the model's context budget, preferring paragraph boundaries.
 *
 * @param text - UTF-8 source text. Empty input returns an empty array.
 * @param maxTokens - Upper bound per chunk, measured with {@link countTokens}. Must be >= 16.
 * @returns Chunks in original order; concatenating them reproduces `text` exactly.
 * @throws {RangeError} If `maxTokens` is below 16.
 *
 * @example
 * const parts = chunkText(readme, 512);
 */
export function chunkText(text: string, maxTokens: number): string[] { /* ... */ }
```

Generate reference docs from source when the project has a toolchain for it (TypeDoc, Sphinx autodoc / mkdocstrings,
rustdoc, `go doc` / pkg.go.dev, OpenAPI for HTTP APIs) rather than maintaining a hand-written copy that will drift.

### Architecture Decision Records

Write an ADR when a decision is significant, costly to reverse, or likely to be questioned later: choosing a
framework or database, an auth approach, a sync protocol, a monorepo layout, a deliberate deviation from a convention.

- Use [templates/adr.md](templates/adr.md). Store as `docs/adr/NNNN-kebab-title.md` (or the repo's existing location),
  numbered sequentially - Glob for the highest existing number.
- Capture context and forces honestly, the options considered, the decision, and its consequences (good and bad).
- ADRs are immutable once accepted: to change a decision, write a new ADR that supersedes the old one and update the
  old one's status line only.

### Changelogs

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) unless the project uses generated changelogs
(release-please, changesets, semantic-release - then edit the source of truth, e.g. a changeset file, not the
generated output). Template: [templates/changelog.md](templates/changelog.md).

- Written for users, not developers: describe the effect ("Exports no longer drop rows with emoji"), not the
  implementation ("refactor CSV encoder").
- An `## [Unreleased]` section at the top collects changes; releases get `## [1.4.0] - 2026-03-04` (ISO dates).
- Group under `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`. Breaking changes go first and are
  marked clearly, with migration steps.
- Do not paste the git log; curate.

## Step 4 - Verify (non-negotiable)

Docs rot silently; verification is what keeps them honest.

1. **Run every command** in the quick start and how-to steps exactly as written, in a clean state when possible
   (Bash). If a command needs network, credentials or installs you are not allowed to run, say which ones were not
   verified.
2. **Execute code examples**: copy them into a scratch file and run them, or use doc-testing tools:
   - Python: `python -m doctest -v module.py`, `pytest --doctest-modules`
   - Rust: `cargo test --doc` (code blocks in `///` comments compile and run by default)
   - Go: `Example*` functions in `_test.go` files are compiled by `go test` and executed when they end with an
     `// Output:` comment, which is then checked
   - TypeScript/JavaScript: type-check snippets by placing them in a scratch `.ts` file and running `npx tsc --noEmit`
3. **Check references**: file paths, function names, config keys and flags mentioned in docs still exist (Grep for
   each). Check links: `npx markdown-link-check README.md` or `lychee .` if installed.
4. **Lint** Markdown if the project does: `npx markdownlint-cli2 "**/*.md"`.
5. **Check diagnostics** after editing docstrings in code files (`mcp__atom-ide__get_diagnostics`) - malformed JSDoc
   or doc comments can break type checks or doc builds.
6. **Re-read as the target reader**: could a newcomer follow it without asking you anything?

## Writing style

- Lead with the most important information; keep paragraphs short; use lists for steps and options.
- Second person and imperative for instructions ("Run", "Set"), present tense for behavior ("returns", not "will return").
- Concrete over abstract: real values, real output, real file names.
- Specify languages on fenced code blocks; show expected output where it helps confirm success.
- Define a term once and use it consistently; avoid "simply", "just", "obviously" - they are not true for the
  reader who is stuck.
- Keep docs next to the code they describe (module README, docstrings, `docs/` in the same repo) and update them in
  the same change as the code.

## Common pitfalls

- Documenting from memory or from the task description instead of the current code.
- Untested quick starts (missing a step like copying `.env.example` or running migrations).
- Version-specific instructions without stating the version.
- Comments that narrate the code line by line; docstrings that repeat the type signature and nothing else.
- README sprawl: everything in one file with no navigation; or the opposite, a README with only a title.
- Changelog entries written for developers ("bump deps", "refactor") with no user impact stated.
- Rewriting an accepted ADR instead of superseding it.
- Including secrets, internal hostnames or personal data in examples - use obvious placeholders (`YOUR_API_KEY`,
  `example.com`).

## Definition of done

- [ ] Reader and doc type identified; structure fits the type.
- [ ] Content verified against current code: names, paths, flags, defaults, versions.
- [ ] Every command and code example was run (or explicitly flagged as unverified with the reason).
- [ ] Links and references resolve; Markdown lint passes if configured.
- [ ] Comments explain why; docstrings state the contract; no stale or commented-out code left behind.
- [ ] ADRs/changelog follow their templates; changelog entries describe user impact.
- [ ] Docs changed in the same change as the code they describe.
