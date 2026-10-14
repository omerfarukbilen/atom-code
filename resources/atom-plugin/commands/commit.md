---
description: Group the current changes into logical commits with Conventional Commit messages - asks before including unrelated files, never pushes
argument-hint: "[optional hint - e.g. single, a scope, or what the change is about]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git add:*), Bash(git commit:*), Bash(git restore --staged:*)
disable-model-invocation: true
---

Turn the current changes into clean, logical commits. Follow the `atom:git-workflow` skill (load it with the
Skill tool; its `references/conventional-commits.md` has the full type list and examples).

Hint from the user: $ARGUMENTS

The hint may be `single` (make exactly one commit), a scope (`auth`), or a description of the change to use
when writing messages. Without a hint, decide the grouping yourself.

## 1. Inspect (read-only, run in parallel)

```bash
git status --short --branch
git diff --staged --stat
git diff --stat
git log --oneline -n 15
```

- Nothing to commit → say so and stop.
- A merge, rebase, cherry-pick or bisect is in progress (status says so) → stop and tell the user; committing in
  the middle of one is rarely what they want.
- Learn the repository's message style from the log. Use Conventional Commits unless the history clearly uses
  another convention; then match it.

Read the actual diffs (`git diff --staged`, `git diff`, and Read untracked files). Messages must describe what
the code changes do, not what the task was.

## 2. Safety scan before staging

Look for things that should not be committed and do not stage them without asking:

- Secrets: `.env` files, private keys, tokens, credentials in config (show only a redacted prefix if you mention one).
- Build output, dependencies and caches: `dist/`, `build/`, `node_modules/`, `__pycache__/`, `target/`, coverage reports.
- Large binaries, logs, editor and OS files (`.DS_Store`, `.idea/`).
- Leftover debugging (`console.log`, `print(`, `dbg!`, `debugger;`), conflict markers (`<<<<<<<`), focused or
  skipped tests (`.only`, `.skip`).

If `.gitignore` is missing an obvious entry, suggest the addition - do not change it without approval.

## 3. Plan the commits

Group changes into commits that each do **one** thing and leave the project working: a feature with its tests,
a bug fix with its regression test, a refactor, a dependency bump, docs. Respect what the user already staged:
treat the staged set as an intended commit unless it clearly mixes unrelated work (then ask).

Ask with AskUserQuestion before committing when:

- you plan more than one commit (show each commit's message and files), or
- any file looks unrelated to the rest, questionable (see the safety scan), or you cannot tell why it changed.

For a single obvious commit, proceed without asking. A file whose hunks belong to two different commits cannot
be split non-interactively with confidence - put it in the commit it mostly belongs to and mention that.

## 4. Write the messages

```
<type>(<optional scope>): <imperative summary, lower case, no trailing period, at most 72 chars>

<body: why the change was needed and the approach, wrapped at about 72 columns - skip for trivial changes>

<footers: BREAKING CHANGE: ..., Refs: #123>
```

Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `style`, `revert`. Mark breaking
changes with `!` after the type or scope and a `BREAKING CHANGE:` footer explaining the migration.

| Bad | Good |
| --- | --- |
| `fixed stuff` | `fix(auth): refresh the token before it expires` |
| `feat: Added export button.` | `feat(reports): add CSV export button` |
| `update user.ts` | `refactor(user): extract address validation` |

## 5. Commit

For each planned commit, stage explicit paths and commit with a heredoc so newlines and quotes survive:

```bash
git add -- src/auth/refresh.ts tests/auth/refresh.test.ts
git commit -F - <<'EOF'
fix(auth): refresh the token before it expires

Requests made in the last minute of a token's lifetime failed with 401
because the refresh only ran after expiry. Refresh when less than 60 s
remain and retry the request once.
EOF
```

- Never use `git add -A`, `git add .` or interactive staging (`-p`, `-i`). Unstage a mistake with
  `git restore --staged -- <path>`.
- If a pre-commit hook fails, fix the cause and commit again; never use `--no-verify`. If a formatter hook
  modified files, re-stage them and run the same commit again (a new commit, not an amend).
- Do not amend, rebase, reset, stash or push. Pushing is the user's decision - mention that the branch is
  ready to push if it has an upstream.

## 6. Report

Show the result with `git log --oneline -n <number of commits created>` and `git status --short`, list any
files you intentionally left uncommitted and why.
