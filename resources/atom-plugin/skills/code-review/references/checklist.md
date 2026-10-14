# Code review checklist

Companion to the `code-review` skill. Part 1 follows the seven review passes; Part 2 lists language- and
platform-specific gotchas. Read the general passes once, then only the language sections present in the diff.
Every item is a prompt to look — verify before reporting (see SKILL.md, step 4).

- Part 1 — [Correctness](#1-correctness) · [Security](#2-security) · [Data integrity](#3-data-integrity) ·
  [Performance](#4-performance) · [Error handling](#5-error-handling) · [Tests](#6-tests) ·
  [Readability](#7-readability-and-maintainability)
- Part 2 — [TypeScript/JavaScript](#typescript-and-javascript) · [React](#react) · [Node.js](#nodejs) ·
  [Python](#python) · [Go](#go) · [Rust](#rust) · [SQL and ORMs](#sql-and-orms) · [Shell](#shell-scripts) ·
  [HTTP APIs](#http-apis) · [Config, CI and containers](#config-ci-and-containers)

---

## Part 1 — The seven passes

### 1. Correctness

- [ ] The change does what the PR/issue says — and nothing surprising beyond it.
- [ ] Boundaries: empty collections, a single element, the maximum size, zero, negative numbers, `null`/`None`.
- [ ] Conditions: inverted logic, `&&` vs `||`, `<` vs `<=`, negation of compound conditions (De Morgan).
- [ ] Every branch of a `switch`/`match`/enum handled; new enum variants handled by existing switches elsewhere (Grep).
- [ ] Changed function contracts (arguments, return type, thrown errors, nullability) — every caller updated.
- [ ] State: mutation of shared objects or arguments the caller still uses; aliasing of arrays/slices.
- [ ] Concurrency: check-then-act sequences, shared mutable state, missing locks, async interleaving.
- [ ] Time: time zones, DST, month/year boundaries, monotonic vs wall clock for durations.
- [ ] Units and formats: cents vs dollars, ms vs s, bytes vs characters, 0- vs 1-based indexes.
- [ ] Feature flags and config defaults: what happens when the flag or setting is missing?

### 2. Security

- [ ] Untrusted input (request params, headers, bodies, file contents, env from users, LLM output) never reaches
      SQL, shell commands, file paths, HTML, URLs/redirects, templates, `eval`, or deserializers unescaped.
- [ ] Authentication *and* authorization: is the actor allowed to act on *this* resource (tenant, owner, role)?
- [ ] Object references from the client (ids in URLs/bodies) are checked against the session — no IDOR.
- [ ] No secrets, tokens or credentials in code, tests, fixtures, logs, error messages or client bundles.
- [ ] Crypto: no homemade crypto, no MD5/SHA1 for passwords (use bcrypt/scrypt/argon2), constant-time comparison
      for tokens, secure randomness (`crypto.randomUUID`, `secrets`, `crypto/rand`) for anything security-relevant.
- [ ] Cookies/session: `HttpOnly`, `Secure`, `SameSite`; CSRF protection for cookie-authenticated mutations.
- [ ] CORS not widened to `*` with credentials; redirects validated against an allowlist.
- [ ] Uploads: size limits, content-type validation, stored outside the web root, names not trusted.
- [ ] New dependencies: maintained, reasonable size, no typosquat-looking names, license compatible.
- [ ] Deeper issues → recommend `atom:security-audit`.

### 3. Data integrity

- [ ] Related writes wrapped in a transaction; external side effects (emails, payments, queues) happen after commit
      or via an outbox.
- [ ] Retries are safe: idempotency keys or naturally idempotent operations.
- [ ] Concurrent updates cannot lose data (atomic updates, optimistic locking with a version, row locks).
- [ ] Migrations: backwards compatible with the currently deployed code (expand → migrate → contract), no long
      table locks on large tables, backfills batched, reversible or with a documented rollback.
- [ ] Serialized formats (API responses, events, stored JSON, cache entries) remain readable by old consumers.
- [ ] No precision loss: money in integer minor units or decimals; ids above 2^53 not passed through JS numbers.
- [ ] Caches invalidated on every write path that changes the underlying data.
- [ ] Deletions: soft vs hard delete intended? Cascades understood?

### 4. Performance

- [ ] Queries inside loops (N+1) — batch, join, or prefetch.
- [ ] Unbounded reads: missing `LIMIT`/pagination, loading whole tables or files into memory.
- [ ] New query patterns have supporting indexes (`WHERE`, `JOIN`, `ORDER BY` columns).
- [ ] Repeated expensive work inside hot loops (regex compilation, JSON parsing, allocations, network calls).
- [ ] Accidental O(n²): `array.includes`/`list.index` inside a loop over the same data — use a Set/Map/dict.
- [ ] Blocking I/O or CPU-heavy work on an event loop or async runtime.
- [ ] Sequential awaits that could run concurrently (and vice versa: unbounded concurrency against a rate-limited API).
- [ ] Frontend: bundle size of new imports, unnecessary re-renders of large lists, layout thrash.

### 5. Error handling

- [ ] No silently swallowed errors (`catch {}`, `except: pass`, `_ = err`, `let _ =`); intentional ignores are commented.
- [ ] Errors keep their cause (`new Error(msg, { cause })`, `raise ... from err`, `fmt.Errorf("...: %w", err)`,
      `anyhow::Context`).
- [ ] Outbound calls have timeouts; retries have backoff and a cap.
- [ ] Partial failure leaves consistent state (cleanup, rollback, compensating action).
- [ ] Resources released on every path (`finally`, `with`, `defer`, RAII; streams, files, connections, locks).
- [ ] User-facing errors are helpful and do not leak stack traces, SQL or internal paths.
- [ ] Error types/codes stable enough for callers to branch on — not string matching on messages.

### 6. Tests

- [ ] New behaviour covered, including at least one failure/edge path.
- [ ] Tests would fail if the code were wrong (mentally break the code — would a test notice?).
- [ ] Bug fixes include a regression test that reproduces the original bug.
- [ ] Mocks only at boundaries; tests assert outcomes, not internal call sequences.
- [ ] No sleeps, real network, real clock or order dependence; fixtures cleaned up.
- [ ] Test names describe behaviour.

### 7. Readability and maintainability

- [ ] Names say what things are and do; no misleading names left over from a previous meaning.
- [ ] No duplicated logic that already exists in a helper (Grep for similar code).
- [ ] No dead code, commented-out code, leftover debug output, or TODOs without an owner/issue.
- [ ] Functions do one thing; nesting is shallow (guard clauses); no needless abstraction for a single use.
- [ ] Comments explain *why*, and still match the code.
- [ ] Public API is hard to misuse: clear types, sensible defaults, no boolean-flag soup.
- [ ] Consistent with the codebase's existing patterns and the project rules in `ATOM.md` / `CLAUDE.md`.

---

## Part 2 — Language and platform gotchas

### TypeScript and JavaScript

- `forEach(async ...)` does not wait — use `for...of` with `await` or `Promise.all`.
- Floating promises: an async call without `await`/`.catch` loses errors and ordering.
- `Promise.all` rejects on the first failure and leaves the others running; use `Promise.allSettled` when every
  result matters.
- `||` treats `0`, `''` and `false` as missing — use `??` for defaults: `const limit = opts.limit ?? 50`.
- Default `sort()` compares strings: `[10, 9, 1].sort()` → `[1, 10, 9]`; pass `(a, b) => a - b`. `sort()` also
  mutates in place — use `toSorted()` (ES2023) or copy first when the original is shared.
- `['1', '2', '3'].map(parseInt)` → `[1, NaN, NaN]` (index passed as radix). Use `Number` or an explicit lambda.
- `str.replace('a', 'b')` replaces only the first match with a string pattern — use `replaceAll` or a `/g` regex.
- A regex with the `g` flag keeps `lastIndex` between `.test()` calls — reusing it gives alternating results.
- `new Date('2026-03-01')` is UTC midnight; `new Date('2026-03-01T00:00')` is local; months in `new Date(y, m)`
  are 0-based.
- `typeof null === 'object'`; `for...in` iterates keys as strings, including inherited ones — use `for...of`.
- Spread/`Object.assign` copy shallowly; nested objects are still shared.
- `JSON.parse` returns `any` — validate external data (zod, valibot) before trusting its shape.
- TypeScript escape hatches hide bugs: `as Foo`, non-null `!`, `any`, `@ts-ignore`. Each one in a diff deserves a
  look at whether the type could be made honest instead.
- Exhaustiveness: `switch` over a union should end with `const _exhaustive: never = value;` so new members fail
  the typecheck.
- Numbers above `Number.MAX_SAFE_INTEGER` (2^53 − 1) lose precision — use `bigint` or strings for large ids.

### React

- `useEffect` dependency arrays missing values → stale closures; fix the dependencies rather than silencing the
  lint rule.
- Effects that subscribe, start timers or fetch must clean up (return a cleanup function, abort fetches).
- Race: a slow earlier fetch resolving after a newer one overwrites fresh state — ignore stale responses.
- `key={index}` on lists that reorder, insert or delete → state attached to the wrong row. Use stable ids.
- State updates based on previous state should use the updater form: `setCount((c) => c + 1)`.
- Derived values stored in state drift out of sync — compute during render (memoize only if measured as expensive).
- Hooks called conditionally or in loops break the rules of hooks.
- `dangerouslySetInnerHTML` with anything user-controlled → XSS; sanitize (DOMPurify) or avoid.
- Objects/functions created inline as props defeat `memo` on hot, large lists.

### Node.js

- Synchronous fs/crypto/zlib calls (`readFileSync`, `pbkdf2Sync`) in request handlers block every request.
- ``child_process.exec(`convert ${input}`)`` is shell injection — use `execFile`/`spawn` with an argument array.
- Path traversal: `path.join(root, userPath)` can escape `root`. Resolve and check:
  ```ts
  const target = path.resolve(root, userPath);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Invalid path');
  ```
- Environment variables are strings: `if (process.env.FEATURE)` is true for `'false'` and `'0'` too - compare
  explicitly (`process.env.FEATURE === 'true'`) or parse config once with a schema.
- Streams: ignoring backpressure (`write()` returning false) or missing `error` handlers; prefer `stream.pipeline`.
- Unhandled promise rejections crash the process (Node 15+) — make sure background promises are handled.
- `fetch` has no default timeout — pass `signal: AbortSignal.timeout(ms)`.

### Python

- Mutable default arguments are shared across calls: `def f(items=[])` → use `items=None` then `items = items or []`
  (or `if items is None`).
- Late-binding closures: `[lambda: i for i in range(3)]` all return 2 — bind with a default `lambda i=i: i`.
- Bare `except:` also catches `KeyboardInterrupt` and `SystemExit`; `except Exception: pass` hides bugs.
- `is` compares identity — use `==` for values; `is` only for `None`, `True`, `False` and sentinels.
- Modifying a list or dict while iterating over it — iterate over a copy or build a new collection.
- Generators and iterators are single-use: iterating twice silently yields nothing the second time.
- `requests` has no default timeout — always pass `timeout=`; same for many HTTP clients.
- `datetime.utcnow()` returns a naive datetime (deprecated since 3.12) — use `datetime.now(timezone.utc)`.
- `open()` without `encoding="utf-8"` uses the locale encoding on many platforms (notably Windows).
- `subprocess.run(cmd, shell=True)` with interpolated input → injection; pass a list without `shell=True`.
- `pickle.loads`, `yaml.load` (without `SafeLoader`), `eval` on untrusted data → code execution; use `yaml.safe_load`.
- f-strings in SQL (`f"... WHERE id = {user_id}"`) → injection; use parameters.
- Blocking calls inside `async def` (`time.sleep`, `requests`, heavy CPU) stall the event loop — use async
  clients, `asyncio.sleep`, or `asyncio.to_thread`.
- `asyncio.create_task(...)` without keeping a reference can be garbage-collected mid-flight.
- Float equality and `round()` (banker's rounding: `round(2.5) == 2`) — use `math.isclose` / `Decimal`.

### Go

- Ignored errors: `_ = f()` or a bare call to a function that returns an error.
- Shadowing: `err := ...` inside an `if`/`for` block shadows the outer `err`, so the outer one stays nil.
- `defer resp.Body.Close()` before checking `err` → nil pointer dereference when the request failed.
- `defer` inside a loop runs at function exit, not per iteration — files/locks pile up; wrap the body in a function.
- Writing to a nil map panics; reading is fine.
- A typed nil pointer returned as an `error` interface is non-nil — return a literal `nil` on success.
- Goroutine leaks: sends/receives that can block forever; missing `ctx.Done()` handling; no way to stop workers.
- `sync.WaitGroup.Add` must happen before starting the goroutine, not inside it.
- Copying a struct that contains a `sync.Mutex` (value receivers, passing by value) — `go vet` reports it.
- `append` may share the backing array: two slices derived from the same base can overwrite each other.
- Map iteration order is random; do not rely on it in output or tests.
- `http.Client{}` and `http.DefaultClient` have no timeout — set `Timeout` or use request contexts with deadlines.
- Compare wrapped errors with `errors.Is` / `errors.As`, not `==`; wrap with `%w` to keep the chain.
- Loop variables are per-iteration since Go 1.22; in modules with an older `go` directive in `go.mod`, closures
  and goroutines capturing loop variables share one variable.

### Rust

- `unwrap()`/`expect()` on paths reachable by user input or I/O — return a `Result` instead (fine in tests and
  for genuinely impossible states with a clear message).
- `as` casts truncate and wrap silently (`300i32 as u8 == 44`, `-1i32 as u32 == 4294967295`) — use `try_from`.
- Integer overflow panics in debug and wraps in release — use `checked_*`, `saturating_*` or `wrapping_*` explicitly.
- Slicing strings by byte index panics on non-character boundaries — use `char_indices` or `get(..)`.
- Holding a `std::sync::Mutex` guard across `.await` — can deadlock and makes futures `!Send`; scope the guard
  or use `tokio::sync::Mutex`.
- Blocking calls (`std::fs`, `std::thread::sleep`, heavy CPU) inside async tasks — use async equivalents or
  `tokio::task::spawn_blocking`.
- `RefCell` borrow conflicts panic at runtime; `Rc` cycles leak — use `Weak` for back-references.
- `let _ = fallible();` silently drops the error — handle or log it.
- `unsafe` blocks need a `// SAFETY:` comment explaining the invariant, and the invariant must actually hold.
- `.clone()` to satisfy the borrow checker inside hot loops — often a sign the ownership design needs a borrow.
- `Vec::remove(0)` in a loop is O(n²) — use `VecDeque` or `drain`.
- `HashMap` iteration order is unspecified — sort before producing output that must be stable.

### SQL and ORMs

- String-built queries → injection. Use bound parameters, even for "internal" values.
- N+1: ORM lazy loading inside loops — use `include`/`select_related`/`prefetch_related`/`Preload`/joins.
- `= NULL` is never true — use `IS NULL`. `NOT IN (subquery)` returns no rows if the subquery yields a NULL.
- Missing `ORDER BY` with `LIMIT` → nondeterministic pages; `OFFSET` pagination drifts under concurrent inserts.
- New filters/joins without an index on large tables.
- Migrations on large tables: index creation without `CONCURRENTLY` (Postgres) blocks writes; adding a `NOT NULL`
  column needs a default or a backfill plan; renaming/dropping columns breaks the currently deployed code.
- `timestamp` vs `timestamptz` (Postgres): store instants as `timestamptz`.
- Transactions: multi-statement writes outside a transaction; long transactions holding locks during network calls.
- `ON DELETE CASCADE` added casually can delete far more than intended.

### Shell scripts

- Unquoted variables split and glob: always `"$var"`, `"$@"`.
- Missing `set -euo pipefail` (bash) — failures in the middle of a pipeline or script go unnoticed.
- `rm -rf "$DIR/"` with an empty `DIR` deletes `/` contents — use `"${DIR:?}"` to fail on empty.
- `cd somewhere` without `|| exit` continues in the wrong directory.
- Parsing `ls` output; `for f in $(find ...)` breaks on spaces — use `find ... -print0 | xargs -0` or globs.
- `#!/bin/sh` scripts using bash-only syntax (`[[ ]]`, arrays).

### HTTP APIs

- Breaking changes: removed/renamed fields, changed types, new required parameters, changed status codes or
  error shapes — need versioning or a deprecation path.
- Input validated at the boundary with clear 400/422 errors; output does not over-expose fields (password hashes,
  internal flags).
- Correct status codes (not `200` with an error body); `201` + location for creates; idempotent `PUT`/`DELETE`.
- Pagination and limits on list endpoints; rate limiting on expensive or auth endpoints.
- Idempotency keys for non-idempotent operations that clients may retry (payments, orders).
- See `atom:api-design` for deeper API review.

### Config, CI and containers

- Secrets committed (`.env`, keys, tokens) — check `.gitignore` covers them; rotate anything already pushed.
- CI: `pull_request_target` workflows that check out and run PR code expose secrets; third-party actions should
  be pinned (ideally to a commit SHA); `permissions:` scoped to the minimum.
- Docker: images pinned (no `latest`), not running as root, `.dockerignore` excludes `.git`, `node_modules`, `.env`;
  dependency install layer ordered before copying source for caching; no secrets in `ARG`/`ENV`.
- Config defaults safe for production (debug off, verbose errors off, permissive CORS off).
- Infrastructure changes (Terraform, Kubernetes) reviewed for destroy/replace operations and public exposure.
