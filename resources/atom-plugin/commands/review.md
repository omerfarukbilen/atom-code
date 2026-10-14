---
description: Review current changes (or a given path, ref range or PR) for bugs, security and quality - severity-ranked path:line findings, no edits
argument-hint: "[path | ref range | branch | PR number] [--deep]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git blame:*), Bash(git symbolic-ref:*), Bash(git merge-base:*), Bash(git rev-parse:*), Bash(gh pr view:*), Bash(gh pr diff:*)
---

Review code changes and report verified findings. Do not edit any files during the review.

Review target from the user: $ARGUMENTS

## 1. Load the rubric

Invoke the `atom:code-review` skill with the Skill tool and follow it: the seven passes in order of impact,
verification of every suspicion, the blocker/major/minor/nit rubric and the report format.

## 2. Resolve the scope

Interpret the target above:

- **Empty** → the working tree. Run `git status --short`, `git diff --staged` and `git diff`. Untracked files do
  not appear in `git diff`; Read the ones listed as `??` that look like source files.
- **A path or glob** → those files. If they have uncommitted changes, focus on the changes but read the whole
  file for context; otherwise review the files as they are.
- **A ref range or branch** (`main..HEAD`, `feature/x`, a SHA) → `git log --oneline <base>..<head>` and
  `git diff <base>...<head>` (three dots: changes since the merge base). Find the default branch with
  `git symbolic-ref --short refs/remotes/origin/HEAD` when you need a base.
- **A PR number** → `gh pr view <n> --comments` and `gh pr diff <n>`. Do not check the PR out; read other
  versions of files with `git show <ref>:<path>`.
- **`--deep`** anywhere in the target → force the parallel review described in step 4.

If there is nothing to review (clean tree, empty range), say so in one line and stop.

## 3. Understand the intent

Read commit messages, the PR description and any linked issue, plus `ATOM.md` / `CLAUDE.md` /
`CONTRIBUTING.md` for project rules. You are reviewing against what the change is supposed to do. If the
intent is unclear in a way that changes what counts as a bug, ask with AskUserQuestion before going further.

## 4. Review

- Read whole changed files or wide context, and Grep the callers of every changed signature, export, config
  key or schema field.
- **Large changes** (roughly 400+ changed lines, several independent areas, or `--deep`): split by area (API,
  data layer, UI, infrastructure, tests) and delegate each area to an `atom:code-reviewer` subagent with the
  Agent tool, in parallel, giving each the scope, the intent and the expected output format. Treat what they
  return as leads: verify, de-duplicate and re-grade before anything reaches your report.
- Run the cheap checks and use their results as evidence: the tests for the touched area, the typecheck
  (`npm run typecheck` / `npx tsc --noEmit`, `mypy`, `go vet ./...`, `cargo check`), linters in check mode, and
  `mcp__atom-ide__get_diagnostics` for files open in the editor. Do not run formatters or fixers that write.

## 5. Report

```markdown
## Review: <scope> (<n> files)
**Verdict:** Approve | Approve with nits | Request changes — <counts by severity>
**Summary:** <two sentences: what the change does and the biggest risk>

### Blockers / Major / Minor / Nits
[severity] path:line — problem → suggested fix

### Questions
- path:line — what you suspect and what you could not confirm

### Verified
<commands run and results>
```

Order strictly by severity, one finding per issue (list all locations for a repeated mistake), line numbers
from the current files. If everything looks good, say so and state what you checked - do not invent nits.

Finish by offering to fix the blockers and majors. Do not start fixing until the user says so.
