---
description: Profile-first performance investigation - set a target, measure a baseline, find the real bottleneck, fix it and prove the gain with before and after numbers
argument-hint: "[slow operation, endpoint, page, function, query or metric to improve]"
---

Investigate and improve the performance of the target below. Follow the `atom:performance-optimization`
skill (load it with the Skill tool; `references/profiling-tools.md` and `references/optimization-patterns.md`
have tools and patterns per stack).

Target from the user: $ARGUMENTS

The rule that makes this work: **measure before you change anything.** Intuition about bottlenecks is wrong
often enough that optimizing without a profile mostly produces complex code that is not faster.

If the target is empty, use the current selection or active editor as the suspect and ask with
AskUserQuestion what feels slow and how it is triggered.

## 1. Define the goal

State the metric and the target: latency (p50/p95) of an endpoint, duration of a command or job, page load
(LCP, INP), memory peak, CPU, bundle size, query time. "As fast as possible" is not a target - ask what "fast
enough" means if the user has not said. Note the environment and data size that matter (production-like data
volume is often the whole story).

## 2. Reproduce and measure a baseline

Build a repeatable measurement and run it several times; report the median (and p95 for latency):

```bash
hyperfine --warmup 3 'node scripts/build-report.js'          # if installed; otherwise time it in a loop
go test -bench=BenchmarkParse -benchmem -count=5 ./parser
cargo bench                                                    # criterion or built-in benches
python -m timeit -s "from app.text import slugify" "slugify('Hello World')"
```

For endpoints use a load tool the project already has, or time repeated requests with `curl -w '%{time_total}\n'`.
For pages, use the browser's Performance panel or Lighthouse with the same throttling each run.

## 3. Profile to find the bottleneck

| Stack | Tooling |
|---|---|
| Node.js | `node --cpu-prof script.js` (open the `.cpuprofile` in Chrome DevTools), `node --heap-prof`, `--inspect` |
| Browser / React | DevTools Performance and Memory panels, React DevTools Profiler, bundle analyzer if configured |
| Python | `python -m cProfile -o out.prof script.py` + `python -m pstats out.prof`, `py-spy record -o profile.svg -- python app.py` (if installed) |
| Go | `go test -bench=. -cpuprofile cpu.out -memprofile mem.out` + `go tool pprof -top cpu.out`, `net/http/pprof` for servers |
| Rust | `cargo flamegraph` (if installed), `perf record` / `perf report` on Linux |
| SQL | `EXPLAIN ANALYZE` (PostgreSQL), `EXPLAIN ANALYZE` / `EXPLAIN FORMAT=JSON` (MySQL), the ORM's query log |

Identify where the time or memory actually goes, with numbers ("62% of wall time in `renderRow`, 1,200 SQL
queries per request"). Do not install profilers without asking.

## 4. Fix in order of leverage

1. Do less work: better algorithm or data structure (a Set instead of `includes` in a loop), avoid repeated
   work, stream instead of loading everything.
2. Fix I/O patterns: N+1 queries (batch, join, prefetch), sequential awaits that can run concurrently (with a
   concurrency limit), missing indexes, missing pagination, chatty network calls.
3. Cache, with explicit invalidation and bounded size, only where the data allows it.
4. Micro-optimizations last, and only in a proven hot path.

Change one thing at a time and re-measure with the same method. Keep a change only if it produces a clear,
repeatable gain; revert changes that do not - they add complexity for nothing.

## 5. Verify and report

Run the tests for everything you touched (performance work is a common source of subtle bugs: caching stale
data, changed ordering, concurrency races) and check `mcp__atom-ide__get_diagnostics`.

```markdown
**Goal:** <metric and target>
**Bottleneck:** <what the profile showed, with numbers> — path:line
**Changes:** <each change> — path:line
| Metric | Before | After | Method |
|---|---|---|---|
| p95 latency `GET /orders` | 840 ms | 120 ms | 5 runs × 200 requests, local, 50k orders |
**Tests:** <commands and results>
**Trade-offs:** <memory for speed, cache staleness window, added complexity>
**Further opportunities:** <ranked by expected gain>
```

Never claim an improvement you did not measure.
