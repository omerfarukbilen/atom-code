# Optimization patterns with code

Each pattern lists the symptom you will see in a profile, the fix, and its trade-offs. Apply only after measuring;
re-measure after each change.

## 1. Batch instead of per-item round trips

**Symptom**: many identical small queries/requests per operation; time dominated by network latency, not work.

```ts
// Before: 1 query per id
for (const id of ids) results.push(await db.user.findUnique({ where: { id } }));
// After: 1 query
const users = await db.user.findMany({ where: { id: { in: ids } } });
```

```python
# Bulk insert instead of row-by-row (SQLAlchemy 2.x)
session.execute(insert(Event), [{"type": e.type, "payload": e.payload} for e in events])
# psycopg 3: COPY for very large loads
with cur.copy("COPY events (type, payload) FROM STDIN") as copy:
    for e in events:
        copy.write_row((e.type, e.payload))
```

```go
// Go: one multi-row statement, or pgx.Batch / CopyFrom for PostgreSQL
_, err := conn.CopyFrom(ctx, pgx.Identifier{"events"}, []string{"type", "payload"}, pgx.CopyFromRows(rows))
```

For GraphQL or any resolver-style code, use DataLoader-style batching per request (collect keys during one tick,
issue one query).

**Trade-offs**: large batches increase memory and lock time; chunk huge batches (e.g. 500-5,000 rows).

## 2. Bounded concurrency for independent I/O

**Symptom**: total time = sum of independent latencies; CPU idle.

```ts
import pLimit from "p-limit";
const limit = pLimit(8);                                   // protect the downstream service
const results = await Promise.all(urls.map((u) => limit(() => fetchJson(u))));
```

```python
sem = asyncio.Semaphore(8)
async def bounded(url):
    async with sem:
        return await fetch_json(url)
results = await asyncio.gather(*(bounded(u) for u in urls))
```

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)
results := make([]Result, len(urls))
for i, u := range urls {
	g.Go(func() error {                                    // Go 1.22+: loop vars are per-iteration
		r, err := fetch(ctx, u)
		results[i] = r
		return err
	})
}
err := g.Wait()
```

```rust
use futures::stream::{self, StreamExt};
let results: Vec<_> = stream::iter(urls).map(|u| fetch(u)).buffer_unordered(8).collect().await;
```

**Trade-offs**: unbounded `Promise.all` over thousands of items can exhaust connection pools, file descriptors or rate
limits. Order of completion differs from input order with `buffer_unordered`.

## 3. Caching

**Symptom**: the same expensive computation or fetch repeated with the same inputs.

Choose the narrowest scope that works:

| Scope | Example | Invalidation |
| --- | --- | --- |
| Per call / loop | Hoist `new Intl.NumberFormat()` or a compiled regex out of the loop | None needed |
| Per request | DataLoader, a `Map` passed through the request context | Ends with the request |
| In-process | LRU cache with max size + TTL (`lru-cache`, `functools.lru_cache`, `cachetools.TTLCache`, `moka` in Rust) | TTL, explicit delete on write |
| Shared | Redis/Memcached | TTL + delete/update on write; beware thundering herds |
| HTTP | `Cache-Control`, `ETag` + 304, CDN | Versioned URLs for static assets (`app.3f9a.js` + `immutable`) |

```ts
import { LRUCache } from "lru-cache";
const cache = new LRUCache<string, Price>({ max: 10_000, ttl: 60_000 });

async function getPrice(sku: string): Promise<Price> {
  const hit = cache.get(sku);
  if (hit) return hit;
  const price = await pricingService.fetch(sku);
  cache.set(sku, price);
  return price;
}
// On writes: cache.delete(sku) in the same code path that updates the price.
```

```python
from functools import lru_cache

