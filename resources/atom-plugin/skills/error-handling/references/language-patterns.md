# Error handling patterns by language

Read the section for the language you are working in. Each one covers: how to define errors, how to
propagate with context, how to handle at a boundary, and the traps specific to that language.

## TypeScript / JavaScript

### Defining errors

```ts
export class AppError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)                 // ES2022 `cause`; set "lib" to es2022 or later in tsconfig
    this.name = new.target.name             // NotFoundError, ConflictError, ... in stack traces
  }
}
export class NotFoundError extends AppError {}
export class ConflictError extends AppError {}
export class ValidationError extends AppError {
  constructor(readonly issues: { path: string; message: string }[]) {
    super('validation failed')
  }
}
```

`catch (err)` gives `unknown` under `useUnknownInCatchVariables` (part of `strict`). Narrow before use:

```ts
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
```

### Result types for expected outcomes

Throwing is fine for failures callers rarely handle. When the caller must handle the outcome (business rules),
a discriminated union makes forgetting a case a compile error:

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

type TransferError =
  | { kind: 'insufficient-funds'; balance: number }
  | { kind: 'account-frozen'; accountId: string }

function transfer(from: Account, to: Account, cents: number): Result<Receipt, TransferError> {
  if (from.frozen) return { ok: false, error: { kind: 'account-frozen', accountId: from.id } }
  if (from.balance < cents) return { ok: false, error: { kind: 'insufficient-funds', balance: from.balance } }
  return { ok: true, value: applyTransfer(from, to, cents) }
}

const r = transfer(a, b, 500)
if (!r.ok) {
  switch (r.error.kind) {
    case 'insufficient-funds': return showToast(`Balance is only ${formatCents(r.error.balance)}`)
    case 'account-frozen': return showToast('This account is frozen. Contact support.')
    default: { const unreachable: never = r.error; throw new Error(`unhandled ${JSON.stringify(unreachable)}`) }
  }
}
```

Infrastructure failures (database down) still throw; do not force every function into `Result`.

### HTTP boundary (Express-style)

```ts
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const requestId = res.locals.requestId as string
  if (err instanceof ValidationError) return res.status(422).json({ title: 'Invalid input', errors: err.issues })
  if (err instanceof NotFoundError) return res.status(404).json({ title: err.message })
  if (err instanceof ConflictError) return res.status(409).json({ title: err.message })
  logger.error({ err, requestId, path: req.path }, 'unhandled error')
  res.status(500).json({ title: 'Internal error', requestId })
})
```

Express 4 does not forward rejected promises from async handlers to this middleware - wrap handlers or use
Express 5 (which does). Other frameworks (Fastify, Hono, NestJS, Next.js route handlers) have their own
error hooks; use the framework's mechanism.

### Async traps

```ts
// Bad: the returned promise rejects after the try block has exited - catch never runs
try { return fetchUser(id) } catch (err) { ... }
// Good
try { return await fetchUser(id) } catch (err) { ... }

// Bad: forEach ignores returned promises; rejections become unhandled, order is lost
items.forEach(async (item) => { await save(item) })
// Good: sequential
for (const item of items) await save(item)
// Good: parallel, fail on first error
await Promise.all(items.map((item) => save(item)))
// Good: parallel, collect every outcome
const results = await Promise.allSettled(items.map((item) => save(item)))
const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')

// Fire-and-forget must still handle its own errors
void sendAnalytics(event).catch((err) => logger.warn({ err }, 'analytics failed'))
```

Node 15+ terminates the process on unhandled rejections by default. Install
`process.on('unhandledRejection', ...)` only to log and exit, not to keep running in an unknown state.

### Intentionally ignoring an error

```ts
try {
  await fs.unlink(tmpPath)
} catch (err) {
  // Best-effort cleanup: a leftover temp file must not fail the upload.
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn({ err, tmpPath }, 'temp cleanup failed')
}
```

## Python

### Hierarchy and chaining

```python
class AppError(Exception):
    """Base for errors this package raises on purpose."""

class NotFound(AppError):
    def __init__(self, entity: str, key: object) -> None:
        super().__init__(f"{entity} {key!r} not found")
        self.entity, self.key = entity, key

try:
    row = repo.load(order_id)
except psycopg.OperationalError as e:
    raise StorageUnavailable(f"loading order {order_id}") from e    # keeps __cause__ and the traceback
```

- `raise ... from e` records the cause; `raise ... from None` deliberately hides it (rarely right).
- Catch the narrowest exception that you can handle. `except Exception` belongs only at boundaries.
  Never use a bare `except:` - it also catches `KeyboardInterrupt` and `SystemExit`.
- Intentional, narrow ignore: `with contextlib.suppress(FileNotFoundError): os.remove(tmp)`.
- Add notes without rewrapping (3.11+): `e.add_note(f"while processing row {i}")`.

### Boundary

```python
# FastAPI
@app.exception_handler(NotFound)
async def not_found_handler(request: Request, exc: NotFound) -> JSONResponse:
    return JSONResponse(status_code=404, content={"title": str(exc)})

