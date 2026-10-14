---
name: test-driven-development
description: Red-green-refactor workflow for writing code test-first - one failing test, the smallest code that passes, then refactor under green. Use when implementing a feature or bug fix with clear expected behaviour, adding tests to new or untested code, designing an API from the caller's side, or when the user asks for TDD or tests first. Covers test naming, arrange-act-assert, mocking only at boundaries, test doubles, async and property-based tests, coverage, and commands for vitest, jest, pytest, go test and cargo test.
---

# Test-Driven Development

Write the test before the code, watch it fail, make it pass with the simplest change, then clean up while
the tests stay green. The discipline pays off in three ways: every test is proven able to fail (so it actually
tests something), the API is designed from the caller's point of view, and progress happens in steps small
enough that a failure always points at the last few lines you touched.

## When to use

- New behaviour with a clear expected outcome: a function, endpoint, parser, reducer, CLI command.
- Bug fixes — reproduce the bug as a failing test first (pairs with `atom:systematic-debugging`).
- Code you are about to change that has no tests (write characterization tests first, see `atom:refactoring`).
- The user asks for TDD, tests first, or "make sure it's tested".

## When not to use

- Throwaway spikes to learn an API — spike, learn, delete, then test-drive the real thing.
- Pure visual/layout tweaks where a test would only restate the CSS.
- The project has no test setup and the user has not asked for one — propose a minimal setup and ask first.

## Before you write a test

1. **Find the test setup.** Glob for `vitest.config.*`, `jest.config.*`, `pyproject.toml` / `pytest.ini`,
   `go.mod`, `Cargo.toml`; Read the `test` scripts in `package.json`. Prefer the project's script
   (`npm test -- <args>`, `pnpm test <args>`, `yarn test <args>`) so you run with the same config and env as CI.
2. **Copy local conventions.** Read one or two existing tests near the code: file location
   (`foo.test.ts` beside the source, `tests/test_foo.py`, `foo_test.go`, `#[cfg(test)] mod tests`), helpers,
   fixtures, factories, assertion style. Consistency beats your personal preference.
3. **Get a baseline.** Run the relevant tests once. Note pre-existing failures so you neither "fix" them by
   accident nor get blamed for them.
4. **Write a test list** in TodoWrite: the behaviours and edge cases you intend to cover, simplest first.
   It keeps you to one test at a time and is your definition of scope.

Per-framework commands, mocking APIs, fake timers and property-based libraries are in
[references/frameworks.md](references/frameworks.md).

## The cycle

### Red — one failing test

Write exactly one test for the next item on the list, run it, and read the failure. It must fail **for the
right reason**: the assertion about the missing behaviour, not an import error, typo, or syntax error. If it
passes immediately, either the behaviour already exists (delete or keep it as a characterization test) or the
test is not testing what you think — investigate before moving on.

### Green — simplest code that passes

Write the least code that makes the test pass. Hard-coding a return value is legitimate when the next test
will force the generalization ("triangulation"). The point is to keep each step small; design arrives in the
refactor step.

### Refactor — clean up under green

Remove duplication, improve names, extract helpers — in both the code and the tests. Run the tests after
every change. Never add behaviour during refactoring; if you notice missing behaviour, add it to the test list.

Then pick the next item and repeat. Each green-and-refactored cycle is a natural commit point, if the user
wants commits; for bulk test work across many files, delegate batches to the `atom:test-engineer` subagent.

## Worked example (TypeScript + Vitest)

Test list: `"90s"` → 90 · `"2m"` → 120 · `"1h30m"` → 5400 · `""` throws · `"5x"` throws.

**Red:**

```ts
// src/duration.test.ts
import { describe, expect, it } from 'vitest';
import { parseDuration } from './duration';

describe('parseDuration', () => {
  it('parses a number of seconds', () => {
    expect(parseDuration('90s')).toBe(90);
  });
});
```

`npx vitest run src/duration.test.ts` fails with "Failed to resolve import" — wrong reason. Add a stub
`export function parseDuration(input: string): number { return 0; }`, rerun: `expected 0 to be 90`. That is
the right failure.

**Green:** `return Number(input.slice(0, -1));` passes. Silly, but the next test forces the real logic.

**Red → Green again** with `'2m'` → 120 and `'1h30m'` → 5400, then refactor to:

