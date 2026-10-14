---
name: performance-optimization
description: Make code measurably faster or leaner - define a target, measure a baseline, profile to find the real bottleneck, fix algorithms and I/O patterns (N+1 queries, missing batching, sequential awaits, missing indexes) before micro-optimizing, add caching safely, find memory leaks, shrink bundles, fix React re-renders and Core Web Vitals, then prove the gain with before/after numbers. Use when something is slow, times out, uses too much memory or CPU, a page loads or responds sluggishly, or the user asks to optimize.
---

# Performance Optimization

Performance work without measurement is guessing, and guesses are usually wrong: the slow part is rarely where
intuition points. The loop is always the same - **measure, find the bottleneck, change one thing, measure again** -
and the deliverable is a number that got better without breaking anything.

## When to use

- "This is slow", timeouts, high latency percentiles, high CPU or memory, OOM crashes, growing memory over time.
- Slow page loads, janky scrolling or typing, poor Lighthouse / Core Web Vitals scores, large bundles.
- Slow test suites, builds or CLI commands.
- Reviewing code for obvious performance hazards (N+1 queries, quadratic loops over large inputs).

Not for: speculative optimization of code that is not on a hot path ("this might be slow someday"). Readable code
that is fast enough beats clever code nobody can maintain. If there is no measurable problem, say so.

## Step 1 - Define the goal

Pin down, with the user if needed (AskUserQuestion):

- **Metric**: p50/p95/p99 latency, throughput (req/s), wall time, CPU time, peak RSS / heap, bundle size (KB gzip),
  LCP/INP/CLS, frames per second, query count.
- **Workload**: which endpoint, input size, dataset, user flow. Performance is only meaningful for a specific workload.
- **Target**: "p95 under 200ms at 50 req/s", "initial JS under 200KB gzip", "import of 100k rows under 30s".
  A target tells you when to stop.

## Step 2 - Measure a baseline

Make the measurement reproducible before changing anything, and write the command down so you can re-run it.

- Use production-like builds: `NODE_ENV=production`, `cargo build --release` / `cargo bench`, Go benchmarks,
  minified frontend builds. Debug builds can be 10-100x slower and distort profiles.
- Warm up (JIT, caches, connection pools), run several iterations, report median and spread (or p95), not a single
  run. Close other heavy processes; note the machine.
- Pick the lightest tool that answers the question:

```bash
hyperfine --warmup 3 'node scripts/build-index.js'              # CLI / script wall time
go test -bench=BenchmarkParse -benchmem -count=10 ./parser       # Go micro/macro benchmarks
cargo bench                                                      # Rust (criterion or built-in bench)
pytest --benchmark-only                                          # Python (pytest-benchmark plugin)
npx autocannon -c 50 -d 20 http://localhost:3000/api/items       # HTTP load (or k6, wrk, oha)
npx lighthouse http://localhost:3000 --only-categories=performance --view   # web page
```

Profiling tools per stack (CPU, memory, flamegraphs, database, browser): [references/profiling-tools.md](references/profiling-tools.md).

## Step 3 - Find the bottleneck

Profile the baseline workload and read the profile before forming a theory.

- **Flamegraph**: width = time. Look for wide plateaus (one function dominating) and "towers" repeated across the
  graph (the same work done many times). Self time tells you where CPU burns; total time tells you which call to
  avoid.
- **Classify the bottleneck**: CPU-bound (computation, serialization, regex, rendering), I/O-bound (database,
  network, disk - CPU is idle while waiting), memory-bound (GC pressure, swapping), or contention (locks, pool
  exhaustion, event-loop blocking).
- **Count I/O**: enable query logging and count queries per request. A request issuing 200 queries is an N+1
  problem regardless of how fast each query is.
- **Amdahl's law**: speeding up something that takes 5% of the time can never save more than 5%. Go after the
  biggest share first.

Write the hypothesis down: "`renderRows` spends 70% of time in `formatDate`, which builds a new `Intl.DateTimeFormat`
per call."

## Step 4 - Fix in order of leverage

Work down this list; the top items routinely give 10-1000x, the bottom ones 1.1-2x.

1. **Do less work**: remove unnecessary work entirely (unused computations, duplicate fetches, re-parsing the same
   data, logging in hot loops, over-fetching columns).
2. **Better algorithms and data structures**: replace O(n^2) scans with a `Map`/`Set`/dict lookup, sort once instead
   of repeatedly, stream instead of loading everything into memory.
3. **Fix I/O patterns**: eliminate N+1 queries, batch writes, add the missing index, run independent I/O
   concurrently, paginate, compress responses.
