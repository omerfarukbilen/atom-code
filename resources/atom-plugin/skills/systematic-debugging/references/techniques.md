# Debugging techniques

Reference for the `systematic-debugging` skill. Part 1 is the isolation toolbox; Part 2 covers bug classes
with symptoms, how to confirm, and typical fixes. Read only the section you need.

- [Part 1 — Isolation toolbox](#part-1--isolation-toolbox)
  - [git bisect in depth](#git-bisect-in-depth)
  - [Shrinking inputs (delta debugging)](#shrinking-inputs-delta-debugging)
  - [Logging that answers questions](#logging-that-answers-questions)
  - [Scripted debuggers and runtime flags](#scripted-debuggers-and-runtime-flags)
  - [System-level observation](#system-level-observation)
- [Part 2 — Bug classes](#part-2--bug-classes)
  1. [Race conditions and shared state](#1-race-conditions-and-shared-state)
  2. [Off-by-one and boundaries](#2-off-by-one-and-boundaries)
  3. [Null, undefined, None, nil](#3-null-undefined-none-nil)
  4. [Async ordering](#4-async-ordering)
  5. [Environment and configuration](#5-environment-and-configuration)
  6. [Caching and stale state](#6-caching-and-stale-state)
  7. [Encoding and text](#7-encoding-and-text)
  8. [Time, dates and time zones](#8-time-dates-and-time-zones)
  9. [Numbers and precision](#9-numbers-and-precision)

---

## Part 1 — Isolation toolbox

### git bisect in depth

Bisect finds the first bad commit in `log2(n)` steps — about 10 builds for 1,000 commits.

```bash
# Isolate from the user's working tree (bisect moves HEAD)
git worktree add ../bisect-wt HEAD
cd ../bisect-wt

git bisect start
git bisect bad                     # current commit is bad
git bisect good 3e1f0a2            # verify this one is good first, by actually running the test there

# Automatic: the command's exit status decides
git bisect run ./scratch/repro.sh
#   exit 0        → good
#   exit 125      → skip (does not build, unrelated breakage)
#   exit 1..127   → bad (except 125)
#   exit >= 128   → abort bisect

git bisect log                     # record of decisions, useful for the journal
git bisect reset                   # back to the original HEAD
cd - && git worktree remove ../bisect-wt
```

A robust repro script distinguishes "the bug" from "something else broke":

```bash
#!/usr/bin/env sh
npm ci --silent || exit 125                      # cannot build this commit → skip it
npx vitest run src/cart.test.ts -t "applies coupon" >/tmp/out.txt 2>&1
if grep -q "expected 1800 to be 1900" /tmp/out.txt; then exit 1; fi   # the specific failure
exit 0
```

Tips:
- Many merge commits? `git bisect start --first-parent` follows only the mainline.
- Bisecting a dependency upgrade instead of your code: bisect the *dependency's* versions by hand
  (install the midpoint version, test, halve again).
- If the "good" commit turns out to be bad too, the regression is older — or the test is wrong. Re-verify both ends.

### Shrinking inputs (delta debugging)

When a large input triggers the bug, repeatedly remove chunks while it still fails:

1. Split the input into halves. Keep whichever half still fails.
2. If neither half fails alone, the bug needs pieces of both — split into quarters and try removing one
   quarter at a time.
3. Stop when removing anything makes the failure disappear. That input is your minimal repro and usually
   points straight at the cause (a specific character, a duplicate key, an empty field).

Property-based testing libraries (fast-check, Hypothesis, proptest) do this shrinking automatically once
you can express "this property should hold" — see `atom:test-driven-development`.

### Logging that answers questions

- Log to answer a specific question ("is `applyDiscount` called twice for SKU-42?"), not "to see what happens".
- Include identity and ordering: request/job id, entity id, monotonic timestamp, thread/goroutine/task id.
- Print representations, not just values: `JSON.stringify(x)`, `repr(x)`, `%#v` in Go, `{:?}` in Rust.
  They expose `null` vs `"null"`, `1` vs `"1"`, trailing whitespace and invisible characters.
- Tag every temporary line with one unique marker (`[DBG-7f3]`) so Grep finds them all at cleanup.
- Log both sides of a boundary (before the call, after the call, on the error path). A missing "after"
  line is itself evidence — the call hung or threw.
- Existing log frameworks often have a debug level you can switch on instead of adding prints:
  `DEBUG=express:*` (the `debug` package), `RUST_LOG=my_crate=debug` (env_logger / tracing EnvFilter),
  `logging.basicConfig(level=logging.DEBUG)` in Python, `LOG_LEVEL`-style env vars in the app's own config.

### Scripted debuggers and runtime flags

The Bash tool has no interactive TTY, so drive debuggers non-interactively or rely on runtime flags.

| Stack | Useful non-interactive options |
|---|---|
| Node.js | `node --trace-warnings app.js`, `node --trace-uncaught app.js`, `node --stack-trace-limit=100 app.js`, `node --unhandled-rejections=strict app.js`; `console.trace()` prints a stack at that point; `NODE_DEBUG=http,net` for core-module internals |
| Python | `python -X faulthandler app.py` (dumps the Python traceback on segfaults and fatal errors; for hangs call `faulthandler.dump_traceback_later(30)` early in the program), `python -X dev` (extra runtime checks, shows ResourceWarnings), `python -W error` (warnings become exceptions), `traceback.print_stack()`; `pytest -x -vv --tb=long -l` (`-l` shows local variables in tracebacks) |
| Go | `GOTRACEBACK=all go run .` (all goroutine stacks on panic), `go test -race`, `go vet ./...`; `debug.PrintStack()` from `runtime/debug`; sending SIGQUIT (`kill -QUIT pid`) to a running Go program dumps every goroutine — ideal for hangs and deadlocks |
| Rust | `RUST_BACKTRACE=1` (or `full`) for panic backtraces, `dbg!(expr)` prints file:line and value and returns the value, `cargo test -- --nocapture`, `cargo miri test` (nightly, detects undefined behaviour in unsafe code) |
| Native | `gdb -batch -ex run -ex bt --args ./app arg1` prints a backtrace at the crash; `-fsanitize=address` / `-fsanitize=thread` builds for memory and data-race bugs |

If the user wants to step through code interactively, set up the launch configuration or the breakpoint for
them and explain what to inspect — do not try to drive an interactive session through Bash.

### System-level observation

- `curl -v https://host/path` shows request/response headers, redirects and TLS details.
- `strace -f -e trace=file,network ./app` (Linux) shows which files and sockets a process actually touches —
  great for "it reads the wrong config file". macOS has `dtruss` (requires disabling SIP), usually not worth it.
- `lsof -i :3000` finds who holds a port; `ps aux | grep app` checks for an old process still serving requests.
- `env | sort > a.txt` in both environments, then `diff a.txt b.txt` — the fastest config comparison.

---

## Part 2 — Bug classes

### 1. Race conditions and shared state

**Symptoms:** intermittent failures; passes alone, fails in the suite; disappears when you add logging or a
debugger (timing changed); fails more on CI (different core count, slower disks); corrupted or lost updates.

**Confirm:**
- Run many iterations and measure the failure rate (`-count=500`, a shell loop).
- Use race detectors: `go test -race`, ThreadSanitizer for C/C++ (`-fsanitize=thread`).
- Widen the window: insert a short sleep between the suspected "check" and "act" steps. If the failure rate
  jumps to near 100%, you have found the interleaving. Remove the sleep afterwards.
- For test-order dependence: run the test alone, then the whole file, then shuffled.

**Typical defects and fixes:**

Check-then-act across an `await` (JavaScript is single-threaded but async code still interleaves):

```ts
// Bad — two concurrent requests both see "no session" and both create one
if (!(await cache.get(userId))) {
  await cache.set(userId, await createSession(userId));
}

// Good — deduplicate in-flight work
const inflight = new Map<string, Promise<Session>>();
function getSession(userId: string): Promise<Session> {
  let p = inflight.get(userId);
  if (!p) {
    p = createSession(userId).finally(() => inflight.delete(userId));
    inflight.set(userId, p);
  }
  return p;
}
```

Non-atomic read-modify-write (the GIL does not make `+=` atomic across threads in Python):

```python
# Bad
counter += 1
# Good
with lock:
    counter += 1
```

Lost updates in a database:

```sql
-- Bad: read in app, add, write back → concurrent writers overwrite each other
-- Good: let the database do it atomically
UPDATE accounts SET balance = balance - :amount WHERE id = :id AND balance >= :amount;
-- or optimistic concurrency
UPDATE docs SET body = :body, version = version + 1 WHERE id = :id AND version = :expected_version;
```

Go — `WaitGroup.Add` inside the goroutine races with `Wait`; maps are not safe for concurrent writes:

```go
// Bad
for _, j := range jobs {
    go func() { wg.Add(1); defer wg.Done(); process(j) }()
}
// Good
for _, j := range jobs {
    wg.Add(1)
    go func() { defer wg.Done(); process(j) }()
}
```

Shared test state: module-level singletons, a shared temp directory, a database not reset between tests,
`process.env` mutations, global mocks not restored. Fix with per-test fixtures (`tmp_path`, `t.TempDir()`),
transactions rolled back per test, and restoring mocks in `afterEach`.

### 2. Off-by-one and boundaries

**Symptoms:** first or last element missing or duplicated; crash on empty input; pagination skips or repeats
an item; "works for most inputs".

**Confirm:** write a table test over sizes 0, 1, 2, n-1, n, n+1 and the type's limits.

**Common sources:**
- `<` vs `<=` in loop bounds; inclusive vs exclusive ranges (`range(a, b)` and Rust `a..b` exclude `b`;
  `a..=b` includes it; SQL `BETWEEN` is inclusive on both ends).
- `slice(start, end)` (end exclusive) vs `substr(start, length)` in JavaScript.
- Unsigned underflow: `v.len() - 1` on an empty `Vec` panics in a Rust debug build and wraps to a huge
  number in release. Use `v.last()`, `checked_sub`, or `saturating_sub`.
- Pagination with `OFFSET` while rows are inserted shifts pages — use keyset pagination (`WHERE id > :last_id`).
- Fence-post errors in time ranges: is the end timestamp inclusive? Prefer half-open intervals `[start, end)`.

```go
// Bad — panics on empty input
last := items[len(items)-1]
// Good
if len(items) == 0 {
    return ErrEmpty
}
last := items[len(items)-1]
```

### 3. Null, undefined, None, nil

**Symptoms:** `TypeError: Cannot read properties of undefined`, `AttributeError: 'NoneType' object has no
attribute`, `nil pointer dereference`, `called Option::unwrap() on a None value`.

**Confirm:** the crash site is rarely the defect. Trace the value backwards: where was it produced, and on
which path can that producer return nothing? Grep for every assignment to the field.

**Common sources:**
- A lookup that can miss (`Array.find`, `dict.get`, `Map.get`, ORM `first()`, `findUnique`) whose miss case
  was never handled.
- An optional relation not loaded (ORM `include`/`select_related`/`preload` missing).
- Partial objects from JSON or an external API where the field is optional or renamed.
- Initialization order: a field read before an async init completed, or a React state read before data loads.
- Go: a typed nil pointer stored in an interface is not `== nil`:
  ```go
  func find() error {
      var e *NotFoundError = nil
      return e          // non-nil error interface holding a nil pointer → caller's `err != nil` is true
  }
  // Fix: return nil explicitly on the success path.
  ```

**Fix at the source:** validate external data at the boundary (zod, pydantic, serde), make the type honest
(`User | undefined`, `Optional[User]`, `Option<User>`), and handle the miss where it can occur. Avoid
sprinkling `?.` and `if x is not None` downstream — that converts a loud crash into silent wrong behaviour.

### 4. Async ordering

**Symptoms:** values are "not set yet"; steps happen in the wrong order; tests pass but production
intermittently misbehaves; `UnhandledPromiseRejection`; Python `RuntimeWarning: coroutine '...' was never
awaited`; a process exits before work finishes.

**Confirm:** log entry/exit of each async step with a timestamp and an id; check every call site of an async
function for a missing `await`. In TypeScript, the `@typescript-eslint/no-floating-promises` lint rule finds
them mechanically when the project uses typescript-eslint.

**Common defects:**

```ts
// Bad — forEach ignores returned promises; the function returns before any save completes
items.forEach(async (item) => { await save(item); });

// Good — sequential when order matters
for (const item of items) await save(item);
// Good — concurrent when it does not
await Promise.all(items.map(save));
```

```python
# Bad — task may be garbage-collected before it finishes; exceptions vanish
asyncio.create_task(send_email(user))

# Good — keep a reference and observe the result
task = asyncio.create_task(send_email(user))
background_tasks.add(task)
task.add_done_callback(background_tasks.discard)
```

- Event listener registered after the event already fired (subscribe before you trigger).
- Blocking calls inside async code (`time.sleep`, `requests.get` in `async def`; `std::thread::sleep` or
  synchronous file IO in a Tokio task) stall the whole event loop.
- Rust futures are lazy: a future that is never `.await`ed (or spawned) never runs. Holding a
  `std::sync::Mutex` guard across `.await` can deadlock — drop the guard first or use `tokio::sync::Mutex`.
- React: an effect fires with a stale closure, or a slow earlier request resolves after a faster later one
  and overwrites newer state — ignore stale responses with an `AbortController` or a "cancelled" flag in the
  effect cleanup.

### 5. Environment and configuration

**Symptoms:** "works on my machine"; only fails in CI, Docker or production; fails for one teammate;
started after an OS, runtime or dependency update.

**Confirm — diff everything that can differ:**
- Runtime and tool versions: `node -v`, `python -V`, `go version`, `rustc -V`, plus the lockfile.
  `.nvmrc`, `.python-version`, `.tool-versions`, `rust-toolchain.toml` and `go.mod`'s `go` line say what is expected.
- Environment variables: missing vars often become the string `"undefined"` in JavaScript template strings,
  or `None` in Python; env values are always strings, so `"false"` is truthy.
- Config precedence: which `.env`, config file and CLI flag wins? Print the effective config at startup
  (secrets redacted).
- Working directory: relative paths resolve against the process CWD, not the source file. Use
  `import.meta.dirname` / `__dirname`, `Path(__file__).parent`, or explicit config.
- File system: macOS and Windows are case-insensitive by default, Linux is not — `import './Utils'` works on a
  laptop and fails in CI. Windows paths and CRLF line endings break shell scripts and snapshot tests.
- Locale and time zone: `TZ`, `LANG`/`LC_ALL` change date formatting, sorting and number parsing.
- CI specifics: `CI=true` changes the behaviour of many tools; containers may run as a different user; fewer
  cores change parallelism and expose races.

### 6. Caching and stale state

**Symptoms:** your fix has no effect; the old behaviour persists; behaviour differs after a restart; one
user sees stale data.

**First prove the running code is the code you edited** — add a temporary marker log at the top of the
changed function. If it does not print, you are fighting a cache or running a different build.

| Layer | How to bust it |
|---|---|
| Build output | Delete `dist/`, `build/`, `.next/`, `out/`; `tsc --build --clean`; `cargo clean -p crate`; `go clean -cache` |
| Test runner | `jest --clearCache`; `go test -count=1`; pytest `--cache-clear` |
| Dev server / watcher | Restart it; check it watches the right directory |
| Package manager | Reinstall from the lockfile (`npm ci`, `pip install -r ...`, `poetry install`); check for duplicate package versions (`npm ls pkg`) |
| Docker | `docker build --no-cache`; check `.dockerignore` and `COPY` order |
| HTTP / CDN / browser | `Cache-Control` headers, ETags, service workers; hard reload; `curl -v` to see cache headers |
| Application memoization | Cache key missing a parameter, missing invalidation on write, TTL too long |
| React | `useMemo`/`useCallback`/`useEffect` dependency arrays missing a value → stale closure |

Application-level cache bugs are usually a cache key that omits something the result depends on
(locale, user, tenant, feature flag), or a write path that forgets to invalidate.

### 7. Encoding and text

**Symptoms:** mojibake (`Ã©` instead of `é`), `UnicodeDecodeError`, string lengths that disagree between
systems, "identical" strings that compare unequal, CSV columns shifted, JSON ids that change value.

**Confirm — look at the bytes, not the glyphs:**

```bash
printf '%s' "$value" | xxd | head
```
```python
print(repr(s), s.encode("utf-8"), [hex(ord(c)) for c in s])
```
```ts
console.log([...s].map((c) => c.codePointAt(0)!.toString(16)));
```

**Common defects:**
- Implicit platform encoding: Python's `open(path)` uses the locale encoding on many systems (notably
  Windows) — pass `encoding="utf-8"`. Node `fs.readFileSync(path)` returns a Buffer unless you pass `'utf8'`.
- Double encoding/decoding: UTF-8 bytes decoded as Latin-1 and re-encoded produce `Ã©`; URL-encoding twice
  produces `%2520`.
- Unicode normalization: `"é"` can be one code point (NFC) or `e` + combining accent (NFD, common in macOS
  file names). Normalize before comparing: `s.normalize('NFC')`, `unicodedata.normalize("NFC", s)`.
- Length semantics: JavaScript `'𝄞'.length === 2` (UTF-16 code units) while `[...'𝄞'].length === 1`; Go
  `len("é") == 2` (bytes) vs `utf8.RuneCountInString`; Rust `s.len()` is bytes and `&s[0..1]` panics if it
  splits a character.
- Byte order mark at the start of a file breaks the first CSV header or JSON parse — strip U+FEFF (`\uFEFF`, bytes `EF BB BF`).
- Line endings: CRLF vs LF breaks shell scripts (`/bin/sh^M: bad interpreter`), snapshot tests and
  line-based parsing. Check `.gitattributes`.
- Large integers in JSON: `JSON.parse('{"id": 9007199254740993}').id === 9007199254740992`. Send ids
  above 2^53 as strings.

### 8. Time, dates and time zones

**Symptoms:** fails near midnight, at month end, on DST transitions, on leap days, or only for users in
another time zone; tests fail on CI but not locally (different `TZ`).

**Confirm:** run the test with a pinned clock and a different zone: `TZ=Pacific/Auckland npm test`,
`TZ=UTC pytest`; use fake timers (`vi.setSystemTime`, `jest.setSystemTime`), `freezegun`/`time-machine`
in Python, an injected clock interface in Go/Rust.

**Common defects:**
- JavaScript: `new Date('2026-01-31')` parses as UTC midnight, but `new Date('2026-01-31T00:00')` parses as
  local time; months are 0-indexed in `new Date(y, m, d)`; adding one month to Jan 31 overflows into March.
- Python: naive datetimes (`datetime.now()`, `datetime.utcnow()`) mixed with aware ones; use
  `datetime.now(timezone.utc)`.
- Storing local times without the zone; SQL `timestamp` vs `timestamptz` in Postgres.
- Measuring durations with wall-clock time (jumps with NTP/DST) — use a monotonic clock
  (`performance.now()`, `time.monotonic()`, Go's `time.Since`, Rust `Instant`).

### 9. Numbers and precision

- Floating point: `0.1 + 0.2 !== 0.3`. Store money as integer minor units or use a decimal type
  (`decimal.Decimal`, `shopspring/decimal`, `rust_decimal`). Compare floats with a tolerance
  (`pytest.approx`, `toBeCloseTo`).
- Integer overflow: Go and Rust (release builds) wrap silently; Rust `as` casts truncate (`300i32 as u8 == 44`)
  — use `u8::try_from(x)`. JavaScript bitwise operators coerce to 32-bit integers.
- Parsing: `parseInt('08abc') === 8` (stops at the first invalid character); `Number('') === 0`;
  `['1','2','3'].map(parseInt)` yields `[1, NaN, NaN]` because `map` passes the index as the radix.
- Sorting: JavaScript's default `sort()` compares strings, so `[10, 9, 1].sort()` gives `[1, 10, 9]` — pass
  `(a, b) => a - b`.
