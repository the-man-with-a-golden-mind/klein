# Contributing

Thanks for taking the time. This page is about working on Klein itself, meaning the template, the
CLI and the checks. If you have a question about using it, the [docs](docs/README.md) are the better
place to start.

## Setup

```sh
bun install                 # only the repo's own tooling
```

You need Bun 1.3 or newer. For the Postgres variants you also need a Postgres server where you're
allowed to create databases.

## How the template is put together

There isn't one template. A project is assembled from several folders in `template/`, copied on top
of each other in this order:

| Folder | What's in it | When it's used |
| --- | --- | --- |
| `base/` | the whole platform-neutral app: pages, router, SSR, `src/server/`, tests, migrations | always |
| `cloudflare/` | `src/worker.ts` | `--platform cloudflare` |
| `bun/` | `src/bun.ts` | `--platform bun` |
| `d1/` · `sqlite/` · `postgres/` | `src/platform/db/<db>.ts`, its test, and `scripts/db.ts` for SQLite and Postgres | `--db` |
| `sql/` | `scripts/migrate.ts`, `scripts/sample.ts` | `--db sqlite` or `pg` |
| `r2/` | `src/platform/storage/r2.ts` (the Worker binding) | `--storage r2` on Cloudflare |
| `s3/` | `src/platform/storage/s3.ts` (Bun's `S3Client`) | `--storage r2` or `s3` on Bun |
| `auth/` | `migrations/0003_auth.sql`, `src/server/auth/`, the account page, the user menu, `useUser`, `test/auth.test.tsx` | `--auth github` or `google` |

After copying, `create-klein/index.ts` generates the files that depend on the combination:
`src/services.ts`, `package.json`, `wrangler.jsonc`, the `.env*` and `.dev.vars*` files, and the
"Your setup" section of the README.

`--auth` needs one more step, because it has to add things to files in `base/`: the `/account` page,
its loader, the user menu and `AccountData`. `addAuthToApp()` does that by finding a specific line
in each base file and inserting text next to it. If you change one of those lines, the CLI stops
with an error naming the file, rather than quietly generating a broken project. `bun run check`
then typechecks the result.

A few rules that keep the whole thing working:

- `base/` has to stay platform-neutral. It may only use web-standard APIs (`Request`, `URLPattern`,
  `crypto.subtle`, streams), and it only reaches data through `Database` and `Storage` in
  `src/platform/types.ts`. Nothing in `src/server/` may depend on a specific platform.
- Nothing the browser bundle imports may import `src/server/` or `src/platform/`.
- Generated code should look as if a person wrote it, since people open `src/services.ts` on their
  first day.
- Adding a runtime dependency is a last resort. Right now only Workers + Postgres has one
  (`postgres`).

## Checking your change

The template folders aren't a project you can run by themselves, so generate one:

```sh
bun run new ../playground --db sqlite           # any flags; see docs/cli.md
cd ../playground && bun run dev
```

Before you open a pull request, run the whole matrix:

```sh
CHECK_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres bun run check
```

It generates all 13 combinations and runs `typecheck`, `bun test` and `build` on each one.
Cloudflare variants also get `wrangler deploy --dry-run`. Bun variants get started for real. The
check migrates twice, to make sure the second run does nothing, loads the sample data, starts the
server, requests pages, assets and API endpoints, posts the guestbook form and uses the admin API.
The `--auth` variants also check the sign-in redirect, a seeded session on `/account`, and signing
out.

At the end it packs `create-klein` the way npm would publish it, creates a project from that
package with Node, and tests the result. That last step exists because npm quietly leaves some files
out of packages (`.gitignore`, for one). Before it existed, that would have broken every project
created from the published package, and none of the other checks noticed.

`CHECK_DATABASE_URL` has to point at a server where the script may create and drop `check_*`
databases. Without it, the Postgres database tests are skipped. CI runs exactly this
([.github/workflows/check.yml](.github/workflows/check.yml)).

## Adding a database or storage adapter

1. Create `template/<name>/src/platform/db/<name>.ts` implementing `Database`, plus `exec()` if the
   migration scripts should work with it.
2. Add `template/<name>/test/platform/<name>.test.ts`, which calls `databaseContract()` from
   `test/database-contract.ts`.
3. Teach `create-klein/index.ts` about the new flag value. That means touching the options,
   `overlays()`, `servicesFile()`, `packageJson()`, `envFiles()` and `setupSection()`.
4. Add the new combinations to `VARIANTS` in `scripts/check-variants.ts`.
5. Document it in `docs/database.md` (or `docs/storage.md`) and in `docs/cli.md`.

## Updating dependencies

Versions are pinned exactly, without `^`, in `template/base/package.json` and in `VERSIONS` in
`create-klein/index.ts`. Bump them on purpose, run `bun run check`, and mention the bump in
`CHANGELOG.md`.

## Releasing the CLI

```sh
cd create-klein && npm publish
```

`prepack` bundles `index.ts` for Node into `dist/index.js` and copies `template/` into the package.
It also renames `.gitignore` to `gitignore`, because npm would otherwise drop it; the CLI renames it
back. `postpack` cleans up the copy afterwards.
