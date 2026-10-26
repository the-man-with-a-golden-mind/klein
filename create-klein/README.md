# create-klein

This creates a small website built with Preact. The server renders every page and the browser takes
over from there. It runs on Bun or Cloudflare Workers, with SQLite, Postgres or D1.

```sh
bun create klein my-app
cd my-app && bun run db:migrate && bun run db:sample && bun run dev
```

What you get is a starting point, not a dependency. The project is a few hundred lines of readable
code on top of Preact, and from then on it's yours to change. The only code in it is for the setup
you picked.

```sh
bun create klein my-app --db pg                          # Bun + Postgres
bun create klein my-app --db d1                          # Cloudflare Workers + D1
bun create klein my-app --db d1 --storage r2             # … with R2 file storage
bun create klein my-app --db pg --platform cloudflare    # Workers + Postgres via Hyperdrive
bun create klein my-app --auth github                    # any of these, plus sign-in
```

You need [Bun](https://bun.sh) 1.3 or newer. The documentation, with a getting-started guide, is in
the Klein repository. MIT licensed.
