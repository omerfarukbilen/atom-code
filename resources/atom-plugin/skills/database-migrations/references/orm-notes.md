# ORM and migration tool notes

Read the section for the project's tool before generating or editing a migration. Common theme: generators
produce the *naive* DDL. Your job is to review the output and turn renames, blocking indexes and unchecked
constraints into the safe forms from the main skill.

Run commands through the project's runner (`npx`, `pnpm exec`, `poetry run`, `uv run`, `bundle exec`, `bin/rails`)
and only against a local database you have confirmed (see the main skill).

## Prisma

| Task | Command |
| --- | --- |
| Create + apply in development | `npx prisma migrate dev --name add_full_name` |
| Create without applying (to edit the SQL) | `npx prisma migrate dev --create-only --name add_full_name` |
| Apply pending migrations (CI, staging, prod pipelines) | `npx prisma migrate deploy` |
| Status | `npx prisma migrate status` |
| Mark a failed migration after manual repair | `npx prisma migrate resolve --rolled-back <migration>` or `--applied <migration>` |
| Compare schemas / generate SQL scripts | `npx prisma migrate diff ... --script` (check `--help` for the from/to flags your version supports) |

- `migrate dev` may detect drift and offer to **reset** the database (drops all data). Never accept that on a
  database with data anyone cares about; without a TTY the prompt cannot be answered anyway - ask the user to
  run it in the terminal if it comes up.
- Renaming a field in `schema.prisma` generates `DROP COLUMN` + `ADD COLUMN` - data loss. Either keep the
  database name and rename only in the client with `@map("old_name")` (and `@@map` for models), or use
  `--create-only` and implement the expand/contract steps by hand.
- Prisma emits plain `CREATE INDEX`. For a large table, use `--create-only`, change it to
  `CREATE INDEX CONCURRENTLY`, keep it as the only statement in that migration, and verify on a local
  database that it applies (concurrent index creation fails inside a transaction).
- No down migrations: write the reverse SQL yourself (`migrate diff` can help), keep it with the PR, and rely
  on expand/contract for safe rollbacks.
- `prisma db push` syncs the schema without migration history - prototyping only.
- After schema changes, `npx prisma generate` refreshes the client (`migrate dev` does it automatically).

## Drizzle

| Task | Command |
| --- | --- |
| Generate SQL migration from schema changes | `npx drizzle-kit generate --name add_full_name` |
| Empty migration for hand-written SQL (data changes, concurrent index) | `npx drizzle-kit generate --custom --name backfill_full_name` |
| Apply migrations | `npx drizzle-kit migrate`, or at runtime `migrate(db, { migrationsFolder })` from `drizzle-orm/<driver>/migrator` |
| Check migration history consistency (e.g. after merging branches) | `npx drizzle-kit check` |
| Prototype without migrations | `npx drizzle-kit push` |

- When a column disappears and another appears, `generate` asks interactively whether it was renamed. That
  needs a TTY: ask the user to run it in the ATOM terminal, or avoid the ambiguity by expanding first
  (add the new column in one generation, drop the old one in a later one).
- No down migrations; write and keep reverse SQL manually.
- Check whether your driver's migrator wraps migrations in a transaction before writing
  `CREATE INDEX CONCURRENTLY` in a migration; if it does, run concurrent index creation as a separate step
  outside the migrator.

## Django

| Task | Command |
| --- | --- |
| Generate | `python manage.py makemigrations <app> --name add_full_name` |
| Empty migration (data) | `python manage.py makemigrations <app> --empty --name backfill_full_name` |
| Show SQL for review | `python manage.py sqlmigrate <app> <number>` |
| Apply / roll back | `python manage.py migrate` / `python manage.py migrate <app> <previous_number>` |
| Status | `python manage.py showmigrations <app>` |
| CI check for missing migrations | `python manage.py makemigrations --check --dry-run` |

