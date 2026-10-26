# Changelog

## 0.1.0 (unreleased)

The first version.

- Preact server rendering and hydration, with a typed page registry (`staticPage` / `dataPage`) and
  a loader per page.
- A small client router of its own in `src/router.tsx`, with `useLocation()` and URLPattern
  matching. It only takes over links to pages in the registry. Other links on the same site load
  normally.
- A platform-neutral core, `handleRequest(request, app)`, with entry points for Bun (`Bun.serve`) and
  Cloudflare Workers.
- Database adapters for SQLite (`bun:sqlite`), Postgres (Bun's `SQL`, or `postgres` through
  Hyperdrive on Workers) and D1. They share one portable SQL dialect with `?` placeholders, and all
  pass the same contract tests.
- Storage adapters for R2 (the Worker binding) and anything S3-compatible (Bun's `S3Client`, which
  also covers R2 through its S3 API).
- The `create-klein` CLI with `--db`, `--platform` and `--storage`. A project only contains the
  code for the options you picked.
- A `cache` setting per page, used for both the HTML and `/api/page`. `0` means `no-store`.
- `--auth github|google`: OAuth sign-in with PKCE, users, accounts and sessions in your database, an
  `/account` page, `auth: "required" | "optional"` on registry pages, `user` in loaders, handlers and
  `useUser()`, and cache headers that keep signed-in pages private.
- Examples: a static page, notes (list and detail), a guestbook whose form works without JavaScript,
  an admin API with a bearer token, media upload and serving, and a scheduled cleanup.
- Security defaults: a strict CSP with no inline scripts or styles, a CSRF guard, size limits on
  request bodies, sandboxed media, and constant-time token comparison.
- `bun run check`, which generates all 13 combinations and tests each one, including live smoke tests
  and a project created from the packed npm package.
- Dependencies pinned to exact versions: Preact 11.0.2, preact-render-to-string 6.8.1, Tailwind 4.3.3,
  TypeScript 7.0.2, Wrangler 4.153.0, postgres 3.4.9.
