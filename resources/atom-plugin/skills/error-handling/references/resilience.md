# Timeouts, retries, idempotency and circuit breakers

Read this when code calls something over a network or another process: HTTP APIs, databases, caches,
queues, cloud SDKs, subprocesses.

## Timeouts

A call without a timeout can wait forever, holding a connection, a thread or a request slot while callers
pile up. Set one on every remote call, and make inner timeouts shorter than the outer budget so the caller
gets a meaningful error instead of its own timeout firing first.

| Stack | How |
| --- | --- |
| `fetch` (browser, Node 18+) | `fetch(url, { signal: AbortSignal.timeout(5_000) })`; combine with a caller's signal via `AbortSignal.any([signal, AbortSignal.timeout(5_000)])` (Node 20.3+, modern browsers) |
| axios | `axios.get(url, { timeout: 5_000 })` (default is no timeout) |
| Python `requests` | `requests.get(url, timeout=(3.05, 10))` - connect, read. Default is no timeout |
| Python `httpx` | Default 5 s; set explicitly: `httpx.Client(timeout=httpx.Timeout(10.0, connect=3.0))` |
| Python asyncio | `async with asyncio.timeout(5):` (3.11+) or `asyncio.wait_for(coro, 5)` |
| Go `net/http` | `&http.Client{Timeout: 10 * time.Second}` - `http.DefaultClient` has none; per call `http.NewRequestWithContext(ctx, ...)` with `context.WithTimeout` |
| Go database/sql | Pass a `ctx` with deadline to `QueryContext`/`ExecContext` |
| Rust reqwest | `reqwest::Client::builder().timeout(Duration::from_secs(10)).build()?` |
| Rust async generally | `tokio::time::timeout(Duration::from_secs(5), fut).await` |
| Postgres | `SET statement_timeout = '5s'` per session/role, or driver options |
| Subprocesses | Node `execFile(cmd, args, { timeout: 30_000 })`; Python `subprocess.run(..., timeout=30)`; Go `exec.CommandContext(ctx, ...)` |

Propagate cancellation: pass `AbortSignal` / `context.Context` / cancellation tokens down every layer so that
when the user leaves or the request times out, the work below stops too.

## Which failures to retry

| Retry (transient) | Do not retry (permanent or unsafe) |
| --- | --- |
| Connection refused/reset, DNS hiccup, TLS handshake timeout | 400, 401, 403, 404, 409, 422 - the same request will fail again |
| Timeouts - only if the operation is idempotent | Validation errors, business rule failures |
| HTTP 429 (honor `Retry-After`), 502, 503, 504 | 500 from a non-idempotent endpoint without an idempotency key |
| Database deadlock / serialization failure (retry the whole transaction) | Constraint violations, syntax errors |
| Lock timeouts, "try again" errors from cloud SDKs | Authentication / configuration errors |

Many SDKs (AWS, Google Cloud, Stripe, Anthropic, database drivers) already retry internally. Check before
wrapping them in your own retry loop, or you multiply attempts.

## Backoff with full jitter

`delay = random(0, min(cap, base * 2^attempt))`. The exponential part spaces attempts out; the jitter stops
every client that failed at the same moment from retrying at the same moment (thundering herd).

```python
import random, time

RETRYABLE = (TimeoutError, ConnectionError)

def with_retry(fn, *, attempts: int = 4, base: float = 0.2, cap: float = 5.0):
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except RETRYABLE:
            if attempt == attempts:
                raise
            time.sleep(random.uniform(0, min(cap, base * 2 ** (attempt - 1))))
```

```go
// Go 1.22+ (math/rand/v2, built-in min)
func withRetry(ctx context.Context, attempts int, fn func(context.Context) error) error {
	const base, maxDelay = 200 * time.Millisecond, 5 * time.Second
	var err error
	for attempt := 0; attempt < attempts; attempt++ {
		if err = fn(ctx); err == nil || !isRetryable(err) {
			return err
		}
		if attempt == attempts-1 {
			break
		}
		delay := min(maxDelay, base<<attempt)
		select {
		case <-time.After(time.Duration(rand.Int64N(int64(delay)) + 1)):
		case <-ctx.Done():
			return errors.Join(err, ctx.Err())
		}
	}
	return err
}
```

