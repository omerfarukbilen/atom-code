---
name: project-onboarding
description: Rapidly understand an unfamiliar codebase - read existing docs and agent rules, find entry points, verify build, test, lint and run commands, map architecture, module boundaries and data flow, learn conventions and gotchas, then produce a concise codebase map with path-and-line references. Use when opening a new repository, starting work in an unfamiliar area, asked how a project works or is structured, or asked to create or update ATOM.md or CLAUDE.md project rules.
---

# Project Onboarding

Build an accurate mental model of a codebase quickly, then write down only what is worth keeping. The goal
is not to read everything; it is to answer five questions with evidence: *what is this, how do I build and
test it, where does execution start, how does data move, and what will bite me?* Everything you claim should
be traceable to a file (`path:line`) or a command you ran, because a confident but wrong map is worse than
no map - every later decision builds on it.

## When to use

- First session in a repository, or first task in a part of the codebase you have not touched.
- The user asks "how does this project work?", "where is X handled?", "give me an overview".
- Before planning a non-trivial change in unfamiliar code (feed the map into `atom:writing-plans`).
- The user asks to create or refresh `ATOM.md` / `CLAUDE.md`, or runs `/atom:init`.

## When not to use

- A narrow question with an obvious answer ("what does this function return?") - just Read and answer.
- You already onboarded in this chat and nothing structural changed; reuse what you learned.
- Deep investigation of one bug - use `atom:systematic-debugging`; onboarding only gives it a starting map.

## Depth: match the question

Decide the depth before you start, and say which one you chose. Over-exploring burns context you will need
for the actual task.

| Depth | When | Output | Rough budget |
| --- | --- | --- | --- |
| Quick orientation | Small fix in unknown repo | Stack, commands, the 3-5 files that matter | 5-10 tool calls |
| Area deep-dive | Feature work in one module | Map of that module + its boundaries + one traced flow | 10-25 tool calls |
| Full map | "Explain the whole project", writing ATOM.md | Full codebase map (template below) | Delegate in parallel |

For a full map of a large repo, use the Agent tool to spawn `atom:explorer` subagents in parallel - one per
top-level package or layer - each asked to return entry points, responsibilities, key files with `path:line`,
and external dependencies. You then synthesize. This keeps raw file contents out of your own context.

## Process

Track the steps in TodoWrite for a full map so nothing is skipped.

### 1. Read what humans (and agents) already wrote

These files encode intent you cannot infer from code. Read them first, and treat them as claims to verify,
not facts - docs rot.

```text
ATOM.md  CLAUDE.md  AGENTS.md  .cursorrules  .cursor/rules/  .github/copilot-instructions.md
README*  CONTRIBUTING*  docs/  adr/ or docs/adr/  ARCHITECTURE*  CHANGELOG*
.github/pull_request_template.md  .github/CODEOWNERS
```

Use Glob (`**/{README,CONTRIBUTING,ARCHITECTURE,AGENTS,CLAUDE,ATOM}*.md`) rather than guessing paths.
Nested CLAUDE.md / README files in subpackages often carry the most specific rules.

### 2. Inventory the repository

```bash
git ls-files | head -100                                  # shape of the tree (respects .gitignore)
git ls-files | sed -n 's/.*\.\([A-Za-z0-9]*\)$/\1/p' | sort | uniq -c | sort -rn | head -15   # language mix
git log --oneline -15                                     # recent activity and commit style
git log --since="6 months ago" --name-only --format= | sort | uniq -c | sort -rn | head -20     # hot files
git shortlog -sn --since="1 year ago" | head              # active contributors (who to ask)
```

Hot files are where changes happen and where bugs cluster; they deserve a closer read than cold ones. Then
identify the stack from manifest files - see [references/ecosystem-signals.md](references/ecosystem-signals.md)
for what each manifest, lockfile and config file tells you, including monorepo layouts.

### 3. Find the real commands

The source of truth for "how is this built and tested" is CI, not the README: CI runs every day, the README
was written once. Read, in this order:

1. CI config: `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.circleci/config.yml`, `Jenkinsfile`, `azure-pipelines.yml`.
2. Task runners: `package.json` `scripts`, `Makefile`, `justfile`, `Taskfile.yml`, `pyproject.toml`
   (`[tool.poe.tasks]`, `[tool.hatch.envs.*.scripts]`), `noxfile.py`, `tox.ini`, `magefile.go`, `.cargo/config.toml` aliases.
3. Dev environment: `docker-compose.yml`, `.devcontainer/`, `.tool-versions`, `.nvmrc`, `.python-version`,
   `rust-toolchain.toml`, `go.mod` `go`/`toolchain` lines, `.env.example`.

Then verify the cheapest commands actually work - a typecheck, a lint, or a single fast test file:

```bash
npm run typecheck        # or: pnpm typecheck / yarn typecheck (whatever package.json defines)
pytest -x -q tests/unit/test_smallest.py
go build ./... && go test ./internal/somepkg -count=1
cargo check && cargo test -p smallest-crate
```

Ask before running anything with side effects: installing dependencies (rewrites `node_modules`, may touch
the lockfile), database migrations or seeds, `docker compose up`, code generators that overwrite files, or
anything that deploys or calls external services. If dependencies are missing, say which install command
you would run and why.

### 4. Locate entry points

Execution starts somewhere specific; find every "main" the project has (server, CLI, workers, cron jobs,
migrations, build scripts). Common locations:

| Stack | Look at |
| --- | --- |
| Node / TS | `package.json` `main`, `bin`, `exports`, `scripts.start`/`dev`; `src/index.ts`, `src/main.ts`, `server.ts` |
| Next.js / Remix / SvelteKit | `app/` or `pages/` routing dirs, `middleware.ts`, `next.config.*`, `routes/` |
| Electron | `package.json` `main`, `electron.vite.config.*`, `src/main/index.ts`, preload scripts |
| Python | `pyproject.toml` `[project.scripts]`, `__main__.py`, `manage.py`, `main.py`/`app.py`, `wsgi.py`/`asgi.py` |
| Go | `cmd/*/main.go`, any `package main` (`grep -rl '^package main' --include=*.go`) |
| Rust | `src/main.rs`, `src/bin/*.rs`, `[[bin]]` in `Cargo.toml`, `src/lib.rs` for libraries |
| Containers / deploy | `Dockerfile` `CMD`/`ENTRYPOINT`, `Procfile`, `fly.toml`, `serverless.yml`, k8s manifests |

Read each entry point top to bottom: it shows the wiring - config loading, dependency construction, routing,
middleware - which is the skeleton of the architecture.

### 5. Map the architecture

Identify modules and the direction of dependencies between them. Useful Grep probes:

```text
Grep "^import .* from '(\.\./)+" (type: ts)      # cross-module relative imports - layering violations show up here
Grep "process\.env\.|os\.environ|os\.Getenv|env::var"   # configuration surface
Grep "createServer|app\.(get|post)|router\.|@app\.route|http\.HandleFunc|Router::new"   # HTTP surface
Grep "prisma\.|knex|sqlalchemy|gorm|sqlx|diesel|\.objects\."   # persistence layer
```

Record for each major module: its responsibility in one line, its key files, what it depends on, and what
crosses its boundary (HTTP, DB, queue, filesystem, IPC, third-party APIs). Note where I/O happens - that is
where errors, latency and tests get interesting.

### 6. Trace one real flow end to end

Pick the most representative operation (a core API request, the main CLI command, a page load) and follow
it from entry to storage and back, writing each hop as `path:line`. One concrete trace teaches more than ten
directory listings, and it exposes the real layering (which often differs from the documented one).

```text
POST /orders
  src/http/routes/orders.ts:42   validates body with OrderInput (zod)
  src/services/orders.ts:88      createOrder(): computes totals, opens transaction
  src/db/orders.repo.ts:31       INSERT via prisma.order.create
  src/events/publisher.ts:15     emits order.created to the queue (after commit)
  src/workers/email.ts:22        consumer sends confirmation email
```

Use `mcp__atom-ide__open_file` to show the user a key location when it helps them follow along.

