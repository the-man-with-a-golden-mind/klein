# Documentation

With Klein you get a small Preact website that is rendered on the server and then hydrated in the
browser. Pages are listed in one registry, and each page gets its data from a loader that runs on
the server. You choose where the site runs (Bun or Cloudflare Workers), which database it uses
(SQLite, Postgres or D1), and whether it gets file storage or sign-in.

## If you're new

Read these three in order. Together they take about half an hour.

1. [Getting started](getting-started.md): create a project, run it, and add your first page.
2. [Architecture](architecture.md): what happens to a request, and why the files sit where they do.
3. [Examples](examples.md): a walk through the example pages that come with every new project.

Wondering whether Klein is the right tool at all? Read
[Why not Astro, Next.js or Fresh?](why-klein.md).

## Guides

| Guide | What it covers |
| --- | --- |
| [Pages and loaders](pages-and-loaders.md) | The page registry, static and data pages, loaders, titles, caching, 404s |
| [Client routing](routing.md) | Links, `useLocation`, and what happens when you press back |
| [API routes](api-routes.md) | Adding endpoints, errors, reading request bodies, forms, tokens |
| [Database](database.md) | The `Database` interface, SQL that runs everywhere, migrations |
| [Storage](storage.md) | Storing and serving files on R2 or S3 |
| [Styling](styling.md) | Tailwind, colour tokens, fonts, dark mode, and why inline styles don't work |
| [Sign-in and sessions](auth.md) | `--auth`: signing in with GitHub or Google, how sessions work, protecting pages |
| [Security](security.md) | What's protected by default and what's up to you |
| [Testing](testing.md) | The tests that come with a project, and how to write your own |
| [Deployment](deployment.md) | Cloudflare, and Bun on a server or in Docker |

## Reference

| Page | What it covers |
| --- | --- |
| [create-klein CLI](cli.md) | Every flag, which combinations are allowed, what gets generated |
| [Troubleshooting](troubleshooting.md) | Things that commonly go wrong, and how to tell |
| [Contributing](../CONTRIBUTING.md) | Working on Klein itself |
