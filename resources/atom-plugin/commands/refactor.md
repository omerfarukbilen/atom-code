---
description: Refactor code safely - behaviour-preserving changes in small steps with typecheck and tests green after each one
argument-hint: "[file, symbol or area] [goal, e.g. extract tax calculation into its own module]"
---

Refactor the target below without changing its behaviour. Follow the `atom:refactoring` skill (load it with
the Skill tool; `references/catalog.md` has the mechanics of each refactoring).

Target and goal from the user: $ARGUMENTS

If the target is empty, use the current selection (`mcp__atom-ide__get_selection`) or the active editor
(`mcp__atom-ide__get_open_editors`). If the goal is unclear - what should be better afterwards? - ask with
AskUserQuestion, offering two or three concrete options you see in the code (for example "extract the
validation into a function", "split the 900-line module by responsibility", "replace the switch with a lookup
table").

## 1. Agree on scope and constraints

Decide what must not change: public APIs and exported names, file locations other code or tools depend on,
serialized formats, CLI and HTTP contracts, log output that monitoring reads. Assume all of them stay unless
the user says otherwise. For a multi-file refactor, write a short plan first and track the steps in TodoWrite.

## 2. Establish a green baseline

- Run the typecheck and the tests that cover the area; record the results. Pre-existing failures are noted
  and left alone - fixing them inside a refactor mixes behaviour changes into a structural change.
- Read the tests for the code you will touch. If the behaviour you are restructuring is not covered, write
  characterization tests first that pin today's behaviour, including odd edge cases, and tell the user about
  any behaviour that looks like a bug (do not fix it here).

## 3. Refactor in small, verified steps

```
pick one refactoring → find every affected site → change → verify → next
```

- One refactoring per step: rename *or* move *or* change a signature.
- Before changing a name or signature, find every site: Grep with word boundaries across code, tests, config,
  docs, string-based lookups (reflection, DI, routing tables, templates) and re-exports. For TypeScript, let the
  compiler find the rest (`npx tsc --noEmit`).
- After each step, run the typecheck and the related tests, and check `mcp__atom-ide__get_diagnostics` for the
  touched files:

  | Stack | After each step |
  |---|---|
  | TypeScript/JS | `npx tsc --noEmit` + `npx vitest run <area>` or `npx jest <area>` |
  | Python | `ruff check` + `mypy`/`pyright` if configured + `pytest <area> -x -q` |
  | Go | `go build ./... && go vet ./...` + `go test ./<area>/...` |
  | Rust | `cargo check --all-targets` + `cargo test <area>` |

  Prefer the project's own scripts when they exist.
- If a step goes red and the cause is not obvious within a couple of minutes, undo that step with Edit and take
  a smaller one. Never use `git checkout`, `git restore` or `git stash` over files that may contain the user's
  uncommitted work.
- Watch for changes that look structural but are not: evaluation order and side effects when inlining or
  reordering, exceptions raised at a different time, `this` binding when extracting methods, mutable default
  arguments, map iteration order, changed public exports.

For large mechanical migrations across many files, delegate batches to the `atom:refactorer` subagent with the
Agent tool and verify each batch yourself.

## 4. Finish

Run the full test suite, the linter and the build. Read `git diff --stat` and the diff itself: it should contain
only the structural change, no stray formatting of unrelated code and no behaviour change.

## 5. Report

```markdown
**Goal achieved:** <what is better now>
**Steps:** <numbered list, each with the verification that passed>
**Files changed:** path — what moved or changed
**Verification:** <full suite, lint, build results>
**Public contract:** unchanged | changed: <what and why, agreed with the user>
**Noticed but not changed:** path:line — bugs or further opportunities, for a separate change
```
