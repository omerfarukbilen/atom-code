# Debugging journal — [short bug title]

Keep this journal in your scratchpad (or in the chat if the user wants to follow along) once the first
hypothesis fails. Its purpose: never re-test a refuted idea, never lose a clue, and make the final report a
copy-paste job. Update it after every experiment — one or two lines is enough.

## 1. Problem statement

- **Expected:** [what should happen, in one sentence]
- **Actual:** [what happens instead, with the exact error message]
- **Scope:** [who/what is affected; since when; how often — e.g. "3 of 50 runs", "all EU users since v2.3.0"]
- **Reported by / source:** [user report, CI job link, terminal output]

## 2. Reproduction

- **Command:** `[smallest command that shows the failure]`
- **Runtime:** [e.g. 4 s]   **Failure rate:** [e.g. 100% / 6%]
- **Environment:** [OS, runtime versions, relevant env vars, branch and commit]
- **Known good:** [commit, version or configuration where it works, if any]

## 3. Facts (verified observations only)

- [Fact] — [how it was verified: command, log line, file:line]
- [Fact] — [...]

## 4. Hypotheses

| # | Hypothesis | Predicts | Test | Status |
|---|---|---|---|---|
| 1 | [cause] | [what we would see if true] | [cheapest experiment] | open / confirmed / refuted |
| 2 | [cause] | [...] | [...] | [...] |

## 5. Experiment log

| Time | Experiment | Result | Conclusion |
|---|---|---|---|
| [hh:mm] | [what you changed or ran] | [what you observed] | [which hypothesis it supports or kills] |

## 6. Root cause

[One or two sentences, with `path:line`. Explain why it fails, and why it did not fail before — or only
fails sometimes.]

## 7. Fix and verification

- **Fix:** [what changed, `path:line`]
- **Regression test:** [`path:line`] — fails without the fix: [yes, how it was checked]; passes with it: [yes]
- **Flaky bugs:** [N/N passing runs with the same loop that previously failed at X%]
- **Wider checks:** [suite, typecheck, lint, diagnostics]

## 8. Cleanup

- [ ] Instrumentation removed (Grep for the marker: `[DBG-xxxx]`)
- [ ] Scratch scripts and fixtures deleted
- [ ] `git bisect reset` / worktrees removed
- [ ] `git diff` contains only the fix and the test

## 9. Follow-ups

- [Related risks, sibling code with the same pattern, monitoring or docs worth adding]
