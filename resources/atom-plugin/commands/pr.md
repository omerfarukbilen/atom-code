---
description: Prepare a pull request - summarize the branch against the default branch, write a title and description from the template, and collect real test evidence
argument-hint: "[base branch] [--draft] [--create]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git rev-parse:*), Bash(git symbolic-ref:*), Bash(git merge-base:*), Bash(git fetch:*), Bash(gh repo view:*), Bash(gh pr view:*)
---

Prepare a pull request for the current branch. Follow the `atom:git-workflow` skill (load it with the Skill
tool); its `templates/pull-request.md` is the default description template.

Options from the user: $ARGUMENTS

Interpret the options: a bare word is the base branch; `--draft` marks the PR as a draft; `--create` means the
user wants the PR opened with `gh` after review (otherwise only prepare the text).

## 1. Establish the base and the state of the branch

```bash
git rev-parse --abbrev-ref HEAD
git status --short --branch
git symbolic-ref --short refs/remotes/origin/HEAD     # e.g. origin/main - the default branch
```

- Base: the branch named in the options, else the remote default branch from the command above, else
  `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, else whichever of `main` / `master` exists.
  Compare against `origin/<base>`; if it may be stale, `git fetch origin <base>` is safe (it only updates
  remote-tracking refs).
- On the base branch itself → stop and suggest creating a feature branch first.
- Uncommitted changes → warn that they will not be part of the PR and offer `/atom:commit`.
- No commits ahead of the base → say so and stop.

## 2. Understand the whole change

```bash
git log --oneline origin/<base>..HEAD
git diff --stat origin/<base>...HEAD
git diff origin/<base>...HEAD
```

Base the description on the full diff and every commit, not on the last commit or the original task. Read
the key changed files where the diff alone does not explain the behaviour. Find linked issues in commit
messages or the branch name (`fix/482-...`, `Refs: #482`).

Quick self-review while you read - flag in Reviewer notes, or suggest fixing before opening: leftover debug
output, commented-out code, TODOs added without an issue, secrets, unrelated changes, missing tests for new
behaviour, a diff so large it should be split (suggest a split along logical boundaries).

## 3. Collect test evidence

Run the project's relevant checks now and record the real results: tests for the touched areas (or the full
suite if it is fast), typecheck, lint. Never claim a check you did not run; if something cannot run locally,
say so. Add the manual verification steps a reviewer can follow, with exact commands and expected results.
For UI changes, note that before/after screenshots are needed.

## 4. Write the title and description

- Use the repository's own template if one exists: `.github/pull_request_template.md`,
  `.github/PULL_REQUEST_TEMPLATE/*.md`, `docs/pull_request_template.md` or `pull_request_template.md` at the
  root. Otherwise use the skill's template. Delete sections that do not apply instead of writing "N/A".
- **Title:** Conventional Commits style, at most 72 characters, describing the user-visible effect -
  `feat(reports): add CSV export for orders`.
- **Description** (fallback structure):

```markdown
## Summary
<one to three sentences: what this PR does and why; lead with the user-visible effect>

Closes #<issue>

## Changes
- <grouped by area; mention files only when it helps navigation>

## Why this approach
<the key decision and the alternative you rejected>

## How to test
1. <exact, copy-pasteable steps with expected results>

Automated checks run locally:
- [x] `<test command>` — <result, e.g. 214 passed>
- [x] `<typecheck/lint command>` — clean

## Risk and rollout
- Breaking changes: <none | what and how consumers migrate>
- Migrations: <none | reversible? safe on a live system?>
- Rollback: <how>

## Reviewer notes
<where to focus, known limitations, deliberate follow-ups>
```

Output the title and the description in a fenced markdown block ready to paste.

## 5. Open the PR only when asked

Without `--create`, stop after presenting the text and ask whether to open it.

With `--create` (or after the user says yes):

1. If the branch has no upstream or has unpushed commits, ask before pushing, then `git push -u origin HEAD`.
   Never force-push here; if the push is rejected, report it and let the user decide.
2. Write the description to a temporary file outside the repository and run
   `gh pr create --base <base> --title "<title>" --body-file <file>` (add `--draft` if requested).
3. Report the PR URL that `gh` prints.
