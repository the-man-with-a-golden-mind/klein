# Database

Your code talks to the database through one small interface. That's why the same loaders, handlers
and migrations work on SQLite, Postgres and Cloudflare D1.

```ts
// src/platform/types.ts
interface Database {
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  first<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
}
```

In a loader it's `ctx.services.db`, and in a handler it's `ctx.app.services.db`:

```ts
const notes = await db.all<NoteRow>("SELECT * FROM notes ORDER BY published_at DESC LIMIT ?", 20);
const note  = await db.first<NoteRow>("SELECT * FROM notes WHERE slug = ?", slug);   // or null
const { changes } = await db.run("DELETE FROM guestbook WHERE created_at < ?", cutoff);
```

One warning about the type parameter. Writing `first<NoteRow>` doesn't check anything at runtime,
it's only you telling TypeScript what the query returns. If the query and the type drift apart,
nothing catches it. Keeping each row type next to the queries that use it makes that much less
likely.

## Adapters

| `--db` | Adapter | Driver | Runs on |
| --- | --- | --- | --- |
| `sqlite` | `src/platform/db/sqlite.ts` | `bun:sqlite`, built into Bun, with WAL mode and foreign keys turned on | Bun |
| `pg` | `src/platform/db/postgres.ts` | Bun's built-in `SQL` on Bun; the `postgres` package through Hyperdrive on Workers | both |
| `d1` | `src/platform/db/d1.ts` | the D1 binding | Cloudflare |

`src/services.ts` connects the one you picked:

```ts
// Bun + SQLite
db: sqliteDatabase(process.env.DATABASE_PATH ?? "data/app.sqlite"),
// Bun + Postgres
db: postgresDatabase(new SQL(process.env.DATABASE_URL)),
// Workers + D1
db: d1Database(env.DB),
// Workers + Postgres: a small client per request, closed after the response
const sql = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
return { db: postgresDatabase(sql), close: () => sql.end() };
```

All three adapters have to pass the same test, `test/database-contract.ts`. It checks placeholders,
that `first()` returns `null` when nothing matches, that `run()` counts changed rows, and that a `?`
inside a string literal is left alone.

## Write portable SQL

Placeholders are always `?`. The Postgres adapter rewrites them to `$1, $2, …` before sending the
query, and it skips any `?` inside quotes. That does mean you can't use Postgres operators that
contain a `?`, like the JSONB `?` and `?|`.

Stick to simple column types. Use `TEXT` ids (from `crypto.randomUUID()`), timestamps stored as
ISO-8601 `TEXT`, and `INTEGER`, `REAL` and `TEXT`. ISO strings sort correctly as plain text in every
database, which is the main reason to use them.

For upserts, write `INSERT … ON CONFLICT (col) DO NOTHING` or `DO UPDATE SET …`, which all three
understand. `INSERT OR REPLACE` only works in SQLite.

These differ from one database to another, so avoid them: `AUTOINCREMENT` and `SERIAL`, JSON
operators, `RETURNING`, and date functions (`datetime('now')` in SQLite is `now()` in Postgres).
Work dates out in TypeScript and pass them in as parameters.

Column names come back as you wrote them, except that Postgres lowercases them. Use `snake_case` in
SQL and map to `camelCase` in your code.

None of this is a law. If you know you'll only ever use one database, go ahead and use its features.
Portable SQL is just the default, because it keeps your options open.

## Migrations

Migrations are plain SQL files in `migrations/`, named `NNNN_description.sql` and run in order:

```
migrations/0001_initial.sql      notes table
migrations/0002_guestbook.sql    guestbook table
```

| Database | Locally | In production |
| --- | --- | --- |
| SQLite / Postgres | `bun run db:migrate` | `bun run db:migrate` with the production `DATABASE_PATH` or `DATABASE_URL` |
| D1 | `bun run db:migrate:local` | `bun run db:migrate:remote` |

For SQLite and Postgres, `scripts/migrate.ts` remembers which files it has applied in a
`_migrations` table. Each file runs in a transaction together with the row that records it, so a
migration that fails halfway leaves nothing behind and you can fix it and run it again. D1 keeps its
own record through Wrangler.

**Once a migration has run anywhere, don't edit it.** Other copies of the database, like a
colleague's laptop or production, have already applied the old version and won't run it again.
Write a new migration instead.

### Adding a table

```sql
-- migrations/0003_tags.sql
CREATE TABLE tags (
  note_id TEXT NOT NULL REFERENCES notes (id),
  tag TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);
```

Then run the migrate command. The tests apply every migration to a fresh in-memory database
(`test/test-app.ts`), so they see the new table without any extra work.

## Sample data

`db/sample.sql` has the example content that `bun run db:sample` loads. It uses
`ON CONFLICT DO NOTHING`, so you can run it as often as you like. Replace it with your own data when
you're ready.

## Switching databases later

1. Copy the adapter you want from the Klein repository (`template/<sqlite|postgres|d1>/`) into
   `src/platform/db/`. Bring `scripts/` along too if you want the migration runner.
2. Change `src/services.ts`.
3. Run your migrations against the new database and move your data over.

The rest of the app only knows about `Database`, so nothing else has to change, as long as your SQL
is portable.

## Writing your own adapter

Implement the three methods, plus `exec(script)` if you want `scripts/migrate.ts` to work with it.
Then add a test that calls `databaseContract("mydb", open)` from `test/database-contract.ts`, and
you'll know straight away if it behaves differently from the others. An adapter for MySQL,
libSQL/Turso or Neon's HTTP driver should be about 30 lines.