# CLI entry point
def main() -> int:
    try:
        run(parse_args())
    except ConfigError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except Exception:
        logger.exception("unexpected failure")
        return 1
    return 0
```

### Async and groups

- `asyncio.TaskGroup` (3.11+) cancels sibling tasks when one fails and raises an `ExceptionGroup`; handle
  members with `except* SomeError as eg:`.
- `asyncio.gather(..., return_exceptions=True)` returns exceptions as values - check every result.
- Timeouts: `async with asyncio.timeout(5):` (3.11+) or `await asyncio.wait_for(coro, 5)`.
- A task created with `asyncio.create_task` and never awaited loses its exception (only "Task exception was
  never retrieved" in logs). Keep a reference and await it, or use a TaskGroup.

### Logging

```python
logger = logging.getLogger(__name__)
try:
    charge(order)
except PaymentUnavailable:
    logger.exception("charge failed", extra={"order_id": order.id})   # logs at ERROR with the traceback
    raise
```

Only log-and-reraise at a boundary-like point where nothing above will log it; otherwise just reraise.

## Go

### Defining and wrapping

```go
var ErrNotFound = errors.New("not found")          // sentinel: compare with errors.Is

type ValidationError struct {                       // type: inspect fields with errors.As
	Field, Reason string
}

func (e *ValidationError) Error() string { return e.Field + ": " + e.Reason }

func parseAge(s string) (int, error) {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, &ValidationError{Field: "age", Reason: "must be a whole number"}
	}
	return n, nil
}

// Wrap with %w to keep the chain; add the operation and identifiers
if err := s.repo.Save(ctx, order); err != nil {
	return fmt.Errorf("save order %d: %w", order.ID, err)
}

// Inspect
var ve *ValidationError
switch {
case errors.As(err, &ve):
	http.Error(w, ve.Error(), http.StatusUnprocessableEntity)
case errors.Is(err, ErrNotFound):
	http.Error(w, "not found", http.StatusNotFound)
case errors.Is(err, context.DeadlineExceeded):
	http.Error(w, "upstream timeout", http.StatusGatewayTimeout)
case err != nil:
	slog.ErrorContext(ctx, "create order", "err", err)
	http.Error(w, "internal error", http.StatusInternalServerError)
}
```

- `errors.Join(errs...)` (1.20+) combines several errors; `errors.Is/As` see through it.
- Use `%v` instead of `%w` only when you deliberately do not want callers to depend on the inner error.
- Error strings: lowercase, no trailing punctuation, no "failed to" prefix chains ("save order 42: insert: connection refused" reads well).
- Check `Close()` errors on writers (a failed `Close` on a file can mean lost data):
  ```go
  defer func() {
  	if cerr := f.Close(); cerr != nil && err == nil {
  		err = cerr
  	}
  }()   // requires a named return value `err error`
  ```
- `panic` only for programmer errors and impossible states. `net/http` recovers panics per request, but a
  panic in a goroutine you started crashes the whole process - recover at the top of long-lived goroutines,
  or use `golang.org/x/sync/errgroup` to propagate errors from concurrent work.
- `rows.Err()` after iterating `sql.Rows`, and `scanner.Err()` after a `bufio.Scanner` loop - both are
  commonly forgotten.

## Rust

### Libraries: typed errors

```rust
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("order {0} not found")]
    NotFound(u64),
    #[error("database error")]
    Db(#[from] sqlx::Error),
}

pub async fn order(pool: &PgPool, id: u64) -> Result<Order, StoreError> {
    sqlx::query_as::<_, Order>("SELECT * FROM orders WHERE id = $1")
        .bind(id as i64)
        .fetch_optional(pool)
        .await?                        // sqlx::Error -> StoreError::Db via #[from]
        .ok_or(StoreError::NotFound(id))
}
```

Without `thiserror`, implement `std::fmt::Display`, `std::error::Error` (with `source()`), and `From` by hand.

### Applications: context

```rust
use anyhow::{bail, Context, Result};

fn run(args: Args) -> Result<()> {
    let cfg = load_config(&args.config).with_context(|| format!("loading {}", args.config.display()))?;
    if cfg.workers == 0 {
        bail!("workers must be at least 1");
    }
    Ok(())
}
```

`main` can return `anyhow::Result<()>`; printing with `{:#}` or `{:?}` shows the whole context chain.

### Panics vs Result

- `unwrap()` / `expect()` are for invariants the program guarantees. Prefer `expect("why this cannot fail")`
  so a violated invariant explains itself. Never on user input, I/O, or parsing external data.
- Match on error kinds instead of strings: `Err(e) if e.kind() == std::io::ErrorKind::NotFound => ...`.
- Timeouts in async code: `tokio::time::timeout(Duration::from_secs(5), fut).await` returns
  `Err(Elapsed)` on timeout - map it to your error type.
- Logging with `tracing`: `tracing::error!(error = %err, order_id, "charge failed")` (`%` uses Display,
  `?` uses Debug, which includes more detail).
