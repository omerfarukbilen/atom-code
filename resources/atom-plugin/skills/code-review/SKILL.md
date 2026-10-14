---
name: code-review
description: Structured review of a diff, branch, pull request or set of files using a severity rubric (blocker, major, minor, nit) and verified findings reported as path-and-line items with a suggested fix. Use when asked to review code, a PR, staged or uncommitted changes, or an agent's patch, and as a final self-check before handing back a large change. Reviews in order of impact - correctness, security, data integrity, performance, error handling, tests, readability - and verifies each suspicion to avoid false positives.
---

# Code Review

Find the problems that matter, prove them, and say exactly how to fix them. A review with three real bugs is
worth more than one with thirty style remarks — and every false positive costs the author time and erodes
trust in the rest of the review. Your job is not to rewrite the change in your own style; it is to make sure
it is correct, safe and maintainable.

## When to use

- The user asks for a review of a PR, branch, commit range, staged/uncommitted changes, or specific files.
- Before reporting your own non-trivial change as done (self-review catches a surprising amount).
- Checking a patch produced by another agent or subagent.

## When not to use

- A deep security assessment of a whole system — use `atom:security-audit`.
- Reviewing an API contract or a migration in depth — `atom:api-design` and `atom:database-migrations` have the
  specialised checklists; use them alongside this rubric.
- Profiling and optimizing — use `atom:performance-optimization`.
- The user wants the issues fixed, not reported — review first, then fix with the relevant skill, and say
  which findings you addressed.

## Process

### 1. Establish scope and intent

```bash
git status --short
git diff --stat                     # unstaged
git diff --staged --stat            # staged
git log --oneline main..HEAD        # commits on this branch (replace main with the default branch)
git diff main...HEAD --stat         # three dots: changes since the merge base, i.e. what the PR contains
gh pr view 123 --comments           # PR description, discussion, linked issues (GitHub)
gh pr diff 123                      # PR diff without checking it out
```

Find the default branch with `git symbolic-ref refs/remotes/origin/HEAD` if it is not obvious. Read the PR
description, commit messages and linked issue: you are reviewing against the *intent*. If the intent is
unclear and it changes what counts as a bug, ask with AskUserQuestion before reviewing.

Do not run `gh pr checkout` or switch branches without asking — it changes the user's working tree. To read a
file as it exists on another ref, use `git show main:path/to/file.ts`.

### 2. Gather context

- Read whole changed files (or generous context: `git diff -U25 main...HEAD -- path`), not just the hunks.
  Many bugs live in the interaction between the changed lines and the unchanged ones around them.
- For every changed signature, return type, config key or schema field, Grep for its users. A change that is
  correct locally can break a caller three directories away.
- Read the tests that changed — and notice the tests that *should* have changed but did not.
- Check project conventions: `ATOM.md`, `CLAUDE.md`, `CONTRIBUTING.md`, lint and formatter configs.
- Generated files and lockfiles: skim; check lockfile changes match manifest changes and nothing unexpected
  was added.

### 3. Review in order of impact

Work through the passes in this order. Earlier categories cause outages, breaches and data loss; they are
cheap to fix in review and expensive after release, so they get your freshest attention.

1. **Correctness** — Does it do what the intent says? Edge cases: empty, null, one, many, max, negative,
   unicode, concurrent calls, retries. Off-by-one, wrong operator, inverted condition, wrong variable,
   missing `await`, unhandled enum case, behaviour change for existing callers.
2. **Security** — Untrusted input reaching queries, shells, file paths, HTML, redirects, deserializers.
   Missing authorization (authenticated is not authorized), IDOR, secrets in code or logs, weakened
   validation, permissive CORS, unsafe defaults. When the diff touches auth, sessions, IPC, uploads or
   secrets, run the source-to-sink tracing from `atom:security-audit` on that part.
3. **Data integrity** — Multi-step writes without a transaction, lost updates, non-idempotent retries,
   destructive or locking migrations, missing backfill, changed serialization formats, precision loss,
   time-zone handling, cache invalidation. Migrations get the locking and expand/contract checks from
   `atom:database-migrations`.
