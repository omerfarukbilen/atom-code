---
name: executing-plans
description: Carry out an approved implementation plan step by step - mirror it in TodoWrite, implement one step at a time, verify each step with tests, typecheck or a concrete check, keep the plan in sync when reality differs, pause at checkpoints, optionally commit per step, and finish with a structured report. Use right after a plan is approved (for example when leaving plan mode), when the user says go ahead, implement the plan or continue, or when resuming a partially executed plan.
---

# Executing Plans

An approved plan is a contract: the user agreed to a goal, a scope and an approach. Executing it well means
delivering exactly that, one verified step at a time, and making every deviation visible. The failure modes
are familiar — charging through all the steps and debugging a pile of breakage at the end, silently drifting
from the plan, or quietly growing the scope. This skill prevents all three.

## When to use

- A plan (from `atom:writing-plans`, plan mode, or the user) has been approved and implementation starts.
- The user says "go ahead", "implement it", "continue with the plan".
- Resuming a plan that was partly executed in an earlier turn or session.

## When not to use

- There is no plan and the task is non-trivial — write one first (`atom:writing-plans`).
- A single small change — just make it and verify.

## Before the first edit

1. **Re-read the whole plan.** Note success criteria, out-of-scope items, checkpoints, and any assumptions the
   user vetoed or changed during approval — their edits override the original text.
2. **Check the starting state.** `git status --short` and `git log --oneline -5`. Uncommitted changes that are not
   yours belong to the user: do not overwrite, stash or discard them. If they collide with the plan, ask.
3. **Get a baseline.** Run the build/typecheck and the relevant tests once. Record pre-existing failures so you
   can tell them apart from failures you cause.
4. **Branch if asked.** If the plan or the user calls for a branch, create it now (see `atom:git-workflow`).
5. **Mirror the steps in TodoWrite** (or the task-list tools your harness provides, such as TaskCreate and
   TaskUpdate). One todo per plan step, in plan order, worded as outcomes. Keep exactly one item
   `in_progress`, and mark an item `completed` only after its verification passes — the list is your memory
   across long sessions and context compaction, and the user watches it to follow progress.

## The step loop

For each step:

1. **Mark it `in_progress`.**
2. **Re-read before editing.** Read the files the step touches, even if you read them during planning — the
   code may have changed, and edits based on a stale picture are the main source of broken steps.
3. **Make the change.** The smallest edit that fulfils the step, following existing patterns. Nothing from
   other steps, no opportunistic refactors. When the step adds behaviour, write its test first
   (`atom:test-driven-development`) - the failing test is the step's verification.
4. **Verify.** Run the step's verification command from the plan. Also check `mcp__atom-ide__get_diagnostics`
   for the touched files and run a typecheck when the change affects types. Verification is what makes a step
   done — "it compiles" is not the same as "it works".
5. **On green:** mark the todo `completed`. If commits were requested, commit now (see below). Update the plan
   file's checkbox if the plan lives in a file.
6. **On red:** fix it within the step — use `atom:systematic-debugging` rather than guessing. Do not start
   the next step on top of a broken one; failures compound and become hard to attribute. After two failed
   attempts at the same problem, stop and report (see "When to stop and ask").

Per-ecosystem verification commands, for reference:

```bash
npx tsc --noEmit && npx vitest run src/orders          # TypeScript (or npm test -- src/orders)
ruff check . && mypy src && pytest tests/orders -x -q  # Python
go build ./... && go vet ./... && go test ./internal/orders
cargo check --all-targets && cargo test orders
```

## When reality differs from the plan

It usually does. What matters is classifying the deviation and making it visible.

| Deviation | Examples | What to do |
|---|---|---|
| **Trivial** | A helper has a different name; an extra import or test file; a step is easier than expected | Just do it. Mention it in the final report. |
| **Material** | Another file must change; an API behaves differently than the plan assumed; a step must be split or reordered | Update the plan and TodoWrite, tell the user in one line, and continue — as long as goal, scope and approach still hold. |
| **Fundamental** | The approach cannot work; requirements conflict; scope would grow noticeably; a new dependency, schema change or unplanned data migration is needed; security or data-loss implications | Stop. Explain what you found, offer options with a recommendation (AskUserQuestion), and wait. |

When in doubt between material and fundamental, treat it as fundamental: a short pause costs less than
building the wrong thing.

## Checkpoints

Pause, summarize and (when the plan says so, or the next action is risky) wait for confirmation:

- At checkpoints written into the plan.
- Before anything destructive or hard to reverse: running migrations against real data, deleting files or
  data, rewriting history, publishing packages, deploying, sending messages or calling production systems.
- After the foundational step (schema, core types, public interface) of a long plan — a wrong foundation is
  cheapest to fix now.