- Data migrations use historical models, never direct imports - imported models reflect today's code, not
  the schema at that point in history:
  ```python
  from django.db import migrations
  from django.db.models import F

  def forwards(apps, schema_editor):
      User = apps.get_model("accounts", "User")
      User.objects.filter(full_name__isnull=True).update(full_name=F("name"))   # small tables only - batch big ones

  class Migration(migrations.Migration):
      dependencies = [("accounts", "0012_user_full_name")]
      operations = [migrations.RunPython(forwards, reverse_code=migrations.RunPython.noop)]
  ```
  Use `RunPython.noop` as the reverse only when undoing really needs nothing (here the old column still
  holds the data). Omitting `reverse_code` makes the migration irreversible, which is honest when it is.
- Concurrent indexes (Postgres):
  ```python
  from django.contrib.postgres.operations import AddIndexConcurrently
  from django.db import migrations, models

  class Migration(migrations.Migration):
      atomic = False   # concurrent operations cannot run in a transaction
      dependencies = [("orders", "0020_previous")]
      operations = [
          AddIndexConcurrently("order", models.Index(fields=["customer"], name="order_customer_idx")),
      ]
  ```
- `makemigrations` asks interactively about renames ("Did you rename ...?"); in non-interactive runs it does
  not assume a rename. Review the generated operations.
- `SeparateDatabaseAndState` changes Django's model state without touching the database (or the reverse) -
  useful for renaming a model while keeping its table via `Meta.db_table`.
- Django selects every model field by name, so dropping a column that old code still declares breaks old
  instances: remove the field from the model and deploy first, drop the column in a later migration.

## Alembic (SQLAlchemy)

| Task | Command |
| --- | --- |
| Autogenerate from model changes | `alembic revision --autogenerate -m "add full_name"` |
| Empty revision | `alembic revision -m "backfill full_name"` |
| Apply / roll back one | `alembic upgrade head` / `alembic downgrade -1` |
| Render SQL without a database (review) | `alembic upgrade head --sql` |
| State | `alembic current`, `alembic history --verbose`, `alembic heads` |
| Multiple heads after merging branches | `alembic merge -m "merge heads" heads` |
| Check models vs database for pending changes | `alembic check` |

- Autogenerate cannot detect renames (it emits drop + add) and does not catch every kind of change; read the
  generated `upgrade()` and `downgrade()` line by line.
- Concurrent index:
  ```python
  from alembic import op

  def upgrade():
      with op.get_context().autocommit_block():
          op.create_index("ix_orders_customer_id", "orders", ["customer_id"], postgresql_concurrently=True)

  def downgrade():
      with op.get_context().autocommit_block():
          op.drop_index("ix_orders_customer_id", table_name="orders", postgresql_concurrently=True)
  ```
- Two-step constraints: use `op.execute("ALTER TABLE ... NOT VALID")` and `op.execute("ALTER TABLE ... VALIDATE CONSTRAINT ...")`.
- Data migrations: use `op.get_bind()` with `sqlalchemy.text(...)` or lightweight `sa.table()` definitions,
  not the application's ORM models (they describe the current code, not the schema at this revision).
- SQLite: wrap alterations in `with op.batch_alter_table("users") as batch_op:`.

## ActiveRecord (Rails)

| Task | Command |
| --- | --- |
| Generate | `bin/rails generate migration AddFullNameToUsers full_name:string` |
| Apply | `bin/rails db:migrate` |
| Roll back / round trip | `bin/rails db:rollback STEP=1` / `bin/rails db:migrate:redo STEP=1` |
| Status | `bin/rails db:migrate:status` |

- `change` is reversed automatically for reversible operations; use `reversible do |dir| ... end` or explicit
  `up`/`down` otherwise, and `raise ActiveRecord::IrreversibleMigration` when it truly cannot be undone.
- Concurrent index (the migration class version matches your Rails version):
  ```ruby
  class AddIndexToOrdersCustomerId < ActiveRecord::Migration[7.1]
    disable_ddl_transaction!

    def change
      add_index :orders, :customer_id, algorithm: :concurrently
    end
  end
  ```
- Two-step constraints: `add_foreign_key :orders, :customers, validate: false` then, in a separate migration,
  `validate_foreign_key :orders, :customers`. Check constraints (6.1+): `add_check_constraint ..., validate: false`
  then `validate_check_constraint`.
