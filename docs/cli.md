# create-klein

```
create-klein <dir> [--db sqlite|pg|d1] [--platform bun|cloudflare] [--storage r2|s3] [--auth github|google] [--no-install]
```

| Flag | Values | Default |
| --- | --- | --- |
| `--db` | `sqlite`, `pg` (`postgres` and `postgresql` work too), `d1` | `sqlite`, or `d1` with `--platform cloudflare` |
| `--platform` | `bun`, `cloudflare` | `cloudflare` with `--db d1`, otherwise `bun` |
| `--storage` | `r2`, `s3` | none |
| `--auth` | `github`, `google` | none. Adds sign-in with that provider, and users and sessions in the database ([Sign-in and sessions](auth.md)) |
| `--no-install` | | dependencies are installed unless you pass this |

`<dir>` must not exist yet, or must be empty. Its name gets reused as the package name, the Worker
name, the database and bucket names (lowercased, with `-` between words), and the site title, so
`my-app` becomes "My App".

## Combinations

| Command | Server | Database | Storage |
| --- | --- | --- | --- |
| `create-klein app` | Bun | SQLite | |
| `create-klein app --storage r2` | Bun | SQLite | R2 (through the S3 API) |
| `create-klein app --storage s3` | Bun | SQLite | S3-compatible |
| `create-klein app --db pg` | Bun | Postgres | |
| `create-klein app --db pg --storage s3` | Bun | Postgres | S3-compatible |
| `create-klein app --db d1` | Workers | D1 | |
| `create-klein app --db d1 --storage r2` | Workers | D1 | R2 (binding) |
| `create-klein app --db pg --platform cloudflare` | Workers | Postgres (Hyperdrive) | |
| `create-klein app --db pg --platform cloudflare --storage r2` | Workers | Postgres (Hyperdrive) | R2 (binding) |

`--auth` works with any of them, for example `create-klein app --db d1 --storage r2 --auth github`.

A few combinations don't make sense, and the CLI refuses them with a hint. `--db d1` on Bun should be
`sqlite`, `--db sqlite` on Cloudflare should be `d1`, and `--storage s3` on Cloudflare should be
`r2`.

## What it does

First it copies template folders on top of each other: `base`, then the platform, the database
adapter, the migration scripts (for SQLite and Postgres), the storage adapter and, with `--auth`,
the `auth` folder. That last one contains `migrations/0003_auth.sql`, `src/server/auth/`, the account
page, the user menu and their tests.

Then it writes the files that depend on your choices:

| File | What goes in it |
| --- | --- |
| `src/services.ts` | creates the database and storage adapters, plus `sessionAuth()` with `--auth` |
| `package.json` | the name; the `dev`, `build`, `deploy` or `start` and `db:*` scripts; `wrangler` or `postgres` when needed |
| `wrangler.jsonc` | Cloudflare only: assets, the D1, Hyperdrive or R2 bindings, and `nodejs_compat` for Postgres |
| `.env.example`, `.env` | Bun: `PORT`, `ORIGIN`, the database, `S3_*`, `ADMIN_TOKEN`. Postgres on Cloudflare: `DATABASE_URL` for the migration scripts. |
| `.dev.vars.example`, `.dev.vars` | Cloudflare: `ADMIN_TOKEN` |
| … with `--auth` | `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (or `GOOGLE_…`) as well, left empty, with a note on where to get them |
| `src/pages/registry.tsx`, `src/server/loaders.ts`, `src/components/layout/Shell.tsx`, `src/shared/types.ts` | `--auth` only: adds the `/account` page, its loader, the user menu and `AccountData` |
| `README.md` | the project guide, with a "Your setup" section of commands for this setup |
| `src/site.ts` | the site name |
| `.gitignore` | adds `.wrangler` and `.dev.vars` (Cloudflare) or `data/` (Bun) |

`.env` and `.dev.vars` get values that work locally straight away, including a random `ADMIN_TOKEN`.
Both are gitignored.

After that it runs `bun install`, plus `bun run types` on Cloudflare, unless you passed
`--no-install`. Finally it prints the commands to run next.

## Versions

Dependencies are pinned to exact versions, without `^`. These are the versions Klein's own
`bun run check` tested together. Your project won't pick up a new version by surprise. When you want
to upgrade, run `bun update` and test it.