```rust
// tokio; is_retryable decides per error
async fn with_retry<T, E, F, Fut>(mut op: F, attempts: u32, is_retryable: impl Fn(&E) -> bool) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
{
    let mut attempt = 0;
    loop {
        match op().await {
            Ok(v) => return Ok(v),
            Err(e) if attempt + 1 < attempts && is_retryable(&e) => {
                let cap_ms = 5_000u64.min(200 * 2u64.pow(attempt));
                let delay = rand::random::<u64>() % (cap_ms + 1);   // or a jitter helper from a crate already in use
                tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                attempt += 1;
            }
            Err(e) => return Err(e),
        }
    }
}
```

If the project already depends on a retry library (`p-retry`, `tenacity`, `backoff`, `cenkalti/backoff`,
`backon`, `tokio-retry`), use it instead of hand-rolling.

Rules that keep retries from making things worse:

- **One layer retries.** Usually the client closest to the flaky dependency. Upper layers fail fast.
- **Bound total time**, not just attempts: stop when the caller's deadline would be exceeded.
- **Honor `Retry-After`** on 429/503 (seconds or an HTTP date).
- **Log the final failure** with the attempt count; log intermediate attempts at debug level or as metrics.
- **Retry budgets** for high-traffic services: cap retries to a fraction (for example 10%) of normal traffic.

## Idempotency

Retrying is only safe if doing the operation twice has the same effect as doing it once.

- Naturally idempotent: GET, PUT with full state, DELETE by id, `INSERT ... ON CONFLICT DO NOTHING`, upserts,
  "set status to shipped" (vs "increment counter").
- Idempotency keys for everything else (payments, emails, order creation): the client generates a unique key
  per logical operation (UUID) and sends it with every attempt; the server stores key -> result under a unique
  constraint and returns the stored result for repeats.

```sql
CREATE TABLE idempotency_keys (
  key         text PRIMARY KEY,
  request_sha text NOT NULL,            -- reject the same key reused with a different payload
  response    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

```ts
// Server sketch: claim the key first, inside the same transaction as the side effect where possible
const claimed = await db.query(
  'INSERT INTO idempotency_keys (key, request_sha) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key',
  [key, sha])
if (claimed.rowCount === 0) return replayStoredResponse(key, sha)   // repeat or in-flight duplicate
```

- Message consumers: queues deliver at least once. Make handlers idempotent (dedupe by message id, or make
  the write itself idempotent) rather than hoping for exactly-once delivery.
- Mutations from the UI: disable the submit button while pending and send an idempotency key, so a double
  click or a retry after a network blip does not create two orders.

## Circuit breakers and fallbacks

When a dependency is down, retrying every request just adds load and latency. A circuit breaker counts
recent failures; above a threshold it "opens" and fails immediately for a cool-down period, then lets a
trial request through ("half-open") to test recovery.

Use one when a dependency failing is common enough to matter and failing fast is better than waiting -
typically service-to-service calls under load. Prefer an existing library or the service mesh
(`opossum` in Node, `pybreaker`, `sony/gobreaker`, Envoy/Istio outlier detection) over a hand-rolled one.

Fallbacks must be honest: serve cached or default data only when stale data is acceptable, and mark it
(for example a "showing cached results" banner). A silent fallback that returns empty lists makes outages
look like "no data".

## Testing resilience

- Fake the dependency to fail N times then succeed; assert the number of attempts and the final result.
- Fake a permanent error; assert there is exactly one attempt.
- Fake a hang; assert the timeout fires and resources are released (use fake timers: `vi.useFakeTimers()`,
  `jest.useFakeTimers()`, injected clocks in Go/Rust, `freezegun`/`time-machine` or injectable sleep in Python).
- Send the same idempotency key twice concurrently; assert exactly one side effect.
