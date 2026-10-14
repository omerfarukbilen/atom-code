---
description: Write tests test-first for a behaviour, add tests for existing code, or run and triage the suite - then report results and coverage gaps
argument-hint: "[behaviour, file or symbol to test | run [path] | blank for current changes]"
---

Work on tests using the `atom:test-driven-development` skill (load it with the Skill tool first; its
`references/frameworks.md` has commands for Vitest, Jest, the Node test runner, pytest, Go and Rust).

Request from the user: $ARGUMENTS

## 1. Decide what kind of job this is

- **A behaviour that does not exist yet** ("rejects expired coupons", "parse ISO week dates") → strict TDD:
  red, green, refactor, one behaviour at a time.
- **Existing code** (a file, function, class or module) → add tests that pin its current, intended behaviour.
  If you find behaviour that looks like a bug, do not encode it in a test as correct - report it.
- **`run`, optionally with a path** → run the suite (or that part of it), then triage every failure: is the
  code wrong, the test outdated, or the test brittle? Report before changing anything substantial.
- **Empty** → tests for the current uncommitted changes (`git status --short`, `git diff`). If there are no
  changes, run the full suite and report.

If the target is ambiguous (several symbols match, unclear expected behaviour), ask with AskUserQuestion.

## 2. Learn the project's testing conventions first

Find the runner and the command CI uses (`package.json` scripts, `vitest.config.*`, `jest.config.*`,
`pyproject.toml`, `pytest.ini`, `conftest.py`, `go.mod`, `Cargo.toml`, `.github/workflows/`). Read two or three
existing tests near the code: location, naming, fixtures and factories, how they fake time, network and the
database. New tests must look like they belong.

## 3. Write tests (TDD loop)

For each behaviour:

1. **Red** - write one test named as a sentence about behaviour (`rejects coupons past their expiry date`), in
   arrange-act-assert form, asserting what a caller can observe. Run only that test and confirm it fails for
   the right reason: an assertion failure, not an import or syntax error.
2. **Green** - write the smallest code that makes it pass (only when implementing new behaviour). Run it again.
3. **Refactor** - clean up code and test under green; run the file's tests.

For tests of existing code, prove each new test can fail: break the code under test briefly with Edit (invert
a condition, change a constant), watch the test fail, restore the original exactly and confirm with
`git diff -- <file>`.

Mock only at boundaries (network, clock, randomness, filesystem, third-party services); prefer the project's
existing fakes. Cover the error paths and boundaries (empty, one, many, max, invalid input), not only the happy
path.

Narrow commands while iterating, for example:

```bash
npx vitest run src/coupons/validate.test.ts -t "expiry"
npx jest src/coupons/validate.test.ts -t "expiry"
pytest tests/test_coupons.py::test_rejects_expired_coupon -x -q
go test ./coupons -run TestRejectsExpiredCoupon -count=1
cargo test rejects_expired_coupon
```

Never start a watch mode in the foreground (it never exits).

## 4. Finish

Run the tests for the whole touched package or module (the full suite if it is fast), check
`mcp__atom-ide__get_diagnostics` for the test files, and run coverage if the project already has the tooling
(do not install any).

Never get to green by skipping tests, deleting them, loosening assertions, raising timeouts or updating
snapshots without reviewing each diff.

For a large amount of test work across many files, you may delegate parts to the `atom:test-engineer`
subagent with the Agent tool and verify what it returns.

## 5. Report

```markdown
**Result:** <e.g. "6 tests added, all passing; suite 214 passed, 0 failed">
**Tests:**
- path:line — behaviour covered
**Commands run:** `<command>` → <passed/failed counts>
**Bugs found:** path:line — description (with the test that demonstrates it)
**Coverage gaps (highest risk first):** path:line-range — what is untested and why it matters
```
