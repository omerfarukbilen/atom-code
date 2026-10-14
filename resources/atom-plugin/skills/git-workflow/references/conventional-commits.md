# Conventional Commits reference

Specification: https://www.conventionalcommits.org/en/v1.0.0/

The format exists so humans can scan history and tools (semantic-release, release-please, changesets, git-cliff)
can derive version bumps and changelogs automatically. A `feat` triggers a minor bump, a `fix` a patch, and a
breaking change a major bump.

```
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

## Types

| Type | Use for | Version bump |
| --- | --- | --- |
| `feat` | A new user-facing capability | minor |
| `fix` | A bug fix in behavior users can observe | patch |
| `perf` | A change whose purpose is speed or resource use, behavior unchanged | patch (most tools) |
| `refactor` | Restructuring with no behavior change and no bug fix | none |
| `test` | Adding or fixing tests only | none |
| `docs` | Documentation only (README, comments, docstrings, docs site) | none |
| `style` | Formatting, whitespace, semicolons - no code meaning change | none |
| `build` | Build system, packaging, dependencies (`package.json`, `Cargo.toml`, Dockerfile) | none |
| `ci` | CI configuration and scripts (`.github/workflows`, `.gitlab-ci.yml`) | none |
| `chore` | Maintenance that fits nowhere else (tooling config, repo housekeeping) | none |
| `revert` | Reverting a previous commit | depends |

When a commit seems to need two types, it is usually two commits.

## Scope

A noun naming the area of the codebase, in parentheses: `feat(parser):`, `fix(auth):`, `build(deps):`. Use the
scopes the project already uses (check `git log` and `commitlint.config.*` for `scope-enum`). Omit the scope
rather than inventing a vague one like `(misc)` or `(code)`.

## Description (subject line)

- Imperative mood, as if completing "If applied, this commit will ...": `add`, `remove`, `handle`, not `added`,
  `removes`, `handling`.
- Lower case after the colon (unless the project capitalizes), no trailing period.
- Aim for <= 50 characters; hard limit 72 including the type prefix.
- Say what changes in behavior, not which file was edited.

## Body

Separate from the subject by one blank line. Explain **why** the change was needed and any non-obvious **how**:
the root cause of a bug, the constraint that forced a design, the alternative you rejected. The diff already shows
*what* changed line by line. Wrap at about 72 columns.

## Footers

`Token: value` or `Token #value` lines after a blank line:

- `BREAKING CHANGE: <what breaks and how to migrate>` (must be upper case; `BREAKING-CHANGE` is a synonym)
- `Refs: #123`, `Closes: #123`, `Fixes #123` (GitHub also auto-closes issues from `Fixes #123` / `Closes #123`)
- `Co-authored-by: Name <email>`
- `Reviewed-by: Name <email>`

## Breaking changes

Either append `!` before the colon, add a `BREAKING CHANGE:` footer, or both (both is clearest):

```
feat(api)!: require API version header on all requests

Requests without `Api-Version` previously defaulted to v1, which hid
client misconfiguration and blocked removing v1 handlers.

BREAKING CHANGE: clients must send `Api-Version: 2024-06-01` or newer.
Requests without the header now receive 400 with a problem+json body.
```

## Examples

### Good

```
feat(editor): add multi-cursor support for column selection
```

```
fix(sync): retry upload when the server returns 503

The storage gateway sheds load with 503 during deploys. We treated it as
fatal and dropped the user's changes. Retry with exponential backoff
(max 5 attempts, 30 s cap) and surface an error only after the last try.

Fixes #918
```

```
perf(search): index file paths in a trie instead of scanning the list

Fuzzy file search scanned all 120k paths on every keystroke (~45 ms).
The trie narrows candidates by prefix first; p95 is now ~4 ms on the
same workspace.
```

```
refactor(billing): extract invoice total calculation into pure function
```

```
build(deps): bump express from 4.19.2 to 4.21.0
```

```
test(auth): cover expired refresh token path
```

```
docs(readme): document required Node version and setup steps
```

```
ci: cache pnpm store between workflow runs
```

```
revert: feat(editor): add multi-cursor support for column selection

This reverts commit 3f2a9c1. It broke undo grouping (#1022).
```

### Bad, and how to fix

| Bad | Problem | Better |
| --- | --- | --- |
| `WIP` | Says nothing; never merge WIP commits | Squash into the real commit with `--fixup` + autosquash |
| `feat: stuff for login` | Vague | `feat(auth): add "remember me" option to login form` |
| `fix: Fixed the bug.` | Past tense, capitalized, period, no info | `fix(cart): keep quantity when item is re-added` |
| `chore: refactor user service and fix email bug and add tests` | Three changes in one | Split: `refactor(user): ...`, `fix(user): ...`, `test(user): ...` |
| `feat(UserService.ts): update` | Scope is a file name, description empty of meaning | `feat(user): send welcome email after signup` |
| `fix: update dependency` | Wrong type | `build(deps): bump lodash to 4.17.21 (CVE-2021-23337)` |

## Non-Conventional repositories

If `git log` shows another convention, follow it:

- Linux-kernel/Git style: `subsystem: short summary` (e.g. `net: fix refcount leak in tcp_connect`).
- Gitmoji: emoji prefix per type - only if the project already uses it.
- Ticket prefixes: `ABC-123: Handle empty cart on checkout`.
- Plain imperative sentences: `Add CSV export to reports page`.

The universal parts - imperative summary, short subject, body explaining why - apply everywhere.
