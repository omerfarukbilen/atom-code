---
name: error-handling
description: Design error handling that fails loudly on bugs and recovers deliberately from expected failures - classify failures, exceptions vs typed errors or result types, context while propagating, handling at boundaries, React error boundaries, timeouts, retries with backoff and jitter, idempotency, logging without secrets, and user-facing messages in TypeScript, Python, Go and Rust. Use when writing or reviewing code that calls networks, databases, files or external services, when errors are swallowed, vague or crash the app, or when adding retries, timeouts or error UI.
---

# Error Handling

Every failure should end in exactly one of two places: code that can do something meaningful about it
(retry, fall back, translate, ask the user), or a boundary that reports it with enough context to diagnose.
Swallowed errors turn bugs into silent data corruption; catch-everything-and-log turns one failure into five
log lines and a wrong result. Good error handling is mostly about deciding **where** each kind of failure is
handled, and making that decision consistently.

## When to use

- Writing code that touches I/O: HTTP calls, databases, queues, files, subprocesses, third-party SDKs.
- Designing a module's or API's error surface (error types, status codes, result types).
- Reviewing code with `catch {}`, `except: pass`, `_ = err`, `.unwrap()`, or `return null` on failure.
- Adding retries, timeouts, circuit breaking, idempotency, or error UI / React error boundaries.
- Errors reach users as stack traces or "Something went wrong" with no way forward.

## When not to use

- Diagnosing one specific failure - use `atom:systematic-debugging`, then come back to fix the handling.
- HTTP error response format design - `atom:api-design` covers status codes and problem-details bodies.
- Visual design of error and empty states - `atom:frontend-design` (this skill covers what the message says
  and where the error is caught).

## 1. Classify the failure

| Class | Examples | Strategy |
| --- | --- | --- |
| Bug (programmer error) | null dereference, broken invariant, impossible enum value, wrong argument type | **Fail fast.** Do not catch; crash the request/job, report, fix the code |
| Expected outcome | not found, validation failed, insufficient funds, conflict, permission denied | **Model it** in the return type or a specific error type; caller decides |
| Transient | timeout, connection reset, 429, 503, deadlock, lock timeout | **Retry** with backoff at one layer if the operation is idempotent, then surface |
| Permanent operational | missing config or credentials, disk full, schema mismatch | **Fail fast and loudly**, ideally at startup; alert an operator |

Fail fast on bugs because continuing in an unknown state is how corrupt data gets written. Model expected
outcomes because they are part of the business logic, not exceptional at all.

## 2. Decide where each failure is handled

Apply one test at every `catch`/`except`/`if err != nil`: **can this code do something meaningful?**
Meaningful means retry, fall back, translate into a domain error, add context, or tell the user. If not,
propagate (with context) and let a boundary deal with it.

Boundaries are where a unit of work starts: `main`, an HTTP handler or middleware, a job/queue consumer, a CLI
command, a UI error boundary. Each boundary has **one** central handler that maps errors to an outcome
(status code, retry/dead-letter, exit code, fallback UI) and logs once.

```text
db driver error ─► repository: wrap with context ("load order 42") ─► service: translate NotFound to OrderNotFound
                 ─► HTTP boundary: OrderNotFound → 404 body; anything unknown → 500 + log with request id
```

## 3. Represent errors well

- **Specific types for things callers handle**, generic ones for everything else. Callers branch on type or
  identity (`instanceof`, `except CardDeclined`, `errors.Is/As`, `match`), never on message strings.
- **Preserve the cause chain.** Wrap, do not replace: `new Error(msg, { cause })`, `raise X from e`,
  `fmt.Errorf("...: %w", err)`, `.context(...)` / `#[from]`.
- **Add context that is not already there**: the operation and the identifiers involved ("charge order 42"),
  not a restatement of the inner message.
- **Expected outcomes as values** where the language makes that natural: Rust and Go always; TypeScript
  discriminated unions for domain results; Python exceptions with a clear hierarchy.

Per-language patterns, including async pitfalls, are in
[references/language-patterns.md](references/language-patterns.md). Short versions:

```ts
// TypeScript - bad: caller cannot tell "not found" from "database down", and the cause is lost
async function getUser(id: string) {
  try { return await db.user.findUnique({ where: { id } }) } catch (e) { console.log(e); return null }
}

// good: infrastructure errors propagate untouched; the expected case is explicit
export class NotFoundError extends Error {
  constructor(readonly entity: string, readonly id: string) {
    super(`${entity} ${id} not found`)
    this.name = 'NotFoundError'
  }
}
export async function getUser(id: string): Promise<User> {
  const user = await db.user.findUnique({ where: { id } })
  if (!user) throw new NotFoundError('User', id)
  return user
}
```

```python
# Python - wrap at the layer that knows what the operation means; keep the cause with `from`
class PaymentError(Exception): ...
class PaymentUnavailable(PaymentError): ...
class CardDeclined(PaymentError):
    def __init__(self, reason: str) -> None:
        super().__init__(f"card declined: {reason}")
        self.reason = reason

def charge(order: Order) -> Receipt:
    try:
        resp = gateway.charge(order.total_cents, order.card_token, timeout=10)
    except (gateway.Timeout, ConnectionError) as e:
        raise PaymentUnavailable(f"charging order {order.id}") from e
    if resp.status == "declined":
        raise CardDeclined(resp.reason)
    return Receipt.from_response(resp)
```

```go
// Go - sentinel for the expected case, %w to keep the chain, errors.Is at the boundary
var ErrNotFound = errors.New("not found")

func (s *Store) User(ctx context.Context, id int64) (*User, error) {
	var u User
	err := s.db.QueryRowContext(ctx, `SELECT id, email FROM users WHERE id = $1`, id).Scan(&u.ID, &u.Email)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("user %d: %w", id, ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("query user %d: %w", id, err)
	}
	return &u, nil
}
```

```rust
// Rust - typed errors for libraries (thiserror), context for applications (anyhow), `?` to propagate
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("config file {0} not found")]
    Missing(std::path::PathBuf),
    #[error("invalid config")]
    Parse(#[from] toml::de::Error),
}

use anyhow::Context;

fn load(path: &Path) -> anyhow::Result<Config> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    Ok(toml::from_str(&text).context("parsing config")?)
}
```

Use `thiserror`/`anyhow` only if the crate already depends on them or the user agrees to add them.

## 4. Validate at the edges, fail fast at startup

Parse untrusted input (requests, files, env vars, CLI args) into typed values at the boundary, and reject
bad input there with a precise message (zod/valibot, pydantic, struct validation, serde). Validate
configuration once at startup and refuse to boot with a clear message - a missing `DATABASE_URL` should
fail in the first second, not on the first request at 3 a.m.

## 5. Remote calls: timeouts, retries, idempotency

- **Every network call gets a timeout.** Many clients default to none or to minutes (`requests`, Go's
  `http.DefaultClient`); a hung dependency then hangs you. Propagate deadlines (`AbortSignal`,
  `context.Context`, `asyncio.timeout`) so inner calls never outlive the outer budget.
- **Retry only transient failures, only idempotent operations, at one layer**, with capped exponential
  backoff and full jitter; honor `Retry-After`. Retries at three layers of three attempts each make 27 calls
  to a dependency that is already struggling.
- **Make non-idempotent operations safe to retry** with idempotency keys or natural idempotency
  (upserts, `INSERT ... ON CONFLICT DO NOTHING`, PUT with full state).

```ts
// Full-jitter backoff; isRetryable() returns true for timeouts, ECONNRESET, 429, 502-504
async function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(AbortSignal.timeout(5_000))
    } catch (err) {
      if (attempt >= attempts || !isRetryable(err)) throw err
      const capMs = Math.min(5_000, 200 * 2 ** (attempt - 1))
      await new Promise((r) => setTimeout(r, Math.random() * capMs))
    }
  }
}
```

Python, Go and Rust versions, retry classification, idempotency keys, circuit breakers and per-client
timeout settings are in [references/resilience.md](references/resilience.md).

## 6. Log once, with context, without secrets

- Log at the boundary that handles the error, not at every layer it passes through (log-and-rethrow
  produces duplicates that hide the real sequence of events).
