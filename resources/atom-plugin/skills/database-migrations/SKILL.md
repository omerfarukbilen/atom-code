---
name: database-migrations
description: Plan, write and verify safe database schema and data migrations - classify risk and locking, use expand and contract for renames, type changes and drops, create indexes concurrently, add constraints without long locks, backfill in resumable batches, keep migrations reversible, check data integrity, and test against a copy. Use when adding or changing tables, columns, indexes, constraints or enums, writing a data backfill, generating migrations with Prisma, Drizzle, Django, Alembic, ActiveRecord or raw SQL, or reviewing a migration for downtime risk.
---

# Database Migrations

Code deploys are easy to roll back; data changes often are not. A migration runs against live tables while
old and new versions of the application are both serving traffic, and a single statement that takes the
wrong lock can queue every query behind it and take the site down. Safe migrations follow three ideas:
**every step is compatible with the code running before and after it**, **no statement holds a heavy lock
for long**, and **every data change is verified and recoverable**.

## When to use

- Any schema change: new or altered table, column, index, constraint, enum, view, trigger.
- Data migrations and backfills (populate a new column, split or merge tables, fix bad rows).
- Generating migrations with an ORM and reviewing what it produced.
- Reviewing a migration PR for downtime, locking or data-loss risk.

## When not to use

- Query performance with no schema change - use `atom:performance-optimization` (it covers indexes from the query side).
- Designing the API on top of the data - `atom:api-design`.
- Throwaway prototype databases where the user explicitly does not care about data (`prisma db push`,
  `drizzle-kit push` are fine there).

## Safety first: know which database you are touching

Before running any migration command, confirm the target is a local or disposable database. Print the
connection target without leaking credentials:

```bash
printenv DATABASE_URL | sed -E 's#//[^@/]*@#//***@#'     # host and db name only
```

Never run migrations, resets or ad-hoc writes against production or shared environments from the agent -
hand those to the user's deploy pipeline. Commands that wipe data even locally (`prisma migrate reset`,
`rails db:reset`, `drop database`, `alembic downgrade base`) need the user's explicit go-ahead: local data can
still be valuable.

## Process

### 1. Classify the change

| Change | Risk | Approach |
| --- | --- | --- |
| Add table, add nullable column, add column with a constant default (Postgres 11+) | Low | Single migration |
| Add index on a large or busy table | Medium | Create concurrently / online, in its own migration |
| Add NOT NULL, foreign key, unique or check constraint to existing data | Medium | Validate in two steps; check the data first |
| Rename column or table, change type, split/merge columns | High | Expand / contract across several deploys |
| Drop column or table | High (irreversible) | Stop using it first; drop in a later deploy; back up |
| Large backfill or data rewrite | High | Batched, resumable job outside the schema migration |

Find out how big and busy the affected tables are (ask the user, or on a copy:
`SELECT pg_size_pretty(pg_total_relation_size('orders')), reltuples::bigint FROM pg_class WHERE relname = 'orders';`).
A change that is instant on 10 k rows can lock a 200 M-row table for an hour.

### 2. Understand the deploy model

During a rolling deploy, old app instances keep running against the new schema; if the deploy is rolled
back, new-schema data meets old code. So each migration must work with **both** the current and the next
app version. Find out whether migrations run before the app deploy (typical), after it, or manually - it
decides which half of an expand/contract sequence ships in which release.

### 3. Plan non-additive changes as expand / contract

Never rename or retype in place on a live system. Example - rename `users.name` to `users.full_name`:

| Deploy | Schema | Application |
| --- | --- | --- |
| 1 Expand | Add `full_name` (nullable) | Writes both `name` and `full_name`; reads `name` |
| 2 Backfill | Batched copy `name` to `full_name` where null; verify zero mismatches | unchanged |
| 3 Switch | Add NOT NULL on `full_name` (two-step validate) | Reads and writes `full_name`; stops writing `name` |
| 4 Contract | Drop `name` (after the rollback window) | Never references `name` (ORM told to ignore it first) |

Each row is a separate, independently deployable and reversible step. Write the plan with
[templates/migration-plan.md](templates/migration-plan.md) and get the user's agreement on the sequence
before writing code - it spans several releases.

### 4. Write the migration

- One concern per migration file; descriptive names (`20241014_add_orders_customer_id_index`).
- Keep transactions short; never mix a long backfill with DDL in one transaction.
- Set a lock timeout so a blocked DDL statement fails fast instead of queueing all traffic behind it, and
  be ready to retry:

```sql
SET lock_timeout = '3s';          -- give up quickly if the lock is not available, then retry
SET statement_timeout = '15min';  -- size it to the operation: a VALIDATE on a big table can take minutes
```

- Indexes on existing tables: online.

```sql
-- Postgres: cannot run inside a transaction block; keep it alone in its migration
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_customer_id ON orders (customer_id);
-- If it fails it leaves an INVALID index: DROP INDEX CONCURRENTLY idx_orders_customer_id; then retry.
```

- Constraints on existing data: add without scanning, then validate with a weaker lock.

```sql
ALTER TABLE orders ADD CONSTRAINT orders_customer_fk
  FOREIGN KEY (customer_id) REFERENCES customers (id) NOT VALID;      -- brief lock, no scan
ALTER TABLE orders VALIDATE CONSTRAINT orders_customer_fk;            -- scans, but allows reads and writes

-- NOT NULL without a long exclusive scan (Postgres 12+ uses the valid CHECK to skip the scan)
ALTER TABLE users ADD CONSTRAINT users_full_name_nn CHECK (full_name IS NOT NULL) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT users_full_name_nn;
ALTER TABLE users ALTER COLUMN full_name SET NOT NULL;
ALTER TABLE users DROP CONSTRAINT users_full_name_nn;
```