- Before dropping a column: `self.ignored_columns += ["name"]` in the model, deploy, then
  `remove_column :users, :name, :string` (the type keeps it reversible).
- If the project uses the `strong_migrations` gem, it flags unsafe operations; follow its suggestions rather
  than wrapping everything in `safety_assured`.

## Other tools (brief)

| Tool | Create | Apply / revert | Non-transactional statement |
| --- | --- | --- | --- |
| golang-migrate | `migrate create -ext sql -dir db/migrations -seq add_full_name` | `migrate -path db/migrations -database "$DATABASE_URL" up` / `down 1`; after a failure fix the schema, then `force <version>` | Keep the concurrent statement alone in its file (a multi-statement file can run as one implicit transaction in Postgres) |
| goose | `goose -dir db/migrations create add_full_name sql` | `goose -dir db/migrations postgres "$DATABASE_URL" up` / `down` / `status` | `-- +goose NO TRANSACTION` at the top of the file |
| sqlx (Rust) | `sqlx migrate add -r add_full_name` (reversible up/down pair) | `sqlx migrate run` / `sqlx migrate revert` | Check your sqlx version's docs for disabling the transaction |
| Diesel | `diesel migration generate add_full_name` | `diesel migration run` / `revert` / `redo` | `metadata.toml` with `run_in_transaction = false` (Diesel 2) |
| Knex | `npx knex migrate:make add_full_name` | `npx knex migrate:latest` / `migrate:rollback` | `exports.config = { transaction: false }` in the migration |
| TypeORM | `npx typeorm migration:create <path>` or `migration:generate` with your data source (`-d`) | `migration:run` / `migration:revert` (with `-d`) | Review generated SQL; check your version's docs |

## Batched backfills

Same algorithm in every stack: keyset-paginate by primary key, update only rows that still need it, commit
per batch, log the last processed id, pause briefly. Run large backfills as a script, management command,
rake task or job - not inside the schema migration.

```ts
// TypeScript + node-postgres (pg). bigint ids arrive as strings; adjust the type if needed.
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
let lastId = 0
for (;;) {
  const { rows } = await pool.query<{ id: number }>(
    'SELECT id FROM users WHERE id > $1 ORDER BY id LIMIT $2', [lastId, 1000])
  if (rows.length === 0) break
  const ids = rows.map((r) => r.id)
  await pool.query(
    'UPDATE users SET full_name = name WHERE id = ANY($1) AND full_name IS NULL', [ids])
  lastId = ids[ids.length - 1]
  console.log(`backfilled through id=${lastId}`)
  await new Promise((resolve) => setTimeout(resolve, 50))
}
await pool.end()
```

```python
# Django management command body
from django.db.models import F
from accounts.models import User   # fine in a command; in a migration use apps.get_model

last_id = 0
while True:
    ids = list(User.objects.filter(id__gt=last_id).order_by("id").values_list("id", flat=True)[:1000])
    if not ids:
        break
    User.objects.filter(id__in=ids, full_name__isnull=True).update(full_name=F("name"))
    last_id = ids[-1]
    self.stdout.write(f"backfilled through id={last_id}")
```

```ruby
# Rails (rake task or job)
User.unscoped.in_batches(of: 1000) do |batch|
  batch.where(full_name: nil).update_all("full_name = name")
  sleep(0.05)
end
```

```go
// Go + database/sql (Postgres driver with ANY($1) array support, e.g. pgx stdlib)
lastID := int64(0)
for {
	rows, err := db.QueryContext(ctx, `SELECT id FROM users WHERE id > $1 ORDER BY id LIMIT 1000`, lastID)
	if err != nil {
		return fmt.Errorf("select batch after %d: %w", lastID, err)
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	if _, err := db.ExecContext(ctx,
		`UPDATE users SET full_name = name WHERE id = ANY($1) AND full_name IS NULL`, ids); err != nil {
		return fmt.Errorf("update batch after %d: %w", lastID, err)
	}
	lastID = ids[len(ids)-1]
	time.Sleep(50 * time.Millisecond)
}
```