4. **Performance** — Only where it plausibly matters: N+1 queries, unbounded queries or loops over user-sized
   data, work inside hot loops, missing pagination, blocking I/O on an event loop, accidental quadratic
   algorithms, memory growth. Requires evidence of a hot path, not a hunch.
5. **Error handling** — Swallowed errors, catch-all handlers, lost causes/stack traces, missing timeouts,
   partial failure leaving inconsistent state, user-facing messages that leak internals, resources not
   released on the error path (the patterns to suggest are in `atom:error-handling`).
6. **Tests** — Is the new behaviour tested, including the failure path? Would the tests fail if the code were
   wrong? Over-mocked tests, assertion-free tests, flaky timing.
7. **Readability and maintainability** — Misleading names, dead code, duplication of existing helpers,
   needless complexity, comments that contradict the code, public API surface that is hard to use correctly.

[references/checklist.md](references/checklist.md) has a detailed checklist per pass and language-specific
gotchas for TypeScript/JavaScript, React, Node, Python, Go, Rust, SQL, shell and CI/config. Read the sections
for the languages in the diff.

### 4. Verify every suspicion before reporting it

A suspicion is a lead, not a finding. Before you write it down:

1. **Re-read the exact lines.** Confirm you are looking at an added line (`+`), not a removed one, and that a
   later hunk did not already handle it.
2. **Trace the data.** Where does the value come from? Is it validated or normalized upstream? Grep the callers.
   Many "missing null checks" are guaranteed non-null by a constructor or schema.
3. **Check the semantics.** When unsure how a language or library behaves, run a tiny experiment instead of
   relying on memory:
   ```bash
   node -e "console.log([10, 9, 1].sort())"            # [ 1, 10, 9 ]
   python3 -c "print(round(2.5), round(3.5))"           # 2 4  (banker's rounding)
   ```
   For library behaviour, read the installed version's source or docs (WebFetch the docs for that version).
4. **Reproduce when it is cheap.** A failing test or a scratch script is the strongest possible evidence —
   and the author can reuse it.
5. **Run the tooling.** The project's tests, typecheck and linters (`npm test`, `npx tsc --noEmit`,
   `ruff check`, `mypy`, `go vet ./...`, `cargo clippy --all-targets`), and `mcp__atom-ide__get_diagnostics`
   for files open in the editor.

Then decide: **verified** → report with a severity. **Plausible but unverified** → report under *Questions*
and say what you could not confirm. **Disproved** → drop it silently.

### 5. Assign severity

| Severity | Meaning | Examples |
|---|---|---|
| **blocker** | Must be fixed before merge. Breaks correctness in realistic use, loses or corrupts data, is exploitable, breaks the build, or breaks callers without a migration path. | SQL injection; authorization bypass; migration drops a column still read in production; crash on the main path |
| **major** | Should be fixed before merge, or tracked with explicit agreement. Real bug in a plausible edge case, silent failure, significant performance regression on a hot path, risky logic without tests. | No timeout on an outbound call in a worker; race on concurrent updates; error swallowed and reported as success |
| **minor** | Worth fixing, low risk. Maintainability issues likely to cause future bugs, small inefficiencies, missing validation of unlikely input. | Duplicates an existing helper that will drift; misleading name; missing test for an error branch |
| **nit** | Optional polish and preference. Mark clearly so it never blocks. Skip anything a formatter or linter enforces. | Slightly clearer name; comment wording; import order the tooling does not enforce |

When torn between two levels, ask "what happens if this ships as is?" and pick the level that matches the
realistic consequence, not the worst imaginable one. Security findings graded on the `atom:security-audit`
scale map as Critical/High → blocker, Medium → major, Low/Info → minor.

### 6. Write the report

Each finding on one line (wrap only for a code suggestion), in this format:

```
[severity] path:line — problem → suggested fix
```

Use the line number in the **current** file (Read the file or `grep -n` — hunk offsets drift), and a range
`path:120-134` when the issue spans lines. ATOM renders `path:line` as a clickable link.

