# Deployment

Every project's `README.md` ends with a "Your setup" section that lists the deploy commands for that
exact combination. If you just want to get it online, follow those. This page explains what the
commands do, and covers the things you'll want to know afterwards.

## Before you deploy

```sh
bun run typecheck && bun test
```

`bun run build` and `bun run deploy` always rebuild `client.js` and `styles.css` first. You can't
accidentally ship an old browser bundle.

---

## Cloudflare Workers

The first time, log in:

```sh
npx wrangler login
```

### With D1

```sh
npx wrangler d1 create my-app            # prints a database_id; paste it into wrangler.jsonc
bun run types                            # regenerate worker-configuration.d.ts
bun run db:migrate:local                 # a new database_id also means a new, empty local database
bun run db:migrate:remote                # apply the migrations to the real D1
npx wrangler secret put ADMIN_TOKEN      # only if you use /api/admin/*
npx wrangler secret put GITHUB_CLIENT_ID # --auth only (GOOGLE_… for Google), and GITHUB_CLIENT_SECRET
bun run deploy
```

With `--auth`, also register `https://<your-domain>/auth/callback` as the callback URL of your
OAuth app ([Sign-in and sessions](auth.md#setting-it-up)).

### With Postgres (Hyperdrive)

A Worker can run in hundreds of places around the world, and opening a fresh database connection
from each one, for every request, would be slow. Hyperdrive solves that by keeping a pool of
connections close to your database. The Worker connects to Hyperdrive, which is fast, and Hyperdrive
reuses connections it already has open.

```sh
npx wrangler hyperdrive create my-app --connection-string="postgres://user:pass@host:5432/db"
# paste the id into wrangler.jsonc under "hyperdrive"
bun run types
DATABASE_URL="postgres://user:pass@host:5432/db" bun run db:migrate   # migrations run from your machine or CI
npx wrangler secret put ADMIN_TOKEN
bun run deploy
```

The Worker opens a small client for each request and closes it once the response has gone out. That
happens in `close` in `src/services.ts`, called through `ctx.waitUntil`.

### With R2

```sh
npx wrangler r2 bucket create my-app     # the name in wrangler.jsonc, under r2_buckets
```

### Good to know

Files in `public/assets/` and `/favicon.ico` are served by Cloudflare directly. Every other request
goes to the Worker first (`run_worker_first`), which falls back to static files for paths it doesn't
know.

The `?v=` on `client.js` and `styles.css` is the deployment's version id. Each deploy changes it, so
browsers never hold on to an old bundle.

To run `runScheduled()` (the guestbook cleanup) on a schedule, add a cron expression to
`triggers.crons` in `wrangler.jsonc`, for example `["0 * * * *"]` for every hour.

Logging is switched on (`observability`). Errors show up as JSON lines in the dashboard, or live in
your terminal with `npx wrangler tail`.

To use your own domain, add it in the dashboard under Workers → your worker → Domains & Routes.

---

## Bun

On Bun, the whole site is one process, `bun src/bun.ts`. It serves `public/` and the app on `PORT`,
3000 by default.

### On a server

```sh
bun install --production
bun run build                 # client.js + styles.css
bun run db:migrate            # the SQLite file or the Postgres database from the environment
PORT=3000 ORIGIN=https://example.com ADMIN_TOKEN=… bun run start
```

The environment variables are listed in `.env.example`:

| Variable | What it's for |
| --- | --- |
| `PORT` | the port to listen on (3000 by default) |
| `ORIGIN` | your public address, e.g. `https://example.com`. Set this behind a proxy, so canonical links and the sitemap use the public URL rather than `localhost:3000`. |
| `DATABASE_PATH` | the SQLite file (`data/app.sqlite` by default) |
| `DATABASE_URL` | the Postgres connection string |
| `S3_*` | storage credentials, if you use storage |
| `ADMIN_TOKEN` | turns on `/api/admin/*` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (or `GOOGLE_…`) | the OAuth client, in `--auth` projects. Set `ORIGIN` too, so the callback URL uses your public address. |
| `BUILD_ID` | the asset version used for `?v=`. It defaults to the time the server started, which works fine. |

To keep it running and restart it after a crash or a reboot, use systemd:

```ini
# /etc/systemd/system/my-app.service
[Unit]
Description=my-app
After=network.target

[Service]
WorkingDirectory=/srv/my-app
ExecStart=/usr/local/bin/bun src/bun.ts
EnvironmentFile=/srv/my-app/.env
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

Then put something in front of it that handles HTTPS. Caddy is the least work, since it fetches
certificates for you:

```
example.com {
  reverse_proxy localhost:3000
}
```

### With Docker

```dockerfile
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.3
WORKDIR /app
COPY --from=build /app /app
ENV PORT=3000
EXPOSE 3000
# SQLite: mount a volume at /app/data. Postgres: pass DATABASE_URL.
CMD ["sh", "-c", "bun scripts/migrate.ts && bun src/bun.ts"]
```

```sh
docker build -t my-app .
docker run -p 3000:3000 -v my-app-data:/app/data -e ORIGIN=https://example.com -e ADMIN_TOKEN=… my-app
```

This works on any host that runs containers, such as Fly.io, Railway, Render or Kubernetes.

If you use SQLite, give the container a persistent volume and run **only one** instance. SQLite is a
file on a disk, and two machines can't share it. Your data would split in two without any error.
With Postgres, run as many instances as you like.

### Scheduled jobs on Bun

`src/bun.ts` runs `runScheduled()` every hour with `setInterval`. With several instances, every one
of them runs the job. For something like the guestbook cleanup that doesn't matter, because deleting
old rows twice does no harm. For a job that mustn't run twice, remove the interval and trigger it
from one place instead, such as a cron job calling a script or an admin endpoint.

### Caching on Bun

Pages are sent with `Cache-Control: public, max-age=60, stale-while-revalidate=300`, or `no-store`
for pages with `cache: 0`. On Bun nothing acts on that unless you put a CDN or a caching proxy in
front. You probably don't need one, because the server is fast enough for most small sites without
it.
