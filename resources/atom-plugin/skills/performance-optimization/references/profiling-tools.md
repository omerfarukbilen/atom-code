# Profiling and benchmarking tools by stack

Pick the tool that answers your current question: *where does time go* (CPU profiler / flamegraph), *where does
memory go* (heap profiler), *what is the process waiting on* (tracing, query logs), or *did my change help*
(benchmark). Third-party tools may not be installed - check with `command -v <tool>` and ask before installing
anything.

## Node.js / TypeScript (backend, scripts, Electron main)

CPU profile without extra tools (writes a `.cpuprofile` you can open in Chrome DevTools > Performance, or
speedscope.app):

```bash
node --cpu-prof --cpu-prof-dir=./profiles dist/server.js      # profile written on process exit
node --heap-prof dist/server.js                               # sampling heap profile (.heapprofile)
node --inspect dist/server.js                                 # then chrome://inspect -> Profiler / Memory tabs
node --prof app.js && node --prof-process isolate-*.log > processed.txt   # V8 tick profiler, text output
```

- **Flamegraphs**: `npx 0x dist/server.js` (generates an interactive flamegraph HTML). Clinic.js (`clinic doctor`,
  `clinic flame`, `clinic bubbleprof`) still works but is no longer actively maintained.
- **Heap snapshots**: DevTools Memory tab, or programmatically `v8.writeHeapSnapshot()`; compare two snapshots
  (Comparison view, sort by "# Delta" / "Size Delta") to find leaks.
- **Event-loop blocking**: `perf_hooks.monitorEventLoopDelay()`; long synchronous work shows as wide frames on the
  main thread in the CPU profile.
- **Micro-benchmarks**: `tinybench` or `mitata` libraries; Vitest has `vitest bench`.
- **HTTP load**: `npx autocannon -c 50 -d 30 URL`; `k6 run script.js`; `oha -z 30s -c 50 URL`; `wrk -t4 -c50 -d30s URL`.
- **Timing in code**: `performance.now()`, `console.time()` / `console.timeEnd()` for quick checks (remove afterwards).

## Browser / frontend

- **Chrome DevTools Performance panel**: record an interaction; inspect long tasks (red corners, > 50ms), the
  main-thread flamegraph, layout/recalculate-style events (layout thrashing), and the Interactions track for INP.
- **Lighthouse**: `npx lighthouse URL --only-categories=performance --view` (lab data; use a production build and
  throttling presets). PageSpeed Insights shows field data (CrUX) for public sites.
- **Field metrics in your app**: the `web-vitals` library (`onLCP`, `onINP`, `onCLS`) reporting to analytics.
- **React DevTools Profiler**: record, then inspect commits, "Why did this render?" (enable in settings), and
  "Highlight updates when components render". `<Profiler onRender>` API for programmatic measurement.
- **Bundle analysis**: `npx vite-bundle-visualizer` (Vite/Rollup), `rollup-plugin-visualizer`,
  `webpack-bundle-analyzer`, `npx source-map-explorer 'dist/assets/*.js'` (needs source maps), `npx esbuild-visualizer`
  with an esbuild metafile. Check dependency cost before adding a package (bundlephobia.com / pkg-size.dev).
- **Coverage tab** in DevTools: shows unused JS/CSS shipped on a page.

## Python

```bash
python -m cProfile -o out.prof script.py        # deterministic profiler, stdlib
python -m pstats out.prof                        # then: sort cumtime / stats 20
py-spy record -o profile.svg -- python script.py # sampling profiler, flamegraph, low overhead
py-spy top --pid 12345                           # live view of a running process
py-spy dump --pid 12345                          # stack of every thread right now (hangs, deadlocks)
scalene script.py                                # CPU + memory + GPU, line-level
python -m memray run script.py && python -m memray flamegraph memray-script.py.*.bin
```

- `line_profiler` (`kernprof -l -v script.py` with `@profile` decorators) for line-by-line timing of a hot function.
- `tracemalloc` (stdlib): `tracemalloc.start()`, take snapshots, `snapshot2.compare_to(snapshot1, "lineno")` to find
  growth.
- Visualize cProfile output with `snakeviz out.prof`.
- Benchmarks: `pytest-benchmark` (`pytest --benchmark-only`, `--benchmark-compare`), `python -m timeit` for snippets,
  `pyperf` for rigorous runs.