```markdown
## Review: feat/order-export (6 commits, 14 files)

**Verdict:** Request changes — 1 blocker, 2 major, 1 minor, 1 nit.
**Summary:** Adds CSV export for orders. The export endpoint trusts a user id from the query string, and the
background job can run forever on a slow upstream.

### Blockers
[blocker] src/api/orders/export.ts:41 — `req.query.userId` selects whose orders are exported without checking it
matches the session, so any logged-in user can export anyone's orders (IDOR) → use `req.session.userId` and drop
the query parameter; add a test that a second user gets 403.

### Major
[major] workers/export_job.py:58 — `requests.get(url)` has no timeout; one slow upstream stalls the worker
indefinitely → `requests.get(url, timeout=(3.05, 30))` and handle `requests.Timeout` with a retry.
[major] src/api/orders/export.ts:77 — rows are concatenated with `,` but fields are not quoted, so a comma or
newline in a customer name corrupts the CSV → use the existing `toCsvRow()` from src/lib/csv.ts:12.

### Minor
[minor] src/api/orders/export.ts:90-104 — date formatting duplicates `formatIsoDate()` in src/lib/dates.ts:8;
the copies will drift → call the helper.

### Nits
[nit] src/api/orders/export.ts:23 — `data` → `orderRows` would make the loop below easier to follow.

### Questions
- workers/export_job.py:30 — is `export_id` unique per user? If not, two concurrent exports overwrite the same
  file. I could not find the constraint in the schema.

### Verified
`npm test` (212 passed), `npx tsc --noEmit` clean, `ruff check workers/` clean.
```

Writing guidelines:

- **Problem, then consequence, then fix.** "X happens, which causes Y → do Z." Name a concrete scenario
  whenever possible ("a customer named `Smith, Jr.`").
- **Suggest a concrete fix** — a code snippet for anything non-obvious. "Consider improving error handling"
  is not actionable.
- **Be direct and neutral.** Critique the code, not the author. No hedging filler, no sarcasm.
- **One finding per issue.** If the same mistake appears in five places, report it once and list the locations.
- **Pre-existing problems** outside the diff: mention only if serious, labelled "pre-existing", and never as
  a blocker for this change.
- **Acknowledge good decisions briefly** when they are notable (a well-placed test, a careful migration) —
  one line, not a paragraph.
- **No findings?** Say so plainly, state what you checked and how ("Verified: tests, typecheck; reviewed
  callers of `exportOrders`"). Do not invent nits to look thorough.

## Large reviews

- Review commit by commit when the history is clean: `git log -p --reverse main..HEAD`.
- Split by area (API, data layer, UI, infra). For big diffs, delegate areas to `atom:code-reviewer` subagents in
  parallel with the Agent tool. Give each the scope, the intent, this rubric and the output format. Treat their
  output as leads: verify, deduplicate and re-grade before anything reaches the report.
- Track areas in TodoWrite so nothing is skipped.

## Avoiding false positives

Common traps that make reviews wrong:

- Flagging something handled elsewhere — validation in middleware, a schema, a database constraint, a caller.
- Reading a removed line as an added one, or missing that a later hunk fixed it.
- Misremembering semantics: Go's `append` and `range` work on nil slices; Python's `dict` preserves insertion
  order; JavaScript `?.` short-circuits the whole chain; Rust's `?` converts errors via `From`.
- Presenting preferences as defects ("I would use a class here"). If it is preference, it is a nit at most.
- Speculative performance claims on cold paths. Say why it is hot (request path, loop over user data) or drop it.
- Generic advice ("add more tests", "consider edge cases") with no specific case named.
- Demanding changes outside the scope of the change.

## Pitfalls

- Reviewing only the diff hunks and missing the caller that now breaks.
- Spending the review budget on naming and formatting before checking correctness and security.
- Reporting unverified suspicions as facts.
- Burying the one blocker under twenty nits — order by severity, blockers first.
- Approving because the tests pass, without checking that the tests would fail if the code were wrong.

## Definition of done

- [ ] Scope and intent are clear; every changed file in scope was read with enough context.
- [ ] All seven passes done, in order, using the checklist for the languages involved.
- [ ] Every reported finding was verified; uncertain ones are under Questions with what is unknown.
- [ ] Findings use `[severity] path:line — problem → suggested fix`, grouped and ordered by severity.
- [ ] The report has a verdict, a short summary, and what you ran to verify (tests, typecheck, linters).
