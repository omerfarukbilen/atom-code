---
description: Write or update documentation - README, API reference and docstrings, guides, ADRs or changelog - grounded in the code and verified
argument-hint: "[file, module, API or doc type - e.g. README, changelog since v1.2.0, docstrings for src/billing]"
---

Write or update documentation for the target below. Follow the `atom:documentation` skill (load it with the
Skill tool; it has templates for READMEs, ADRs and changelogs and per-language docstring conventions).

Target from the user: $ARGUMENTS

## 1. Decide what to write

- **README** → what it is, why use it, quick start, configuration, development, where to go next.
- **A file, module, class or function** → docstrings / doc comments for its public surface, in the
  project's existing style (Grep a few existing docstrings first: TSDoc/JSDoc, Google/NumPy/reST, godoc,
  rustdoc).
- **An API** (HTTP routes, SDK, CLI) → reference docs: every endpoint, option or flag with types, defaults,
  errors and an example. If the project generates reference docs (OpenAPI, TypeDoc, Sphinx autodoc, rustdoc),
  improve the source annotations instead of hand-writing a copy that will drift.
- **ADR** → a decision record in the repo's ADR location (Glob for `docs/adr/`, `docs/decisions/`; number it
  after the highest existing one).
- **Changelog** → curate user-facing entries from the commits since the last release
  (`git describe --tags --abbrev=0`, then `git log --oneline <tag>..HEAD`), in Keep a Changelog format unless
  the project uses changesets or release tooling - then edit their source of truth instead.
- **Empty** → update the docs affected by the current changes: read `git diff` and `git status --short`, find
  docs that mention the changed names, flags, config keys or behaviour (Grep), and fix what is now outdated.

## 2. Gather facts from the code

Read the real code paths - exports, signatures, defaults, errors, configuration loading, CLI parsing. Collect
real values: package name, runtime versions, scripts, environment variables (Grep `process.env.`,
`os.environ`, `os.Getenv`, `std::env::var`). Document what the code does, not what an old doc or the task
description claims. If behaviour looks accidental, ask with AskUserQuestion before documenting it - documenting
it turns it into a promise.

## 3. Write

- Know the reader (new user, integrator, maintainer) and keep each document to one purpose: tutorial,
  how-to, reference or explanation.
- Lead with what the reader needs most; short sentences, active voice, concrete examples.
- Docstrings describe the contract - meaning, units, valid ranges, return value, errors, side effects - not
  what the signature already says.
- Commands are copy-pasteable, without a `$` prompt; placeholders look like `<project-id>`.
- Comments explain *why*, never restate *what*. No marketing language.
- Update or delete stale content you touch instead of adding a parallel document.

## 4. Verify

- Run every command in quick starts and how-tos exactly as written (ask before anything networked,
  stateful or slow, and list what you could not run).
- Execute or type-check code examples: `python -m doctest -v module.py` or `pytest --doctest-modules`,
  `cargo test --doc`, `go test` for `Example` functions, a scratch `.ts` file with `npx tsc --noEmit`.
- Grep that every referenced path, symbol, flag and config key exists; check relative links resolve.
- After editing docstrings in code files, check `mcp__atom-ide__get_diagnostics` - malformed doc comments can
  break type checks and doc builds.

For a large documentation effort across many files, delegate parts to the `atom:docs-writer` subagent with the
Agent tool, then run the commands it lists as unverified.

## 5. Report

List the documents and docstrings you changed (with paths), what you verified and how, anything you could not
verify, and open questions about intended behaviour.