4. **Cache** results that are expensive and reused - with explicit invalidation, bounded size and TTL.
5. **Parallelize** CPU-bound work across cores (worker threads, multiprocessing, goroutines, rayon) when it is
   genuinely parallel.
6. **Micro-optimizations** (avoiding allocations, hoisting work out of loops, cheaper primitives) only on proven
   hot paths, after the above.

Change **one thing at a time** and re-measure, so you know which change helped and can drop the ones that did not.

### Examples

Quadratic lookup to linear:

```ts
// Before: O(n*m) - 10k orders x 10k users = 100M comparisons
const rows = orders.map((o) => ({ ...o, user: users.find((u) => u.id === o.userId) }));
// After: O(n+m)
const usersById = new Map(users.map((u) => [u.id, u]));
const rows = orders.map((o) => ({ ...o, user: usersById.get(o.userId) }));
```

Sequential to concurrent independent I/O:

```ts
// Before: ~3 x latency
const user = await getUser(id); const orders = await getOrders(id); const prefs = await getPrefs(id);
// After: ~1 x latency (only when the calls are independent)
const [user, orders, prefs] = await Promise.all([getUser(id), getOrders(id), getPrefs(id)]);
```

```python
user, orders, prefs = await asyncio.gather(get_user(id), get_orders(id), get_prefs(id))
```

N+1 queries (one query for the list, then one per row):

```python
# Django - before: 1 + N queries
for order in Order.objects.all():
    print(order.customer.name)
# after: 2 queries (prefetch_related) or 1 join (select_related for FK)
for order in Order.objects.select_related("customer"):
    print(order.customer.name)
```

```ts
// Prisma - include the relation instead of querying inside the loop
const orders = await prisma.order.findMany({ include: { customer: true }, take: 50 });
```

More patterns (batching, caching with invalidation, streaming, worker pools, SQL indexes) with code in several
languages: [references/optimization-patterns.md](references/optimization-patterns.md).

## Step 5 - Memory problems

- **Leak vs high usage**: a leak grows without bound across repeated identical operations; high usage plateaus.
  Run the same operation N times and watch heap/RSS after GC.
- **Find what is retained**: take a heap snapshot after warm-up, repeat the operation many times, take another, and
  compare (Chrome DevTools / `node --inspect` "Comparison" view; Python `tracemalloc` snapshots `compare_to`; Go
  `pprof -base`; Rust `heaptrack`/`dhat`).
- **Usual causes**: unbounded caches or maps keyed by request/user, event listeners and subscriptions never removed,
  timers/intervals not cleared, closures capturing large objects, global arrays used as logs, React effects without
  cleanup, goroutines blocked forever on channels.
- **Fixes**: bound caches (LRU with max size/TTL), remove listeners in cleanup (`return () => off()` in `useEffect`,
  `AbortController` signals), `WeakMap`/`WeakRef` for metadata keyed by objects, stream large files instead of
  buffering, cancel goroutines via `context`.

## Step 6 - Frontend performance

**Core Web Vitals** ("good" at the 75th percentile of real users): LCP <= 2.5s, INP <= 200ms, CLS <= 0.1.

- **LCP**: make the hero image/text arrive early - server-render critical content, `fetchpriority="high"` on the LCP
  image (and never `loading="lazy"` on it), preload critical fonts, cut render-blocking CSS/JS, use a CDN.
- **INP**: keep main-thread tasks under ~50ms; break up long work (`await scheduler.yield()` where supported, or
  `setTimeout` chunks), move heavy computation to a Web Worker, debounce expensive input handlers, avoid layout
  thrashing (reading layout after writing styles in a loop).
- **CLS**: give images/videos/embeds `width` and `height` (or `aspect-ratio`), reserve space for late content,
  use `font-display: swap` with metric-compatible fallbacks.
- **Bundle size**: analyze first (`npx vite-bundle-visualizer`, `npx source-map-explorer 'dist/**/*.js'`,
  `webpack-bundle-analyzer`). Then: route-level code splitting (`React.lazy(() => import("./Settings"))`, dynamic
  `import()`), replace heavy dependencies (moment -> `Intl`/date-fns/dayjs; full lodash -> per-function imports or
  native methods), make sure imports are tree-shakable (ESM, no barrel files that pull everything in), compress
  images (AVIF/WebP, responsive `srcset`).

**React rendering** - profile with the React DevTools Profiler ("Highlight updates" and the flamegraph) before memoizing.

- Check whether the project uses the **React Compiler** (babel-plugin-react-compiler); it memoizes automatically, and
  manual `useMemo`/`useCallback` is then mostly unnecessary.
