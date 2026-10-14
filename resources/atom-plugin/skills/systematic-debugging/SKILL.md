---
name: systematic-debugging
description: Root-cause debugging loop - reproduce, isolate, rank hypotheses, prove the cause, apply a minimal fix, add a regression test, remove instrumentation. Use when a test fails, code crashes or throws, output is wrong, behaviour is flaky or intermittent, something worked before and now does not, or a first fix attempt did not work. Covers git bisect, minimal repros, logging, scripted debuggers and bug classes such as races, off-by-one, null values, async ordering, config, caching and encoding.
---

# Systematic Debugging

Find the root cause, prove it, fix it once. Guess-and-patch feels faster, but every unverified change adds a
new variable, can mask the real defect, and leaves code nobody can explain. Treat a bug as an experiment:
observe, form hypotheses that could be wrong, run the cheapest test that would disprove them, and only then
change code.

## When to use

- A test, build, or CI job fails and the cause is not obvious from the first error line.
- A crash, exception, panic, hang, or wrong output — in tests, locally, or reported by a user.
- Intermittent ("flaky") failures, or behaviour that differs between machines, environments, or runs.
- A regression: it worked at an earlier commit, version, or configuration.
- You already tried one fix and it did not work. That is the strongest signal to slow down and use this process.

## When not to use

- The cause is visible and certain (a typo on the line the error points at). Fix it, run the test, move on.
- Performance tuning with no functional bug — use `atom:performance-optimization`.
- New feature work — use `atom:writing-plans` and `atom:test-driven-development`.

## The loop

```
1 Gather → 2 Reproduce → 3 Isolate → 4 Hypothesize → 5 Prove → 6 Fix → 7 Regression test → 8 Clean up → 9 Report
```

For anything beyond a quick fix, put these phases in TodoWrite so progress survives a long session, and start
a debugging journal ([templates/journal.md](templates/journal.md)) as soon as your first hypothesis fails.
Detailed techniques per bug class live in [references/techniques.md](references/techniques.md) — Read the
relevant section once you know which class you are dealing with.

### 1. Gather evidence

- Read the whole error and the whole stack trace. Find the deepest frame in project code (not in
  `node_modules`, `site-packages`, the Go runtime or `std`) — that is usually where to start reading.
- Copy the exact message. Exact strings are searchable with Grep and on the web (WebSearch) — paraphrases are not.
- Use the IDE: `mcp__atom-ide__get_terminal_output` shows what the user just saw in the terminal,
  `mcp__atom-ide__get_diagnostics` lists compiler/linter errors, `mcp__atom-ide__get_selection` shows the
  code the user is pointing at.
- Ask what changed. Regressions almost always correlate with a change:
  ```bash
  git log --oneline -15
  git diff HEAD --stat                 # uncommitted changes
  git log -p -3 -- path/to/suspect.ts  # recent history of one file
  git diff HEAD~10 -- package-lock.json poetry.lock go.sum Cargo.lock   # dependency drift
  ```
- Write down **expected** vs **actual** in one sentence each. If you cannot state the expected behaviour,
  ask the user with AskUserQuestion rather than inventing it.

### 2. Reproduce

Get the smallest, fastest command that shows the failure. A 2-second repro lets you run dozens of experiments;
a 5-minute one makes you guess.

```bash
npx vitest run src/cart.test.ts -t "applies coupon"     # or: npx jest src/cart.test.ts -t "applies coupon"
pytest tests/test_cart.py::test_applies_coupon -x -vv
go test ./internal/cart -run '^TestApplyCoupon$' -count=1 -v   # -count=1 bypasses the test cache
cargo test applies_coupon -- --nocapture
```

- **Flaky?** Loop it until it fails, and record the failure rate — you need it later to prove the fix:
  ```bash
  for i in $(seq 1 50); do npx vitest run src/cart.test.ts >/dev/null 2>&1 || { echo "failed on run $i"; break; }; done
  go test ./internal/cart -run TestApplyCoupon -count=200 -race
  ```
  Also try shuffled order (`go test -shuffle=on`, `vitest --sequence.shuffle`, `jest --randomize`) and running
  the test alone vs with the full suite — passing alone but failing together means shared state.
- **Cannot reproduce?** Do not fix blind. Compare the failing environment with yours (versions, env vars, OS,
  data, timing, feature flags). If it still will not reproduce, add targeted logging that would catch it next
  time, and tell the user exactly what it will capture.
- Turn the repro into a failing automated test as early as possible. It becomes the regression test in step 7.

### 3. Isolate