- Roughly halfway through a long plan, so the user can redirect.

Keep checkpoint updates short:

```
**Checkpoint 1/2** — Steps 1–3 done and verified (schema, csv helper, endpoint; 38 tests pass).
Deviation: step 3 also needed src/api/router.ts:44 to register the route (plan updated).
Next: step 4 runs the backfill migration on the dev database. Continue?
```

## When to stop and ask

- An assumption in the plan turns out false in a way that changes behaviour, scope or risk.
- A step needs something the plan did not authorize: a new dependency, a schema change, edits to code outside
  the plan's scope, touching credentials or secrets, network calls to production, force operations.
- Two failed attempts at the same step, even after systematic debugging.
- Previously passing tests break and the fix lies outside the current step.
- Pre-existing failures prevent you from verifying your step.
- The implementation reveals an ambiguity in the requirements.

Ask with concrete options and a recommendation, not an open "what should I do?".

## Scope discipline

- Do not fix unrelated problems you notice along the way; list them as follow-ups in the report. The user
  approved a specific change, and unrelated edits make the diff harder to review and riskier to ship.
- Do not add features, configuration or abstractions the plan did not include.
- If a small extra change is genuinely required for the plan to work, it is a deviation — classify it as above.

## Commits (only when requested)

If the plan or the user asked for commits:

- One commit per verified step, so each commit builds and passes tests.
- Stage only that step's files (`git add path/a path/b`, not `git add -A`) and review `git diff --staged`
  before committing — never commit secrets, debug output or unrelated user changes.
- Follow the repository's message convention (often Conventional Commits: `feat(orders): add CSV export endpoint`).
- Never amend published commits, rebase or force-push without explicit permission. See `atom:git-workflow`.

If commits were not requested, leave the changes uncommitted and suggest logical commit boundaries in the report.

## Delegating steps

Independent, well-specified steps (tests for a finished module, docs, a mechanical migration across many files)
can go to a subagent via the Agent tool — for example `atom:test-engineer`, `atom:docs-writer` or
`atom:refactorer`. Give it the step text, the files, the constraints and the verification command. Then review
its diff and run the verification yourself: delegated work is not done until you have checked it.

## Resuming a partially executed plan

1. Read the plan and the current todo list.
2. `git status`, `git log --oneline -10` and `git diff --stat` to see what actually exists.
3. Re-run the verification of the last completed step — "completed" in a list is a claim, a passing check is
   evidence.
4. Continue from the first unverified step.

## Finishing

1. **Full verification:** the whole test suite (or as much as is practical), typecheck, linter, build.
2. **Diff review:** `git diff --stat` and a read of the full diff against the plan — every planned change present,
   nothing unplanned. Use the `atom:code-review` process for a self-review on larger changes.
3. **Cleanup:** remove debug output, temporary files and commented-out code; diagnostics clean.
4. **Check the success criteria** from the plan one by one.
5. **Report** using the template in [templates/progress-report.md](templates/progress-report.md):

```markdown
## Done: CSV export for orders

**Result:** Owners can export their orders as CSV from Settings → Orders. All success criteria met.

**Changes**
- src/lib/csv.ts:14 — `toCsvRow` with RFC 4180 quoting
- src/api/orders/export.ts:1 — export endpoint, session user only
- src/api/router.ts:44 — route registration (not in the original plan)

**Verification:** `npm test` 251 passed (12 new) · `npx tsc --noEmit` clean · `npm run lint` clean ·
manual export of 50k seeded orders in 6.2 s.

**Deviations:** Step 3 also touched src/api/router.ts (reported at checkpoint 1).

**Follow-ups:** Line-item export (out of scope) · src/invoices/export.ts duplicates the old CSV code.
```

Be honest in the report: if something is unverified, partially done or failing, say so plainly at the top.

## Pitfalls

- Implementing several steps before verifying any of them.
- Marking todos complete before verification, or batching status updates at the end.
- Editing from memory of the planning phase instead of re-reading files.
- Silent deviations — the user discovers them in the diff and loses trust in the rest.
- "While I'm here" refactors and fixes outside scope.
- Treating a subagent's "done" as verified.
- Hiding failures or skipped verification in a cheerful summary.

## Definition of done

- [ ] Every plan step is implemented and verified, or explicitly reported as skipped/blocked with the reason.
- [ ] TodoWrite reflects reality; the plan file (if any) is updated, including deviations.
- [ ] Full test suite, typecheck, lint and build pass (pre-existing failures called out separately).
- [ ] Diff matches the plan; no debug code, stray files or unrelated changes.
- [ ] Success criteria checked one by one.
- [ ] Final report delivered: result, changes with `path:line`, verification, deviations, follow-ups.