- Common causes of wasted renders: state held too high (typing in one input re-renders the whole page - move state
  down or split components), new object/array/function props every render defeating `React.memo`, a context value
  that changes on every render re-rendering all consumers (memoize the value or split contexts), unstable `key`s
  (index keys on reorderable lists, `key={Math.random()}`).
- Long lists: virtualize (TanStack Virtual, react-window) instead of rendering thousands of rows.
- Expensive derived data: `useMemo` with correct dependencies; urgent vs non-urgent updates: `useTransition` /
  `useDeferredValue` keep typing responsive while a heavy list re-renders.

```tsx
// Before: every keystroke re-renders 5,000 rows and re-filters on each render
function Page({ items }: { items: Item[] }) {
  const [query, setQuery] = useState("");
  const visible = items.filter((i) => i.name.includes(query));
  return (<><input value={query} onChange={(e) => setQuery(e.target.value)} /><List items={visible} /></>);
}
// After: deferred filtering + memoized list; virtualize List if it still renders thousands of rows
function Page({ items }: { items: Item[] }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(() => items.filter((i) => i.name.includes(deferredQuery)), [items, deferredQuery]);
  return (<><input value={query} onChange={(e) => setQuery(e.target.value)} /><MemoList items={visible} /></>);
}
const MemoList = memo(List);
```

## Step 7 - Database performance

- `EXPLAIN ANALYZE` (PostgreSQL) / `EXPLAIN ANALYZE` or `EXPLAIN FORMAT=JSON` (MySQL 8) / `EXPLAIN QUERY PLAN`
  (SQLite) the slow query. Look for sequential scans on large tables, row estimates far from actual, sorts spilling
  to disk, nested loops over large sets.
- Add indexes that match the `WHERE` + `ORDER BY` pattern (composite, leftmost-prefix order); remember indexes slow
  writes and take space. Create them without long locks in production (`CREATE INDEX CONCURRENTLY` in PostgreSQL) -
  coordinate with `atom:database-migrations`.
- Select only needed columns; keyset pagination instead of large `OFFSET`; batch inserts/updates; use connection
  pooling; find the worst queries with `pg_stat_statements` or the slow query log.

## Step 8 - Verify and report

1. Re-run the exact baseline measurement and compare under the same conditions.
2. Run the test suite - a faster wrong answer is a regression. Check `mcp__atom-ide__get_diagnostics` for the edited
   files.
3. Check for trade-offs: memory vs speed, staleness from caching, added complexity, behavior under concurrency.
4. Report with numbers:

```markdown
| Metric (GET /api/orders, 50 concurrent, 20s) | Before | After | Change |
| --- | --- | --- | --- |
| p50 latency | 180 ms | 32 ms | -82% |
| p95 latency | 640 ms | 71 ms | -89% |
| Queries per request | 102 | 2 | -98% |
| Throughput | 240 req/s | 1,350 req/s | 5.6x |

Cause: N+1 query loading customers per order (src/orders/service.ts:48). Fix: eager-load with one join.
Trade-offs: none observed; memory unchanged (RSS 210 MB -> 214 MB).
```

Revert changes that did not produce a measurable improvement; they add complexity for nothing.

## Common pitfalls

- Optimizing without a profile, or profiling a debug build or a toy dataset.
- Benchmarks the compiler optimizes away (result unused) - use `std::hint::black_box` (Rust), `for b.Loop()`
  (Go 1.24+) or assign results to a package-level sink variable (older Go), and keep results observable in JS
  benchmarks.
- Caching without invalidation (stale data bugs) or without bounds (memory leak).
- `Promise.all` over thousands of items, overwhelming the database or a rate-limited API - limit concurrency
  (e.g. `p-limit`, a worker pool, `asyncio.Semaphore`, `errgroup.SetLimit`).
- `useMemo`/`useCallback` everywhere "just in case" - it costs memory and readability, and is often useless without
  `memo` on the child.
- Declaring victory on one run; ignoring p95/p99 while the median improved.
- Changing behavior (ordering, precision, error handling) as a side effect of optimization.

## Definition of done

- [ ] Goal stated as metric + workload + target.
- [ ] Baseline measured reproducibly; the command is recorded.
- [ ] Bottleneck identified from a profile or query count, not assumed.
- [ ] Highest-leverage fix applied (work removed, algorithm, I/O) before micro-optimizations.
- [ ] Before/after numbers under identical conditions show a meaningful improvement (target met or progress stated).
- [ ] Tests pass; diagnostics clean; trade-offs and remaining hotspots reported.