Per-operation lock levels and MySQL / SQLite equivalents are in
[references/postgres-and-mysql-safety.md](references/postgres-and-mysql-safety.md). ORM-specific commands
and how to make each ORM emit the safe form are in [references/orm-notes.md](references/orm-notes.md) -
Read the section for the project's ORM before generating anything.

### 5. Backfill in batches

Backfills are application jobs, not DDL. Make them **batched** (small transactions, short row locks),
**resumable** (track progress by primary key), **idempotent** (safe to re-run; only touch rows that still
need it) and **throttled** (pause between batches so replicas and normal traffic keep up).

```python
# Python + psycopg 3: keyset batches by primary key, each batch its own transaction
import time, psycopg

BATCH = 1000
with psycopg.connect(DSN, autocommit=True) as conn:
    last_id = 0
    while True:
        ids = [r[0] for r in conn.execute(
            "SELECT id FROM users WHERE id > %s ORDER BY id LIMIT %s", (last_id, BATCH))]
        if not ids:
            break
        conn.execute(
            "UPDATE users SET full_name = name WHERE id = ANY(%s) AND full_name IS NULL", (ids,))
        last_id = ids[-1]
        print(f"backfilled through id={last_id}", flush=True)   # resume point if interrupted
        time.sleep(0.05)
```

```sql
-- Bad: one statement, one transaction, every row locked until it finishes; bloats and blocks
UPDATE users SET full_name = name;
```

TypeScript, Django and Rails versions of the same loop are in [references/orm-notes.md](references/orm-notes.md#batched-backfills).

### 6. Keep it reversible - honestly

- Write a down migration (or use the ORM's reversible form) for every schema step, and test it.
- A down migration that re-adds a dropped column restores the column, not the data. For destructive steps,
  say so explicitly, make sure a backup or snapshot exists, and consider keeping the old data (renamed table,
  archive table) for a release before deleting it.
- Data backfills are reversed by the expand/contract structure (the old column still holds the old data),
  not by "un-updating" rows.
- If a step is genuinely irreversible, mark it so (Rails `raise ActiveRecord::IrreversibleMigration`, a
  Django `RunPython` without `reverse_code`, an Alembic `downgrade` that raises) instead of a fake no-op.

### 7. Check data integrity

Run these on a copy before the migration (to see whether it can succeed) and after it (to prove it did):

```sql
SELECT count(*) FROM users WHERE full_name IS NULL;                          -- expect 0 before SET NOT NULL
SELECT count(*) FROM users WHERE full_name IS DISTINCT FROM name;            -- expect 0 while dual-writing
SELECT email, count(*) FROM users GROUP BY email HAVING count(*) > 1;        -- must be empty before UNIQUE
SELECT o.id FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
WHERE o.customer_id IS NOT NULL AND c.id IS NULL LIMIT 20;                   -- orphans block the FK
SELECT count(*) FROM orders;                                                 -- row counts match before/after a copy
```

### 8. Test against a copy

- Apply to a fresh local database from scratch (proves the migration chain is complete) and to a copy with
  realistic volume (proves it is fast enough). Production-derived copies need the user's approval and
  should be anonymized.
- Round trip: up, down, up again on a scratch database.
- Time it, and watch locks while it runs (`SELECT pid, wait_event_type, state, query FROM pg_stat_activity WHERE datname = current_database();`).
- Check that the ORM's model and the database agree: `python manage.py makemigrations --check --dry-run`,
  `alembic check`, `prisma migrate diff` (migrations vs schema), `drizzle-kit generate` reporting no changes,
  Rails `db/schema.rb` diff after `bin/rails db:migrate`.
- Run the application test suite against the migrated schema.

## Common pitfalls

- **Trusting the generated migration.** ORMs turn a rename into drop + add (data loss) and emit blocking
  index and constraint DDL. Read every generated file.
- **Renaming or dropping in one step** while old code still reads the column.
- **Adding NOT NULL or UNIQUE before checking the data** - the migration fails halfway through a deploy.
- **No lock timeout** - a DDL waiting behind one long query blocks every query that arrives after it.
- **Backfill inside the schema migration** - long transaction, replication lag, deploy timeouts.
- **Volatile defaults** (`DEFAULT gen_random_uuid()` when adding a column) rewrite the whole table.
- **Editing a migration that already ran elsewhere.** Others' databases will never re-run it; add a new one.
- **Enum changes**: adding a value is usually fine (Postgres `ALTER TYPE ... ADD VALUE`), removing or renaming
  one needs expand/contract like a column.
- **Interactive generators** (`drizzle-kit generate` rename prompts, `prisma migrate dev` reset prompts) hang
  without a TTY. Use non-interactive flags, or ask the user to run them in the terminal.

## Definition of done

- [ ] Target database confirmed local/disposable; nothing run against shared environments.
- [ ] Change classified; table sizes known; expand/contract plan agreed for non-additive changes.
- [ ] Generated SQL reviewed; heavy DDL replaced by concurrent/online and two-step constraint forms.
- [ ] Backfills batched, resumable, idempotent and separate from DDL.
- [ ] Down migration written and tested, or irreversibility stated with a backup plan.
- [ ] Integrity queries pass before and after; ORM schema check reports no drift.
- [ ] Migration applied from scratch and on a realistic copy, timed; app tests pass on the new schema.
- [ ] Deploy order and rollback steps written down for the user.
