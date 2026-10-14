# Codebase map: <project name>

<!-- Report template for atom:project-onboarding. Keep every section scannable; cite path:line for claims.
     Drop sections that do not apply at the chosen depth (quick orientation / area deep-dive / full map). -->

**Depth:** <quick orientation | area deep-dive (<area>) | full map>

## What it is

<One or two sentences: purpose, users, shape (web app, CLI, library, service, monorepo of N packages).>

| | |
| --- | --- |
| Languages | <e.g. TypeScript 5.x (85%), Go 1.22 (15%)> |
| Frameworks | <e.g. Next.js 15, Prisma 6> |
| Package manager | <e.g. pnpm 9 workspaces (lockfile: pnpm-lock.yaml)> |
| Runtime | <e.g. Node 20 (.nvmrc)> |
| Data stores | <e.g. Postgres (docker-compose.yml:12), Redis> |

## Commands

| Task | Command | Verified |
| --- | --- | --- |
| Install | `<cmd>` | <not run - mutates workspace> |
| Typecheck | `<cmd>` | <yes, passes in 14 s> |
| Test (all) | `<cmd>` | <no - needs Postgres> |
| Test (one) | `<cmd>` | <yes> |
| Lint | `<cmd>` | <yes, 3 warnings> |
| Run | `<cmd>` | <not run> |

Source: <CI file:line / package.json:line>.

## Entry points

| Entry | Location | Notes |
| --- | --- | --- |
| HTTP server | `<path>:<line>` | <framework, port> |
| CLI | `<path>:<line>` | <binary name> |
| Worker / cron | `<path>:<line>` | <queue / schedule> |

## Architecture

```text
<dir>/      <responsibility>
<dir>/      <responsibility>
<dir>/      <responsibility>
```

- Dependency direction: <A -> B -> C>. <Any violations seen, with path:line.>
- Boundaries: <where HTTP, DB, queues, filesystem, third-party APIs are touched>.
- Configuration: <how config/env is loaded, path:line; required env vars>.

## Key flow: <name of traced operation>

```text
<path>:<line>   <what happens>
<path>:<line>   <what happens>
<path>:<line>   <what happens>
```

## Conventions

- <convention> (<where observed>)
- <convention> (<where observed>)

## Gotchas

- <gotcha> (<evidence>)
- <gotcha> (<evidence>)

## Not verified / open questions

- <what you did not check and why>
- <questions for the user or team>

## Suggested next steps

- <e.g. "Start the change in src/services/orders.ts:88; tests live in src/services/orders.test.ts">
- <e.g. "Consider adding ATOM.md with the commands above">
