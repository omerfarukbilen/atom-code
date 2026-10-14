# Test framework reference

Commands and idioms for the frameworks the `test-driven-development` skill uses most. Always prefer the
project's own script and config when one exists (`npm test -- <args>`, `pnpm test <args>`, `yarn test <args>`,
`make test`, `just test`, `tox`, `nox`) — CI runs those, not your hand-rolled command. Tools marked
*(plugin)* are separate packages; check the project's dependencies before relying on them.

- [Detecting the runner](#detecting-the-runner)
- [Vitest](#vitest) · [Jest](#jest) · [Node's built-in test runner](#nodes-built-in-test-runner)
- [pytest](#pytest)
- [Go](#go)
- [Rust](#rust)

## Detecting the runner

| Evidence | Runner |
|---|---|
| `vitest` in devDependencies, `vitest.config.*`, or `test` block in `vite.config.*` | Vitest |
| `jest` in devDependencies, `jest.config.*`, or `"jest"` key in package.json | Jest |
| `"test": "node --test"` in package.json | Node test runner |
| `[tool.pytest.ini_options]` in pyproject.toml, `pytest.ini`, `conftest.py` | pytest |
| `tests/test_*.py` using `unittest.TestCase` and no pytest config | unittest (pytest can still run these) |
| `*_test.go` files | `go test` |
| `Cargo.toml` | `cargo test` (or `cargo nextest run` if `.config/nextest.toml` exists) |

## Quick matrix

| Task | Vitest | Jest | pytest | Go | Rust |
|---|---|---|---|---|---|
| Run all once | `npx vitest run` | `npx jest` | `pytest` | `go test ./...` | `cargo test` |
| One file / package | `npx vitest run src/a.test.ts` | `npx jest src/a.test.ts` | `pytest tests/test_a.py` | `go test ./internal/a` | `cargo test --test api` (tests/api.rs) |
| One test by name | `-t "parses seconds"` | `-t "parses seconds"` | `tests/test_a.py::test_x` or `-k "x and not slow"` | `-run '^TestX$'` | `cargo test parses_seconds` |
| Stop at first failure | `--bail 1` | `--bail` | `-x` | `-failfast` | default stops after the first failing test binary |
| Verbose output | `--reporter=verbose` | `--verbose` | `-vv` | `-v` | `-- --nocapture` |
| Watch mode | `npx vitest` | `npx jest --watch` | *(plugin)* | — | `cargo watch -x test` *(plugin)* |
| Coverage | `--coverage` *(needs @vitest/coverage-v8)* | `--coverage` | `--cov=pkg` *(pytest-cov)* | `-cover`, `-coverprofile=c.out` | `cargo llvm-cov` *(plugin)* |
| Shuffle order | `--sequence.shuffle` | `--randomize` | automatic with pytest-randomly *(plugin)* | `-shuffle=on` | — |

Watch modes never exit — do not start them through the Bash tool unless you run them in the background.

---

## Vitest

```bash
npx vitest run                                 # single run (plain `vitest` watches in a terminal)
npx vitest run src/cart                        # path filter
npx vitest run -t "applies coupon"             # test-name filter (regex)
npx vitest related src/cart.ts --run           # tests that import the given source files
npx vitest run --coverage                      # requires @vitest/coverage-v8 or @vitest/coverage-istanbul
```

Idioms:

```ts
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';

test.each([
  ['90s', 90],
  ['2m', 120],
])('parseDuration(%s) = %i', (input, expected) => {
  expect(parseDuration(input)).toBe(expected);
});

// Spies and stubs
const send = vi.fn().mockResolvedValue({ ok: true });
vi.spyOn(console, 'warn').mockImplementation(() => {});
afterEach(() => vi.restoreAllMocks());

// Module mocks: Vitest hoists vi.mock above the imports, so the import below receives the mock
import { sendMail } from './mailer';
vi.mock('./mailer', () => ({ sendMail: vi.fn() }));
vi.mocked(sendMail).mockResolvedValue(undefined);

// Fake timers and the clock
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
vi.setSystemTime(new Date('2026-01-31T23:59:00Z'));
await vi.advanceTimersByTimeAsync(1_000);      // async variant also flushes promise callbacks

// Async assertions
await expect(fetchUser(1)).rejects.toThrow(/not found/);
await expect.poll(() => queue.size, { timeout: 2_000 }).toBe(0);
await vi.waitFor(() => expect(spy).toHaveBeenCalled());
```

Environment: DOM tests need `environment: 'jsdom'` or `'happy-dom'` in the config (or a
`// @vitest-environment jsdom` comment at the top of the file).

## Jest

```bash
npx jest                                       # all tests
npx jest src/cart.test.ts -t "applies coupon"  # file + name filter
npx jest --findRelatedTests src/cart.ts        # tests affected by a source file
npx jest --onlyChanged                         # tests related to uncommitted changes (git)
npx jest --runInBand                           # serial; helps debug shared-state failures
npx jest --detectOpenHandles                   # find what keeps the process alive
npx jest --clearCache                          # when transforms behave stale
npx jest --coverage
```

Idioms mirror Vitest with the `jest` global: `jest.fn()`, `jest.spyOn()`, `jest.mock('./mailer')`,
`jest.useFakeTimers()`, `jest.setSystemTime()`, `jest.advanceTimersByTime()`,
`await jest.advanceTimersByTimeAsync()` (Jest 29.5+), `jest.restoreAllMocks()`, `test.each`.
For native ES modules, `jest.mock` hoisting does not apply — use `jest.unstable_mockModule` followed by a
dynamic `await import()`.

## Node's built-in test runner

```bash
node --test                                    # finds *.test.js, test/*.js, etc.
node --test --test-name-pattern="applies coupon"
node --test --experimental-test-coverage
```

```js
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

it('sends one email', async () => {
  const send = mock.fn(async () => ({ ok: true }));
  await notify({ send }, 'ada@example.com');
  assert.equal(send.mock.callCount(), 1);
});

mock.timers.enable({ apis: ['setTimeout'] });
mock.timers.tick(1_000);
```

---

## pytest

```bash
pytest                                         # all tests
pytest tests/test_cart.py::test_applies_coupon # one test
pytest tests/test_cart.py::TestCart::test_total
pytest -k "coupon and not slow"                # keyword expression
pytest -x --lf                                 # stop at first failure, rerun last failures first
pytest -vv -s                                  # verbose, show print output (disable capture)
pytest -l --tb=long                            # show locals in tracebacks
pytest --durations=10                          # slowest tests
pytest --cov=myapp --cov-branch --cov-report=term-missing   # pytest-cov
python -m pytest ...                           # same, but adds the CWD to sys.path
```

Idioms:

```python
import pytest

@pytest.fixture
def cart():
    c = Cart()
    yield c          # teardown code after yield runs even if the test fails
    c.close()

@pytest.mark.parametrize("qty, expected", [(1, 2000), (3, 6000), pytest.param(0, 0, id="empty")])
def test_total(cart, qty, expected):
    cart.add("A", qty=qty, price_cents=2000)
    assert cart.total_cents == expected

def test_rejects_unknown_coupon(cart):
    with pytest.raises(InvalidCoupon, match="NOPE"):
        cart.apply_coupon("NOPE")

def test_reads_api_key(monkeypatch, tmp_path):
    monkeypatch.setenv("API_KEY", "test-key")
    config_file = tmp_path / "config.toml"
    config_file.write_text('region = "eu"\n', encoding="utf-8")
    assert load_config(config_file).api_key == "test-key"

assert 0.1 + 0.2 == pytest.approx(0.3)
```

Built-in fixtures worth knowing: `tmp_path`, `monkeypatch`, `capsys` (captured stdout/stderr), `caplog`
(log records), `request`. Shared fixtures go in `conftest.py`.

Mocking with `unittest.mock`:

```python
from unittest.mock import AsyncMock, create_autospec, patch

# Patch where the name is looked up (the module under test), not where it is defined
with patch("myapp.billing.stripe_client", autospec=True) as client:
    client.charge.return_value = {"status": "succeeded"}
    charge_order(order)
    client.charge.assert_called_once()

fetch = AsyncMock(return_value={"id": 1})
repo = create_autospec(UserRepository, instance=True)
```

Time: `freezegun` (`@freeze_time("2026-01-31 23:59")`) or `time-machine` *(plugins)* — or inject a clock.

Async (pick what the project uses):

```python
# pytest-asyncio
@pytest.mark.asyncio
async def test_fetch_user(fake_client):
    assert (await fetch_user(1, client=fake_client)).name == "Ada"
# with `asyncio_mode = "auto"` in config the marker is optional

# AnyIO's pytest plugin (installed with anyio)
@pytest.mark.anyio
async def test_fetch_user_anyio(): ...
```

Property-based (Hypothesis):

```python
from hypothesis import given, strategies as st

@given(st.text())
def test_slug_round_trip_is_stable(s):
    assert slugify(slugify(s)) == slugify(s)        # idempotence

@given(st.dictionaries(st.text(), st.integers()))
def test_json_round_trip(d):
    assert json.loads(json.dumps(d)) == d
```

unittest-only projects: `python -m unittest tests.test_cart.TestCart.test_total -v`.

---

## Go

```bash
go test ./...                                  # all packages
go test ./internal/cart -run '^TestTotal$' -v  # one test (regex, anchor it)
go test ./internal/cart -run 'TestTotal/empty_cart'   # subtest; spaces in names become underscores
go test ./... -count=1                         # bypass the test result cache
go test ./... -race                            # data race detector
go test ./... -failfast -shuffle=on -timeout=60s
go test ./... -short                           # tests can skip slow paths via testing.Short()
go test ./... -coverprofile=cover.out && go tool cover -func=cover.out
go test -run '^$' -bench=. -benchmem ./internal/cart   # benchmarks only
go test -fuzz=FuzzParseDuration -fuzztime=30s ./internal/duration
```

Idioms:

```go
func TestParseDuration(t *testing.T) {
    tests := []struct {
        name    string
        in      string
        want    int
        wantErr bool
    }{
        {name: "seconds", in: "90s", want: 90},
        {name: "hours and minutes", in: "1h30m", want: 5400},
        {name: "empty", in: "", wantErr: true},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := ParseDuration(tt.in)
            if (err != nil) != tt.wantErr {
                t.Fatalf("ParseDuration(%q) error = %v, wantErr %v", tt.in, err, tt.wantErr)
            }
            if got != tt.want {
                t.Errorf("ParseDuration(%q) = %d, want %d", tt.in, got, tt.want)
            }
        })
    }
}
```

- `t.Helper()` in assertion helpers so failures point at the caller; `t.Cleanup(fn)` for teardown;
  `t.TempDir()` for files; `t.Setenv()` for env vars (not allowed in tests that call `t.Parallel()`).
- `net/http/httptest`: `httptest.NewRecorder()` for handlers, `httptest.NewServer(handler)` for clients.
- `testing/fstest.MapFS` for code that accepts an `fs.FS`.
- Waiting for asynchronous results without sleeping — select on the channel with a deadline:
  ```go
  select {
  case got := <-results:
      if got != want {
          t.Fatalf("got %v, want %v", got, want)
      }
  case <-time.After(2 * time.Second):
      t.Fatal("timed out waiting for result")
  }
  ```
- Fakes over mocks: define small interfaces at the consumer and hand-write fakes. Many projects use
  `github.com/stretchr/testify` (`require.NoError`, `assert.Equal`) — follow the project.
- Property-based: native fuzzing (`func FuzzX(f *testing.F)` with `f.Add` seeds and `f.Fuzz`), the standard
  `testing/quick.Check`, or `pgregory.net/rapid` *(module)*.
- Golden files: keep expected output in `testdata/` (ignored by the go tool) and add an `-update` flag to
  regenerate them deliberately.

---

## Rust

```bash
cargo test                                     # unit, integration and doc tests
cargo test parses_seconds                      # substring filter on test path
cargo test -- --exact duration::tests::parses_seconds
cargo test -- --nocapture                      # show println! output (or --show-output for passing tests)
cargo test -- --test-threads=1                 # serial; helps with shared-state failures
cargo test --lib                               # unit tests only
cargo test --test api                          # tests/api.rs only
cargo test --doc                               # doc tests only
cargo test -p my_crate                         # one workspace member
cargo test -- --ignored                        # run #[ignore] tests (or --include-ignored for all)
cargo test --no-fail-fast                      # keep going after a failing test binary
```

Idioms:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hours_and_minutes() {
        assert_eq!(parse_duration("1h30m").unwrap(), 5400);
    }

    #[test]
    fn rejects_empty_input() {
        assert!(matches!(parse_duration(""), Err(DurationError::Empty)));
    }

    #[test]
    #[should_panic(expected = "index out of bounds")]
    fn panics_on_bad_index() { /* ... */ }

    #[test]
    fn returns_result() -> Result<(), Box<dyn std::error::Error>> {
        let cfg = Config::from_str("region = \"eu\"")?;
        assert_eq!(cfg.region, "eu");
        Ok(())
    }
}
```

Async with Tokio (requires the `macros` and `rt` features; `start_paused` needs `test-util`):

```rust
#[tokio::test(start_paused = true)]
async fn retries_after_delay() {
    let handle = tokio::spawn(with_retry(flaky_call));
    tokio::time::advance(std::time::Duration::from_secs(1)).await;
    assert_eq!(handle.await.unwrap(), Ok("ok"));
}
```

Property-based with `proptest` *(crate)*:

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn duration_round_trips(secs in 0u64..10_000_000) {
        prop_assert_eq!(parse_duration(&format_duration(secs)).unwrap(), secs);
    }
}
```

Test doubles: define a trait at the boundary and write a fake struct in the test module; `mockall`
*(crate)* generates mocks if the project already uses it. Coverage: `cargo llvm-cov` or
`cargo tarpaulin` *(plugins)*. `cargo nextest run` *(plugin)* is a faster runner with per-test isolation.