```ts
const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600 };

export function parseDuration(input: string): number {
  if (!/^(\d+[smh])+$/.test(input)) {
    throw new RangeError(`Invalid duration: "${input}"`);
  }
  let total = 0;
  for (const [, amount, unit] of input.matchAll(/(\d+)([smh])/g)) {
    total += Number(amount) * UNIT_SECONDS[unit];
  }
  return total;
}
```

**Edge cases as tests**, table-driven so adding a case is one line:

```ts
it.each(['', '5x', 'h1', '1.5h'])('rejects malformed input %j', (input) => {
  expect(() => parseDuration(input)).toThrow(RangeError);
});
```

The same tests in pytest:

```python
@pytest.mark.parametrize("text, seconds", [("90s", 90), ("2m", 120), ("1h30m", 5400)])
def test_parses_valid_durations(text, seconds):
    assert parse_duration(text) == seconds

@pytest.mark.parametrize("text", ["", "5x", "h1", "1.5h"])
def test_rejects_malformed_input(text):
    with pytest.raises(ValueError, match="Invalid duration"):
        parse_duration(text)
```

## Writing good tests

### Name the behaviour

A test name should read as a specification and tell you what broke without opening the file.

| Bad | Good |
|---|---|
| `test1`, `testParse`, `it('works')` | `it('returns 0 for an empty cart')` |
| `test_user` | `test_inactive_user_cannot_log_in` |
| `TestHandler` | `TestCreateOrder/rejects_negative_quantity` |
| `fn bug_1234()` | `fn total_ignores_cancelled_lines()` |

### Arrange, act, assert

One behaviour per test, one act, the three phases visually separated. Assertions on several properties of
the same result are fine; a second *act* means a second test.

```go
func TestApplyCoupon_PercentageOff(t *testing.T) {
    // Arrange
    cart := NewCart(Line{SKU: "A", PriceCents: 2000, Qty: 1})

    // Act
    err := cart.ApplyCoupon(Coupon{Code: "TEN", PercentOff: 10})

    // Assert
    if err != nil {
        t.Fatalf("ApplyCoupon: %v", err)
    }
    if got, want := cart.TotalCents(), 1800; got != want {
        t.Errorf("TotalCents() = %d, want %d", got, want)
    }
}
```

### Assert outcomes, not implementation

Test through the public API and assert what a caller can observe: return values, resulting state, effects at
the boundary (the HTTP request sent, the row written, the event published). Tests that assert *how* the work
was done break on every harmless refactor and train people to ignore them.

```ts
// Bad — pins internal call structure; breaks when the mapper is inlined
expect(repo.findById).toHaveBeenCalledWith(42);
expect(mapper.toDto).toHaveBeenCalledTimes(1);

// Good — pins behaviour
expect(await service.getUser(42)).toEqual({ id: 42, name: 'Ada' });
```

## What to mock: boundaries only

Replace things that are slow, nondeterministic, or outside your control: network and third-party APIs, the
clock, randomness and UUIDs, the file system (sometimes), environment variables, child processes, email/SMS,
payment providers. Do not mock your own domain logic or the unit under test — then you are testing the mock.

| Double | What it is | Typical use |
|---|---|---|
| Dummy | Passed in, never used | Filling a required parameter |
| Stub | Returns canned answers | Forcing a path ("the API returns 503") |
| Spy | Records calls, may delegate to the real thing | Checking that a notification was sent |
| Mock | Pre-programmed expectations about calls | Strict protocol checks; use sparingly |
| Fake | Working lightweight implementation | In-memory repository, fake clock, fake mailer |

Prefer fakes and stubs over call-expectation mocks: they let tests assert outcomes. Make boundaries injectable
so no patching magic is needed:

```ts
// Hard to test — reads the real clock
export const isExpired = (t: Token) => t.expiresAt < Date.now();

// Testable — the clock is a parameter with a production default
export const isExpired = (t: Token, now: number = Date.now()) => t.expiresAt < now;
```

```go
type Clock interface{ Now() time.Time }
type fixedClock struct{ t time.Time }
func (c fixedClock) Now() time.Time { return c.t }
// production: realClock{}; tests: fixedClock{t: time.Date(2026, 1, 31, 23, 59, 0, 0, time.UTC)}
```