- Structured fields, not string concatenation, and always the error object itself so the stack and cause
  chain survive: `logger.error({ err, orderId, attempt }, 'charge failed')`, `logger.exception(...)` in
  Python, `slog.ErrorContext(ctx, "charge failed", "order_id", id, "err", err)`, `tracing::error!(error = %err, order_id, "charge failed")`.
- Include a request or correlation id so the user-facing reference maps to the log entry.
- Never log passwords, tokens, API keys, session cookies, full card numbers, or personal data. Prefer
  logging an allowlist of fields over dumping whole request objects or headers.
- Level by actionability: `error` = someone should look; `warn` = degraded but handled; expected
  outcomes (a 404, a declined card) are `info` or metrics, not errors.

## 7. Tell the user something useful

| Bad | Good |
| --- | --- |
| `Error: connect ECONNREFUSED 10.0.3.12:5432` | "We couldn't save your changes. Please try again in a minute. (Ref 7f3a2c)" |
| "Invalid input" | "Email address is missing an @." |
| "Something went wrong" for a user-fixable problem | "That file is larger than 10 MB. Choose a smaller file." |

Say what happened, what the user can do, and give a reference id for support. Keep internals (stack traces,
SQL, hostnames) out of responses and UI.

## 8. React error boundaries

Boundaries catch errors thrown while rendering, in lifecycle methods and constructors below them. They do
**not** catch errors in event handlers, timers, or promise callbacks - handle those where they happen and
put them in state. If the project already uses `react-error-boundary` (or a framework convention such as
Next.js `error.tsx`), use that; otherwise:

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { fallback: (error: Error, reset: () => void) => ReactNode; children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    logClientError(error, { componentStack: info.componentStack })
  }
  reset = () => this.setState({ error: null })
  render() {
    return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children
  }
}
```

Place boundaries around independent regions (a panel, a route, a widget) so one failure does not blank the
whole app, and give the fallback a retry action.

## 9. Clean up and test failure paths

- Release resources on every path: `finally`, `with`/context managers, `defer`, `Drop`/RAII, `using`
  declarations where supported. Wrap multi-step writes in a transaction so a failure leaves no partial state.
- Test the unhappy paths deliberately: make fakes throw, time out, or return 503 then 200; assert the error
  type, the status code or message, that retries stop, and that no partial writes remain.
- After editing, run the tests and check `mcp__atom-ide__get_diagnostics` - type checkers catch many
  unhandled cases (non-exhaustive switches, unused `Result`s, ignored errors with linters such as
  `errcheck`, `@typescript-eslint/no-floating-promises`, Ruff `BLE001`/`S110`, `clippy::unwrap_used`).

## Common pitfalls

- **Swallowing:** `catch {}`, `except Exception: pass`, `_ = err`, `.ok()` dropping an error. If ignoring is
  truly correct, narrow it to the specific error and write a comment saying why.
- **Replacing instead of wrapping:** `throw new Error(e.message)` loses the stack and the type.
- **Returning null/false for failure** so callers cannot distinguish "absent" from "broken".
- **Catching too broadly:** bare `except:` also catches `KeyboardInterrupt`; `catch (e)` around 50 lines hides
  which call failed.
- **Retrying non-idempotent operations** (charges, emails, creates) without an idempotency key.
- **No timeout** on HTTP, database or subprocess calls.
- **Floating promises / unawaited tasks:** the error escapes every `try` and becomes an unhandled rejection.
- **Leaking internals or secrets** into error messages, logs and responses.
- **`.unwrap()` / `panic` / `assert` on user input** in Rust, Go or Python library code.

## Definition of done

- [ ] Every failure mode of the touched code is classified (bug / expected / transient / permanent).
- [ ] Each catch site either does something meaningful or is removed; nothing is silently swallowed.
- [ ] Errors keep their cause chain and carry operation context and identifiers.
- [ ] Boundaries map errors to outcomes in one place and log once, with a correlation id and no secrets.
- [ ] Remote calls have timeouts; retries are limited to transient, idempotent cases at a single layer.
- [ ] User-facing messages are actionable and free of internals.
- [ ] Failure paths are covered by tests, and tests, typecheck and diagnostics are clean.