Halve the search space until the defect has nowhere left to hide.

- **Bisect history** when there is a known-good commit. Use a separate worktree so the user's checkout and
  uncommitted work stay untouched:
  ```bash
  git worktree add ../bisect-wt HEAD && cd ../bisect-wt
  git bisect start HEAD v1.4.0          # bad first, then a commit you verified is good
  git bisect run sh -c 'npm ci --silent && npx vitest run src/cart.test.ts'
  git bisect reset && cd - && git worktree remove ../bisect-wt
  ```
  The script's exit code drives the search: 0 = good, 125 = skip (untestable commit), 1–127 otherwise = bad.
- **Bisect the input**: delete half of the failing JSON/CSV/request, keep whichever half still fails, repeat.
- **Bisect the code path**: log or assert on intermediate values at the midpoint of the pipeline
  (parse → validate → transform → persist). Bad at the midpoint means the defect is upstream.
- **Minimal repro**: a standalone script in your scratchpad that calls only the failing function with the
  failing input. If the bug disappears in isolation, the difference between the script and the real
  call site *is* the clue.
- **Instrument at boundaries** with a unique marker so cleanup is one Grep:
  ```ts
  console.error('[DBG-7f3] applyCoupon in', JSON.stringify({ cart, coupon }));
  ```
  ```python
  print(f"[DBG-7f3] apply_coupon in cart={cart!r} coupon={coupon!r}", file=sys.stderr)
  ```
  Log inputs *and* outputs, with ids and timestamps when ordering matters. `repr`/`JSON.stringify` beat plain
  printing — they reveal `None` vs `"None"`, trailing whitespace, and numbers stored as strings.