In Python, `unittest.mock.patch` must target the name **where it is looked up**, not where it is defined:
`patch("myapp.billing.requests.post")` if `billing.py` does `import requests`; `patch("myapp.billing.post")`
if it does `from requests import post`. Use `autospec=True` so the mock rejects calls the real API would reject.

## Testing async code

- Always `await` (or return) the promise in the test. A forgotten `await` makes the test pass before the
  assertion runs.
- Assert rejections explicitly: `await expect(promise).rejects.toThrow(/timeout/)`;
  `with pytest.raises(TimeoutError):` around the awaited call.
- Never `sleep` to wait for something. Use fake timers for time-based logic and await an event, a channel or a
  polling helper with a deadline for everything else — sleeps make tests slow *and* flaky.

```ts
it('retries once after a timeout', async () => {
  vi.useFakeTimers();
  const call = vi.fn().mockRejectedValueOnce(new TimeoutError()).mockResolvedValueOnce('ok');

  const result = withRetry(call, { delayMs: 1000 });
  await vi.advanceTimersByTimeAsync(1000);

  await expect(result).resolves.toBe('ok');
  expect(call).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
```

Go waits on a channel with a `select` plus `time.After` deadline; Python uses `pytest-asyncio`
(`@pytest.mark.asyncio`) or AnyIO's plugin (`@pytest.mark.anyio`); Rust uses `#[tokio::test]`, with
`start_paused = true` to control time. Examples for each are in the reference file.

## Property-based tests

Example tests check the cases you thought of; property tests generate hundreds of inputs and shrink any
failure to a minimal counterexample. Reach for them when you can state an invariant:

- **Round-trip:** `decode(encode(x)) == x` (serializers, parsers, formatters).
- **Invariants:** output is sorted, has the same elements, never exceeds a limit, is idempotent.
- **Oracle:** compare against a simple, obviously-correct (slow) implementation.

```ts
import fc from 'fast-check';

it('round-trips every formatted duration', () => {
  fc.assert(
    fc.property(fc.nat({ max: 10_000_000 }), (seconds) => {
      expect(parseDuration(formatDuration(seconds))).toBe(seconds);
    }),
  );
});
```

```python
from hypothesis import given, strategies as st

@given(st.lists(st.integers()))
def test_my_sort_matches_builtin(xs):
    assert my_sort(xs) == sorted(xs)
```

When a property test finds a counterexample, copy it into a regular example test so it is pinned forever.

## Coverage is a signal, not a goal

Use coverage reports to find untested branches and error paths worth testing — then decide case by case.
Chasing a percentage produces assertion-free tests that execute code without checking it. 100% coverage does
not mean correct; 70% with sharp assertions on the risky paths beats 95% of smoke. If you want to know whether
tests would catch real bugs, mutation testing (StrykerJS, mutmut, cargo-mutants) answers that directly.

## Pitfalls

- **Writing many tests before any code.** You lose the tight feedback loop; failures pile up and the design
  hardens before you learn anything. One red at a time.
- **Never seeing red.** A test written after the code, never observed failing, may assert nothing useful.
  Break the code on purpose for a moment if you must.
- **Over-mocking.** If the test setup is mostly mock configuration, the design probably needs a seam — or the
  test belongs one level up as an integration test.
- **Shared mutable state.** Module-level fixtures, a database not reset between tests, leaked env vars or
  global mocks cause order-dependent failures. Restore in `afterEach` / fixtures / `t.Cleanup`.
- **Snapshot tests as a crutch.** Large snapshots get re-approved without reading. Keep them small and
  intentional, or assert specific fields.
- **Changing the test to make it pass.** Only when the test is wrong — and then say so.
- **Asserting log output or error message prose** when an error type or code is available.

## Definition of done

- [ ] Every item on the test list is covered; each test was seen failing for the right reason before passing.
- [ ] Tests follow the project's conventions (location, naming, helpers) and read as a specification.
- [ ] Mocks only at boundaries; no sleeps; no order dependence (passes when run alone and shuffled).
- [ ] Code and tests refactored; no dead code or commented-out tests.
- [ ] Relevant suite, typecheck and linter pass; `mcp__atom-ide__get_diagnostics` is clean for touched files.
- [ ] Report lists the behaviours covered and the command to run the tests.
