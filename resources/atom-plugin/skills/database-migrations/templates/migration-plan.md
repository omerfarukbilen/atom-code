# Migration plan: <short name>

<!-- Template for atom:database-migrations. Agree on this with the user before writing migrations that span
     more than one deploy. Every phase must be compatible with the app version before and after it. -->

## Goal

<What the schema and data should look like at the end, and why.>

## Context

- Database / version: <PostgreSQL 16 | MySQL 8.0 | SQLite>
- Tool: <Prisma | Drizzle | Django | Alembic | ActiveRecord | golang-migrate | ...>
- Affected tables, size and traffic: <orders - 180 M rows, ~2 k writes/s>
- When migrations run: <before app deploy, in CI pipeline | manually>
- Rollback window before contracting: <e.g. one release / 7 days>

## Phases

| # | Deploy | Schema change | App change | Reversible? | Verify with |
| --- | --- | --- | --- | --- | --- |
| 1 | Expand | <add nullable column / new table / index concurrently> | <dual-write> | yes - drop column | <query> |
| 2 | Backfill | none (batched job) | none | yes - old data intact | <mismatch count = 0> |
| 3 | Switch | <constraint NOT VALID + VALIDATE> | <read new, stop writing old> | yes | <query / tests> |
| 4 | Contract | <drop old column> | <old column ignored in ORM beforehand> | data: no - backup taken | <query> |

## Risky statements and mitigations

| Statement | Lock / risk | Mitigation |
| --- | --- | --- |
| <CREATE INDEX ...> | <blocks writes> | <CONCURRENTLY, own migration, lock_timeout> |

## Backfill

- Script / job: `<path>`; batch size <1000>; pause <50 ms>; resume key <id>.
- Idempotency: <WHERE new_col IS NULL>
- Expected duration on production volume: <estimate from copy>

## Integrity checks

```sql
-- before
<query>  -- expect <result>
-- after
<query>  -- expect <result>
```

## Testing done

- [ ] Applied from scratch on an empty local database
- [ ] Applied on a realistic copy; duration <...>; no long locks observed
- [ ] Up / down / up round trip
- [ ] ORM schema check reports no drift
- [ ] Application tests pass on the migrated schema

## Rollback plan

<Per phase: what to run or revert, and what data, if any, cannot be recovered.>