- **Debuggers**: interactive debuggers need a TTY that the Bash tool does not provide, so script them
  (`gdb -batch -ex run -ex bt --args ./app`) or use non-interactive equivalents. See
  [references/techniques.md](references/techniques.md#scripted-debuggers-and-runtime-flags).
- For a wide search ("who writes `session.user`?"), delegate to an `atom:explorer` subagent via the Agent tool
  to keep your own context focused on the experiment.

### 4. Hypothesize — ranked

List two to four candidate causes. Rank them by likelihood times cheapness-to-test, and for each one write
the observation that would confirm *or refute* it. A hypothesis without a refutation test is a guess.

| # | Hypothesis | Evidence so far | Cheapest test | Result |
|---|---|---|---|---|
| 1 | Coupon applied twice when the item is also on sale | Fails only for sale items | Log every `applyDiscount` call for SKU-42 | Confirmed: two calls |
| 2 | Rounding error in `toCents` | Totals off by 1 cent | Unit test `toCents(19.99)` | Refuted |
| 3 | Stale price cache | Started after cache deploy | Run with cache disabled | Not needed |

Test the top hypothesis first. When one is refuted, cross it out in the journal and revert any speculative
code you added for it — do not leave "might help" changes behind.

### 5. Prove the root cause

A cause is proven when you can switch the bug on and off by toggling it, or when instrumentation shows the bad
state *originating* there (not merely passing through). Keep asking "why?" until you reach the defect rather
than the symptom:

```
TypeError: Cannot read properties of undefined (reading 'email') in sendReceipt()
 why? order.customer is undefined
 why? loadOrder() no longer includes the customer relation
 why? commit a3f9c1e split the query and dropped `include: { customer: true }`   ← root cause
```

You are done with this step when the explanation accounts for every symptom, including why it did not fail
before (or why it fails only sometimes, or only in CI).

### 6. Minimal fix at the origin

Fix where the bad state is created, not where it finally explodes.

```ts
// Bad — silences the symptom; receipts now quietly go nowhere
await mailer.send(order.customer?.email ?? '', receipt);

// Good — restore the invariant at its source
const order = await db.order.findUnique({
  where: { id },
  include: { customer: true }, // dropped in a3f9c1e when the query was split
});
```

- Keep the diff to the fix. Refactors and style cleanups go in a separate change (`atom:refactoring`).
- Search for siblings: Grep for the same pattern elsewhere — the same mistake is often copy-pasted.
- Prefer making the invalid state unrepresentable (types, constructors, validation at the boundary) over
  adding defensive checks everywhere downstream.
- Symptom-masking moves to avoid unless they *are* the correct fix: catch-and-ignore, null checks at the crash
  site, retries, `sleep`, bumped timeouts, `// @ts-ignore`, `# type: ignore`, `.unwrap_or_default()`.
- If the root cause is how failures are handled (a swallowed error, a missing timeout, a retry of a
  non-idempotent call), fix the pattern with `atom:error-handling` rather than patching the one call site.

### 7. Regression test

- The test from step 2 must **fail without the fix and pass with it**. Prove the first half: temporarily revert
  the fix line (or `git stash push path/to/fixed/file`, run, `git stash pop`) and watch it fail. A test you have
  never seen fail proves nothing.
- Name the test after the behaviour, not the ticket: `test_receipt_is_sent_to_customer_email`, not `test_bug_1234`.
- For flaky bugs, rerun the loop from step 2 with the same iteration count; zero failures where there used
  to be a measurable rate is the evidence.
- Run the surrounding suite (the package, module, or full suite if fast) to catch collateral damage.

```python
def test_receipt_is_sent_to_customer_email(order_factory, fake_mailer):
    order = order_factory(customer__email="ada@example.com")
    send_receipt(order.id, mailer=fake_mailer)
    assert fake_mailer.sent[0].to == "ada@example.com"
```

### 8. Clean up

- Grep for your marker (`DBG-7f3`) and for stray `console.log`, `print(`, `dbg!(`, `fmt.Println`,
  `debugger;`, `breakpoint()`; remove them.
- Delete scratch scripts and temporary fixtures; `git bisect reset`; `git worktree remove` any worktree.
- Re-run the build or typecheck, and check `mcp__atom-ide__get_diagnostics` for the touched files.
- Read `git diff`: only the fix, the regression test, and intended changes should remain.

### 9. Report

```
**Symptom:** Order confirmation crashed with "Cannot read properties of undefined (reading 'email')".
**Root cause:** src/orders/load.ts:42 — the query split in a3f9c1e dropped the customer relation.
**Fix:** Restored `include: { customer: true }` (src/orders/load.ts:44).
**Verification:** New test tests/orders/receipt.test.ts:12 fails before / passes after; orders suite green (148 tests).
**Follow-ups:** src/invoices/load.ts:30 has the same pattern but is not affected today — worth a look.
```

## Quick map: symptom → bug class

| Symptom | Likely class | First move (details in references/techniques.md) |
|---|---|---|
| Fails sometimes; passes alone or under a debugger | Race, shared state, test order | Loop it; `-race`; shuffle; run alone vs suite |
| Last item missing, wrong by exactly one, crashes on empty input | Off-by-one / boundaries | Test sizes 0, 1, 2, max; check `<` vs `<=` |
| `undefined` / `None` / `nil` dereference | Null propagation | Trace the value backwards to where it was produced |
| Steps run out of order, value "not set yet", unhandled rejection | Async ordering | Audit every `await`; log with timestamps |
| Works locally, fails in CI/prod (or vice versa) | Environment / config | Diff versions, env vars, config, data, OS |
| Your change "has no effect", old behaviour persists | Caching / stale build | Prove the running code is the code you edited |
| Mojibake, wrong length, "identical" strings unequal | Encoding / normalization | Dump bytes or code points |
| Wrong only near midnight, DST, month end, other time zones | Time and dates | Pin the clock and TZ in a test |

## Pitfalls

- **Changing several things at once.** If the bug vanishes you will not know which change fixed it, and the
  others become unexplained noise. One variable per experiment.
- **Trusting stale state.** Old build output (`dist/`, `.next/`, `target/`), test caches, unsaved editors, a dev
  server that did not reload. When an edit seems to have no effect, first prove the running code is yours.
- **Believing the line number blindly.** Async stack traces, source maps, macros and inlining can point at the
  messenger, not the culprit.
- **Editing the test to make it pass.** Only valid when the test itself is wrong — say so explicitly in the report.
- **Endless fix attempts.** After three failed attempts, stop: re-read the evidence, list your assumptions and
  test the ones you have not verified, or ask the user for context you might be missing (logs, data, how to
  reproduce).
- **Leaving instrumentation behind.** Debug logs leak data and clutter diffs; the unique marker makes removal trivial.

## Definition of done

- [ ] Root cause identified, stated in one or two sentences, and cited as `path:line`.
- [ ] The explanation covers every observed symptom, including why it did not fail before.
- [ ] Fix is minimal and applied at the origin of the bad state.
- [ ] A regression test fails without the fix and passes with it (or the flaky loop now passes N/N).
- [ ] Surrounding tests, typecheck/build and diagnostics are clean.
- [ ] All instrumentation, scratch files, bisect state and worktrees removed.
- [ ] Report delivered with symptom, root cause, fix, verification and follow-ups.