### 7. Learn the conventions

Conventions are what reviewers will reject you for. Check:

- Formatting and lint config: `.editorconfig`, `.prettierrc*`, `eslint.config.*`, `biome.json`, `ruff.toml` /
  `[tool.ruff]`, `.golangci.yml`, `rustfmt.toml`, `clippy.toml`.
- Naming, file layout, and test placement (co-located `*.test.ts`, `tests/`, `_test.go`, `#[cfg(test)]`).
- Error handling and logging style (read two or three existing handlers - copy the dominant pattern).
- Commit message style (`git log --oneline -30`) and branch naming.
- Generated code that must not be hand-edited (look for "DO NOT EDIT" headers, `generated/`, `*.pb.go`,
  `*.gen.ts`, Prisma client) and the command that regenerates it.

### 8. Collect gotchas

The things that cost newcomers an hour each: required services, env vars without defaults, slow or flaky
test suites, path aliases, codegen steps, platform quirks, legacy modules nobody should extend, and
"this looks unused but is loaded by reflection/config". Mark each with where you found it.

### 9. Produce the map

Report with [templates/codebase-map.md](templates/codebase-map.md). Keep it scannable: tables and short
bullets, every claim with a `path:line` or a command. State explicitly what you did not verify (for example
"integration tests not run: need Postgres").

## Creating or updating ATOM.md / CLAUDE.md

Both files are project rules for agents. ATOM injects `<workspace>/ATOM.md` into every chat's system prompt
(truncated after 20,000 characters), and the Claude Code harness ATOM runs on loads the project's `CLAUDE.md` as
well. So:

- **One already exists** - update it in place rather than creating a second file that drifts.
- **Neither exists** - propose creating `ATOM.md` from [templates/ATOM.md](templates/ATOM.md). If the team
  also uses the Claude Code CLI, prefer `CLAUDE.md` so a single file serves everyone.
- **Both exist** - keep shared rules in one; do not duplicate content across them.

Ask before creating either file (AskUserQuestion) unless the user explicitly asked for it - it is a committed
file that shapes every future session for the whole team.

What belongs there: facts an agent cannot cheaply infer and that stay true for months. Every line costs
context in every session, so keep it short (well under 200 lines) and verify each command before writing it.

```markdown
<!-- Bad: vague, inferable, or volatile -->
- This project follows best practices and clean code.
- We use React.                                  (obvious from package.json)
- There are 412 files in src/.                   (stale tomorrow)

<!-- Good: specific, verified, saves real time -->
- Run a single API test: `pnpm --filter @acme/api test -- orders.test.ts`
- Integration tests need `docker compose up -d postgres redis` first; they use port 5433, not 5432.
- `src/generated/` is produced by `pnpm codegen` from `schema.graphql` - never edit it by hand.
- Money is integer cents (`Cents` type in `src/lib/money.ts`); never use floats for amounts.
```

Never put secrets, tokens, personal data or internal URLs that should not be committed into these files.

## Common pitfalls

- **Trusting the README over the code.** Verify commands; check CI for the real ones.
- **Reading alphabetically.** Start from entry points and hot files, not from `a/` to `z/`.
- **Mapping folders instead of behavior.** A list of directories is not an architecture; the traced flow is.
- **Running installs or generators "just to see".** They mutate the workspace; ask first.
- **Dumping file contents into the summary.** The user wants a map, not a transcript.
- **Ignoring tests.** Tests are executable documentation of intended behavior and the fastest way to learn an API.
- **Writing ATOM.md full of generic advice.** If a line would be true of any project, delete it.

## Definition of done

- [ ] Stack, package manager and runtime versions identified from manifests.
- [ ] Build, test, lint and run commands found and the cheapest ones actually executed (or reason given).
- [ ] Every entry point listed with `path:line`.
- [ ] Modules, their responsibilities and boundaries mapped; one real flow traced end to end.
- [ ] Conventions and gotchas recorded with where they came from.
- [ ] Map delivered using the template, with unverified items called out.
- [ ] If ATOM.md / CLAUDE.md was created or updated: user agreed, every command in it was verified, no secrets.
