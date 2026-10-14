---
description: Diagnose and fix an error, failing test or issue at its root cause using IDE diagnostics and systematic debugging, then prove the fix
argument-hint: "[error message | failing test | issue number or URL | blank for current diagnostics]"
---

Find the root cause of the problem below, fix it minimally and prove the fix. Follow the
`atom:systematic-debugging` skill (load it with the Skill tool).

Problem from the user: $ARGUMENTS

## 1. Gather the evidence

- **Error text or stack trace given** → copy the exact message; find the deepest frame in project code.
- **Failing test named** → run exactly that test to see the current failure.
- **Issue number or URL** → read it with `gh issue view <n> --comments` (GitHub), and extract the expected vs
  actual behaviour and reproduction steps.
- **Empty** → look at what the user is looking at:
  - `mcp__atom-ide__get_diagnostics` for compiler and linter errors (errors before warnings),
  - `mcp__atom-ide__get_terminal_output` for the most recent failing command,
  - `mcp__atom-ide__get_selection` for code they highlighted.
  If none of these shows a problem, ask what is wrong with AskUserQuestion.

Write expected and actual behaviour in one sentence each. Check what changed recently (`git log --oneline -15`,
`git diff HEAD --stat`) - regressions usually correlate with a change.

## 2. Reproduce, isolate, prove

1. Get the smallest, fastest command that shows the failure (a single test, a one-line script, the compiler on
   one file). If you cannot reproduce it, say what you tried and what you need.
2. Narrow it down: shrink the input, add temporary logging tagged with a unique marker, or use
   `git bisect run` in a separate worktree (as the skill shows) when there is a known-good commit.
3. Rank two to four hypotheses and test the cheapest discriminating one first. The cause is proven when it
   explains every symptom - including why it did not fail before - and toggling it toggles the failure.

**Many diagnostics at once:** group them by root cause. Fix the earliest errors in the earliest files first;
later errors are often cascades of the first and disappear with it. Re-check diagnostics after each fix.

For a long, noisy investigation, delegate to the `atom:debugger` subagent with the Agent tool (give it the exact
error, the repro command and what you already ruled out) to keep this conversation focused, then verify its
result yourself.

## 3. Fix at the origin

Change the code where the bad state is created, not where it finally crashes. Keep the diff to the fix; Grep
for the same mistake elsewhere and list siblings rather than silently expanding scope.

Do not make the symptom disappear instead of fixing it. These are only acceptable when they truly are the
correct fix, and then with a comment explaining why: `@ts-ignore` / `@ts-expect-error`, `as any`,
`# type: ignore`, `eslint-disable`, `#[allow(...)]`, empty `catch`, `except: pass`, retries, sleeps, bigger
timeouts, skipping or loosening tests, editing a test to match buggy behaviour.

## 4. Verify

- Add a regression test that fails without the fix and passes with it (prove the failing half by temporarily
  reverting the fix).
- Re-run the original reproduction, the tests for the affected area, and the typecheck or build.
- Check `mcp__atom-ide__get_diagnostics` for the touched files.
- Remove all temporary instrumentation (Grep for your marker) and scratch files; `git diff` should show only
  the fix and the test.

If three hypotheses fail, stop and report what you eliminated and what you would try next instead of guessing.

## 5. Report

```markdown
**Symptom:** <exact error or behaviour>
**Root cause:** <one or two sentences> — path:line
**Fix:** <what changed> — path:line
**Verification:** <regression test path:line fails before / passes after; commands run and results>
**Follow-ups:** <same pattern elsewhere, related risks>
```
