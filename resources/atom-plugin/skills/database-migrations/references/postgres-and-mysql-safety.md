# Locking and online DDL reference

Read this when deciding whether a statement is safe on a large or busy table. The danger is rarely the
operation's duration alone; it is the **lock queue**: a DDL statement waiting for an `ACCESS EXCLUSIVE` lock
blocks every later query on the table, even plain `SELECT`s, until it gets the lock and finishes. One
long-running report query plus one `ALTER TABLE` can stall the whole application. Always pair DDL with a
short `lock_timeout` and a retry.

## PostgreSQL

Lock levels from weakest to strongest relevant ones: `ACCESS SHARE` (SELECT) < `ROW EXCLUSIVE` (writes) <
`SHARE UPDATE EXCLUSIVE` (allows reads and writes) < `SHARE` (blocks writes) < `SHARE ROW EXCLUSIVE` <
`ACCESS EXCLUSIVE` (blocks everything, including reads).

| Operation | Lock / cost | Safe alternative |
| --- | --- | --- |
| `CREATE INDEX` | `SHARE` - blocks writes for the whole build | `CREATE INDEX CONCURRENTLY` (`SHARE UPDATE EXCLUSIVE`; slower, two scans, not in a transaction) |
| `DROP INDEX` | `ACCESS EXCLUSIVE` | `DROP INDEX CONCURRENTLY` |
| `REINDEX` | Blocks writes (and reads using the index) | `REINDEX INDEX CONCURRENTLY` (12+) |
| `ADD COLUMN` nullable, no default | `ACCESS EXCLUSIVE`, metadata only - brief | Safe with `lock_timeout` |
| `ADD COLUMN ... DEFAULT <constant>` | Metadata only on 11+ | Safe on 11+; on 10 and older add nullable, backfill, then set default |
| `ADD COLUMN ... DEFAULT <volatile>` (e.g. `gen_random_uuid()`, `clock_timestamp()`) | Full table rewrite under `ACCESS EXCLUSIVE` | Add nullable, set default for new rows, backfill in batches |
| `ALTER COLUMN TYPE` | Usually a full rewrite plus index rebuilds under `ACCESS EXCLUSIVE` | Expand/contract with a new column; exceptions without rewrite: `varchar(n)` to `text`, increasing `varchar(n)` |
| `ALTER COLUMN SET NOT NULL` | `ACCESS EXCLUSIVE` + full scan | `CHECK (col IS NOT NULL) NOT VALID`, `VALIDATE`, then `SET NOT NULL` (12+ skips the scan), drop the check |
| `ADD CONSTRAINT ... CHECK` | `ACCESS EXCLUSIVE` + scan | `NOT VALID`, then `VALIDATE CONSTRAINT` (`SHARE UPDATE EXCLUSIVE`) |
| `ADD CONSTRAINT ... FOREIGN KEY` | `SHARE ROW EXCLUSIVE` on both tables + scan | `NOT VALID`, then `VALIDATE CONSTRAINT` |
| `ADD CONSTRAINT ... UNIQUE` / `PRIMARY KEY` | Builds the index while holding a strong lock | `CREATE UNIQUE INDEX CONCURRENTLY`, then `ADD CONSTRAINT ... UNIQUE USING INDEX <idx>` (brief) |
| `RENAME COLUMN` / `RENAME TABLE` | Brief `ACCESS EXCLUSIVE`, but breaks running code | Expand/contract; for tables, a temporary view with the old name can bridge |
| `DROP COLUMN` | Brief, no rewrite, but breaks code that selects it | Stop referencing (ORM ignore list) first; drop in a later deploy |
| `ALTER TYPE ... ADD VALUE` (enum) | Fast; before 12 cannot run inside a transaction block | Fine; the new value cannot be used in the same transaction that adds it |
| `VACUUM FULL`, `CLUSTER` | Full rewrite under `ACCESS EXCLUSIVE` | `pg_repack` extension, if installed |
| `TRUNCATE` | `ACCESS EXCLUSIVE` | Batched `DELETE` if the table is in use |

### Session settings for migrations

```sql
SET lock_timeout = '3s';            -- fail fast instead of queueing traffic behind the DDL
SET statement_timeout = '15min';    -- bound runaway statements; size for the operation
SET idle_in_transaction_session_timeout = '60s';
```

Retry a `lock_timeout` failure a few times with a pause; if it keeps failing, find the blocker:

```sql
SELECT pid, now() - xact_start AS xact_age, state, wait_event_type, left(query, 120) AS query
FROM pg_stat_activity
WHERE datname = current_database() AND xact_start IS NOT NULL
ORDER BY xact_start;

SELECT pid, pg_blocking_pids(pid) AS blocked_by, left(query, 120) AS query
FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0;
```

### Concurrent index caveats

- Cannot run inside a transaction block - the migration tool must run that statement outside a transaction
  (see the ORM notes for how each tool does it).
- Waits for all transactions that could use the table to finish before completing; a long transaction delays it.
- On failure it leaves an `INVALID` index that still slows writes. Find and drop it:
  ```sql
  SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
  DROP INDEX CONCURRENTLY IF EXISTS idx_name;
  ```

### Replication and backfills

Large writes generate WAL that replicas must replay. Watch lag during backfills and slow down if it grows:

```sql
SELECT client_addr, state, replay_lag FROM pg_stat_replication;   -- on the primary (10+)
```

## MySQL (InnoDB, 8.0+)

- MySQL DDL is not transactional: a migration with several statements that fails halfway leaves the schema
  half changed. Keep one DDL statement per migration.
- Request the online algorithm explicitly so MySQL refuses instead of silently falling back to a blocking table copy:
  ```sql
  ALTER TABLE orders ADD COLUMN note VARCHAR(255) NULL, ALGORITHM=INSTANT;
  ALTER TABLE orders ADD INDEX idx_orders_customer_id (customer_id), ALGORITHM=INPLACE, LOCK=NONE;
  ```
- `ALGORITHM=INSTANT` covers adding columns (any position from 8.0.29; only as the last column before
  that), dropping columns (8.0.29+), and some metadata changes. Most type changes need `ALGORITHM=COPY`,
  which blocks writes - use an online schema change tool (`gh-ost`, `pt-online-schema-change`) for big tables.
- Online DDL still needs a brief metadata lock at start and end; a long open transaction blocks it, and it
  then blocks everything behind it. Set `SET SESSION lock_wait_timeout = 5;` and retry.
- Replicas apply DDL serially: a one-hour online index build on the primary can become one hour of replica lag.

## SQLite

- `ALTER TABLE` supports `ADD COLUMN`, `RENAME COLUMN` (3.25+), `RENAME TO` and `DROP COLUMN` (3.35+, with
  restrictions). Anything else needs the table-rebuild procedure: create the new table, copy rows, drop the
  old table, rename the new one - inside a transaction, with `PRAGMA foreign_keys=OFF` around it and
  `PRAGMA foreign_key_check` afterwards.
- Alembic does this for you with `op.batch_alter_table(...)`; Django and Rails do it automatically for SQLite.
- SQLite locks the whole database for writes, so long migrations block every writer; usually fine for
  embedded or test databases, which is where SQLite tends to be.
