# Progress and report templates

Templates used by the `executing-plans` skill. Keep updates short: the user should understand the state of
the work in ten seconds. Bracketed text is guidance; replace it. Cite code as `path:line` so it is clickable in
ATOM.

---

## 1. Kick-off (before the first edit)

```markdown
Starting the plan "[title]" — [N] steps.
Baseline: [build/typecheck status], [tests: X passed, Y pre-existing failures in path/...].
Working tree: [clean | your uncommitted changes in path/... — I will not touch them].
[Branch: created `feat/...` | working on the current branch.]
```

## 2. Checkpoint update

```markdown
**Checkpoint [n]/[m]** — Steps [a–b] done and verified ([what was verified, e.g. "38 tests pass, typecheck clean"]).
Deviations: [none | one line each, with path:line and whether the plan was updated].
Next: [the next step, and why it needs confirmation — e.g. "runs the migration against the dev database"].
[Continue? | Continuing unless you object.]
```

## 3. Blocked — asking for a decision

```markdown
**Blocked on step [n]: [step title]**
What I found: [the fact that invalidates the plan, with path:line or the command output that shows it].
Why it matters: [consequence for behaviour, scope or risk].
Options:
1. [Option A] (recommended) — [trade-off]
2. [Option B] — [trade-off]
3. [Option C] — [trade-off]
State: steps 1–[n-1] are done and verified; nothing from step [n] is applied [or: partially applied in path/...].
```

Prefer AskUserQuestion for the options when the decision is discrete; keep the explanation in the message.

## 4. Final report

```markdown
## Done: [plan title]

**Result:** [One or two sentences in user terms. If anything is incomplete or failing, say so here first.]

**Success criteria**
- [x] [criterion] — [how it was verified]
- [x] [criterion] — [how it was verified]
- [ ] [criterion not met] — [why, and what remains]

**Changes**
- `path/to/file.ts:14` — [what changed]
- `path/to/other.py:88` — [what changed]
- `path/to/new_file.go` — [new: purpose]

**Verification**
- `[test command]` — [X passed (Y new), Z failed (pre-existing: ...)]
- `[typecheck command]` — [clean]
- `[lint command]` — [clean]
- Manual: [what was exercised and the observed result]

**Deviations from the plan**
- [Step n: what differed, why, and whether the user approved it — or "None".]

**Commits** [only if commits were made]
- `[sha]` [message]

**Follow-ups** [out-of-scope items, risks, cleanup worth doing later]
- [item]
```

## 5. Status vocabulary

Use these words consistently so updates are unambiguous:

| Word | Meaning |
|---|---|
| **done** | Implemented and its verification passed |
| **implemented, unverified** | Code written, verification not run or not possible — say why |
| **blocked** | Cannot proceed without a decision or external input |
| **skipped** | Deliberately not done — with the reason and who decided |
| **pre-existing** | A failure or issue that existed before this work started (shown by the baseline) |