@lru_cache(maxsize=1024)          # only for pure functions of hashable args
def parse_rules(source: str) -> Rules: ...
```

Avoid the **thundering herd** (many concurrent misses recomputing the same value): store the in-flight promise in
the cache (`cache.set(key, promise)`) or use a single-flight helper (`golang.org/x/sync/singleflight`).

**Trade-offs**: staleness, memory, and invalidation bugs. Never cache per-user data under a key that omits the user
or tenant - that is a data leak, not just a bug.

## 4. Choose the right data structure

| Need | Slow | Fast |
| --- | --- | --- |
| Membership test | `array.includes(x)` / `x in list` in a loop - O(n) | `Set` / `set` - O(1) |
| Lookup by key | `array.find(...)` in a loop | `Map` / `dict` built once |
| Repeated min/max extraction | Sorting after each insert | Heap (`heapq`, `container/heap`, `BinaryHeap`) |
| Queue (pop front) | `array.shift()` / `list.pop(0)` - O(n) | `collections.deque`, ring buffer, index pointer |
| String building in loops | `s += piece` (Python, Java; Go strings) | `"".join(parts)`, `strings.Builder`, `String::with_capacity` |
| Prefix search | Filtering all strings per keystroke | Trie, or a sorted array + binary search |

## 5. Avoid repeated work in loops

```ts
// Before: compiles the regex and creates the formatter for each of 100k rows
rows.map((r) => ({ ...r, ok: new RegExp(pattern).test(r.name), price: new Intl.NumberFormat("en-US", opts).format(r.p) }));
// After
const re = new RegExp(pattern);
const fmt = new Intl.NumberFormat("en-US", opts);
rows.map((r) => ({ ...r, ok: re.test(r.name), price: fmt.format(r.p) }));
```

Note: a regex with the `g` or `y` flag keeps `lastIndex` state between `test` calls - do not share one across calls
unless you reset it.

## 6. Stream instead of loading everything

**Symptom**: memory grows with input size; long pause before the first output.

```ts
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
  handle(line);
}
```

```python
with open(path, encoding="utf-8") as f:
    for line in f:              # iterates lazily
        handle(line)
# DB: server-side cursors / yield_per for large result sets
for row in session.execute(select(Event).execution_options(yield_per=1000)).scalars():
    handle(row)
```

## 7. Database indexes and query shape

```sql
-- Query: WHERE org_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 50
CREATE INDEX CONCURRENTLY idx_invoices_org_status_created
  ON invoices (org_id, status, created_at DESC);           -- equality columns first, then the sort column

-- Keyset pagination instead of OFFSET 100000
SELECT * FROM invoices
WHERE org_id = $1 AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

- Functions on indexed columns (`WHERE lower(email) = ...`) skip the index unless you create an expression index.
- `SELECT *` over wide rows wastes I/O; select needed columns (also enables index-only scans).
- `COUNT(*)` on huge tables is slow in PostgreSQL; consider estimates or cached counts if exact totals are not needed.

## 8. Move CPU work off the critical thread

- Node.js: `worker_threads` (or a pool such as `piscina`) for CPU-heavy tasks (parsing, hashing, image processing),
  so the event loop keeps serving requests. In Electron, keep heavy work out of the main process (it freezes all
  windows) - use a utility process or worker.
- Browser: Web Workers (Comlink simplifies messaging); `OffscreenCanvas` for heavy drawing.
- Python: `multiprocessing` / `concurrent.futures.ProcessPoolExecutor` for CPU-bound work (threads do not help CPU-bound
  pure-Python code under the GIL in standard builds); vectorize with NumPy/Polars.
- Go/Rust: worker pools sized to `runtime.NumCPU()` / rayon's `par_iter()`.

## 9. Reduce allocations on proven hot paths

- Preallocate: `make([]T, 0, n)` (Go), `Vec::with_capacity(n)` (Rust), `new Array(n)` only when filling densely (JS).
- Reuse buffers (`sync.Pool` in Go for short-lived objects under heavy load).
- Avoid intermediate arrays in long chains over big arrays (`.filter().map().reduce()` -> one loop) only when the
  profile shows it matters - readability usually wins.

## 10. Frontend loading

```tsx
// Route-level code splitting
const Settings = lazy(() => import("./routes/Settings"));
<Suspense fallback={<PageSkeleton />}><Settings /></Suspense>
```

```html
<!-- LCP image: high priority, explicit size, never lazy -->
<img src="/hero.avif" width="1200" height="600" fetchpriority="high" alt="Product dashboard showing weekly revenue">
<!-- Below-the-fold images -->
<img src="/feature.webp" width="600" height="400" loading="lazy" decoding="async" alt="...">
<!-- Critical font -->
<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
```

- Import only what you use: `import debounce from "lodash/debounce"` (or `lodash-es`), not `import _ from "lodash"`.
- Avoid barrel files (`index.ts` re-exporting everything) in hot import paths when the bundler cannot tree-shake them.
- Serve compressed assets (brotli/gzip) with long-lived immutable caching for hashed filenames.