- Django: `django-debug-toolbar` (query count per page), `connection.queries` with `DEBUG=True`; SQLAlchemy:
  `echo=True` on the engine to log queries.

## Go

```bash
go test -bench=. -benchmem -count=10 ./... > new.txt
benchstat old.txt new.txt                                  # golang.org/x/perf/cmd/benchstat
go test -bench=BenchmarkX -cpuprofile cpu.out -memprofile mem.out ./pkg
go tool pprof -http=:8080 cpu.out                          # interactive UI with flamegraph
go tool pprof -http=:8080 -base before.heap after.heap     # diff two heap profiles
go test -trace trace.out ./pkg && go tool trace trace.out  # scheduler, GC, blocking
```

- Live services: `import _ "net/http/pprof"` and fetch `/debug/pprof/profile?seconds=30`, `/debug/pprof/heap`,
  `/debug/pprof/goroutine?debug=2` (goroutine leaks). Do not expose this endpoint publicly.
- Escape analysis: `go build -gcflags=-m ./...` shows which values escape to the heap (allocation hot spots).
- Race detector (`go test -race`) for contention-related correctness while optimizing concurrency.

## Rust

```bash
cargo bench                                   # criterion benches in benches/ (stable), or #[bench] on nightly
cargo flamegraph --bin myapp -- args          # cargo install flamegraph; uses perf (Linux) / dtrace (macOS)
samply record ./target/release/myapp          # sampling profiler, opens Firefox Profiler UI
perf record -g ./target/release/myapp && perf report     # Linux
heaptrack ./target/release/myapp              # heap allocations (Linux)
```

- Build profiles with debug symbols for readable stacks: in `Cargo.toml` `[profile.release] debug = true` (or a
  custom `[profile.profiling]` inheriting release) - with the user's agreement since it edits config.
- `dhat` crate for allocation profiling in tests; `criterion` reports statistically significant changes between runs.
- `cargo build --timings` for slow compile times.

## JVM (if present)

- async-profiler (`asprof -d 30 -f flame.html <pid>`), JDK Flight Recorder (`jcmd <pid> JFR.start duration=60s
  filename=rec.jfr`, open in JDK Mission Control), JMH for benchmarks.

## Databases

- PostgreSQL: `EXPLAIN (ANALYZE, BUFFERS) SELECT ...`; `pg_stat_statements` for the most expensive queries by total
  time; `auto_explain` for slow queries in logs; check `pg_stat_user_tables` for sequential scans.
- MySQL 8: `EXPLAIN ANALYZE SELECT ...`; slow query log (`long_query_time`); `performance_schema` digests.
- SQLite: `EXPLAIN QUERY PLAN SELECT ...`; `.timer on` in the CLI.
- MongoDB: `.explain("executionStats")`; profiler (`db.setProfilingLevel(1, { slowms: 100 })`).
- Redis: `SLOWLOG GET 10`; `redis-cli --latency`; avoid `KEYS` in production (use `SCAN`).

## Whole-system and CLI

- `hyperfine --warmup 3 'cmd A' 'cmd B'` compares commands statistically; `--export-markdown` for reports.
- `time` / `/usr/bin/time -v` (Linux; peak RSS as "Maximum resident set size").
- `htop`, `iostat`, `vmstat` to tell CPU-bound from I/O-bound; `strace -c -f cmd` to count syscalls (Linux).
- Slow builds: use the bundler's own stats output (e.g. `webpack --profile --json > stats.json`),
  `tsc --extendedDiagnostics` for TypeScript compile time, and `tsc --generateTrace ./trace` to find slow types
  (analyze with `npx @typescript/analyze-trace ./trace`).

## Reading a flamegraph

- X axis is *not* time order; it is the set of sampled stacks sorted alphabetically. Width = share of samples.
- Y axis is stack depth. The top edge of each column is the function on CPU (self time).
- Wide frames near the top: hot leaf functions - optimize or call less often.
- Wide frames lower down whose children are many small slices: overhead spread across callees - consider avoiding the
  call path entirely.
- Recurring identical sub-stacks across the graph: repeated work - cache or hoist it.
- In-browser profiles: look for long purple (layout/style) and green (paint) blocks interleaved with scripting -
  the signature of layout thrashing.
