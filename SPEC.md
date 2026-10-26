# Minimal web framework — project spec

A starter template (and later a `create-<name>` CLI) for small, fast websites:
**Preact server rendering + hydration on Cloudflare Workers, with a typed page registry and per-page server loaders.**
People run one command and get a working, well-structured project they can read end to end.

This spec is self-contained: build the project from it in a new, empty folder. It distils what worked
on a personal site (Anna Sorbian's blog), but that site's specifics (Google Drive sync, collections, R2
images, colour-wash animation) are **not** part of the core.

---

## 1. Principles (non-negotiable)

1. **Own, readable code.** No third-party frameworks or routers. Runtime dependencies are only
   `preact` and `preact-render-to-string`. Everything else (routing, data loading, HTTP helpers) is
   our own code, small enough to read in an afternoon.
2. **One explicit page registry**, no file-system routing or folder conventions.
3. **Typed loaders**: server-only data per page; a missing loader is a TypeScript error; database code
   never reaches the browser bundle.
4. **Server-rendered first.** Every URL returns complete HTML. The browser hydrates and then navigates
   client-side, fetching only data through the same loaders.
5. **No build magic.** `bun build` for the browser bundle, Tailwind CLI for CSS, `wrangler` for the
   Worker. No plugins, no code generation beyond `wrangler types`.
6. **Secure by default**: strict CSP, no inline scripts or inline styles, bounded request bodies.
7. **Simplest thing that works.** No suspense, no client caches, no loading screens; prefer a blank
   content area for a few hundred ms over clever machinery.

Tooling: Bun (package manager, bundler, tests), TypeScript strict, Wrangler 4, Tailwind CSS v4 CLI.

## 2. Delivery

- **v1: a GitHub template repo.** Usable immediately with
  `bun create <github-user>/<repo> my-app` (Bun copies it, drops git history, installs deps).
- **v2: an npm package `create-<name>`** so `bun create <name> my-app` / `npm create <name> my-app`
  work. ~50 lines: copy `template/`, replace the project name in `package.json`/`wrangler.jsonc`,
  print next steps. Check the name is free on npm first.

Name: **Klein** (after Yves Klein; also German and Dutch for "small"). Package `create-klein`, so `bun create klein my-app`.

## 3. Project structure (what a generated app looks like)

```
my-app/
  package.json            scripts below; deps: preact, preact-render-to-string
  wrangler.jsonc          Worker, D1 binding, assets, run_worker_first
  tsconfig.json           strict, jsx: react-jsx, jsxImportSource: preact
  migrations/0001_initial.sql
  public/                 static files; everything served lives under public/assets/
    favicon.ico
    assets/               client.js and styles.css are generated here (gitignored)
  src/
    worker.ts             Worker entry: API routes table, page fallback, scheduled() stub
    ssr.tsx               renderDocument(): page → full HTML string with bootstrap data
    browser.tsx           browser entry: decode bootstrap, hydrate <App>
    app.tsx               <App>: server tree or browser tree (router built from the registry)
    bootstrap.ts          Bootstrap type + context (server data embedded in the page)
    router.tsx            our own tiny client router (see §4.6)
    pages/
      registry.tsx        THE list of pages (§4.1) + PageView, pageTitle, pageDescription
      HomePage.tsx        example static page
      NotesPage.tsx       example data page (list)
      NotePage.tsx        example data page with a param + 404
      NotFoundPage.tsx
      ErrorPage.tsx
    server/
      loaders.ts          LOADERS + resolvePage() (§4.2) — server only
      http.ts             HttpError, json(), readJsonBody(), decodeParams(), guards
      db.ts               tiny SQL helpers over D1 (no ORM)
    routes/
      PageRoute.tsx       generic browser route: reuse server data, else fetch /api/page
    components/
      layout/Shell.tsx    frame around every page (nav + content column)
      layout/nav.ts       menu entries
      Link.tsx            plain <a>; the router intercepts same-origin clicks
    hooks/useRemoteData.ts
    styles/app.css        Tailwind entry: tokens, fonts
    shared/types.ts       data types shared by server and browser
  test/
    ssr.test.tsx          server vs browser markup identical; titles from registry
    routing.test.ts       worker.fetch with a fake env: pages, 404, /api/page, 405
```

Rule of thumb: `src/server/**` is never imported by anything the browser bundle imports.

## 4. Core pieces

### 4.1 Page registry — `src/pages/registry.tsx`

```ts
export interface PageDefinition<D> {
  path: string;                                // URLPattern syntax, shared by server and browser: "/notes/:slug"
  hasData: boolean;                            // true → loader in src/server/loaders.ts
  title?: string | ((data: D) => string);      // "<title> — <site name>"; none → site name
  description?: (data: D) => string;           // none → site description
  component: FunctionComponent<{ data: D }>;
}
const staticPage = (p: Omit<PageDefinition<undefined>, "hasData">) => ({ ...p, hasData: false });
const dataPage = <D,>(p: Omit<PageDefinition<D>, "hasData">): PageDefinition<D> => ({ ...p, hasData: true });

export const PAGES = {
  home:  staticPage({ path: "/", component: HomePage }),
  notes: dataPage<NotesData>({ path: "/notes", title: "Notes", component: NotesPage }),
  note:  dataPage<NoteData>({ path: "/notes/:slug", title: (d) => d.note.title, description: (d) => d.note.excerpt, component: NotePage }),
};
export type PageId = keyof typeof PAGES;
export type PageData<K extends PageId> = (typeof PAGES)[K] extends PageDefinition<infer D> ? D : never;
export type DataPageId = { [K in PageId]: PageData<K> extends undefined ? never : K }[PageId];
export type ResolvedPage = { id: PageId; data: unknown } | { id: "not-found" };
export function PageView({ page }: { page: ResolvedPage }) { /* NotFoundPage or PAGES[id].component */ }
export function pageTitle(page: ResolvedPage): string | undefined { /* from registry */ }
export function pageDescription(page: ResolvedPage): string | undefined { /* from registry */ }
```

Adding a page = component + one registry line (+ loader if `dataPage`) + optional nav entry. Nothing else.

### 4.2 Loaders — `src/server/loaders.ts`

```ts
interface LoadContext { env: Env; params: Record<string, string>; query: URLSearchParams }
type Loader<D> = (ctx: LoadContext) => Promise<D | null>;          // null → 404
const LOADERS: { [K in DataPageId]: Loader<PageData<K>> } = { notes: …, note: … };

const PATTERNS = Object.keys(PAGES).map((id) => ({ id, pattern: new URLPattern({ pathname: PAGES[id].path }) }));
export async function resolvePage(env: Env, url: URL): Promise<ResolvedPage>;
// match → decodeParams (URLPattern groups are NOT decoded; malformed % → not-found)
// static → { id, data: undefined }; data → loader; null → { id: "not-found" }
```

Validate query/params inside loaders (e.g. `page` must be an integer 1–10000, else `null`).

### 4.3 Worker — `src/worker.ts`

- A small route table for non-page endpoints: `[method, URLPattern, handler]`, e.g.
  `GET /api/page`, `GET /robots.txt`, `GET /sitemap.xml`. `HEAD` is treated as `GET`.
- Unmatched `/api/*` → JSON 404. Non-GET → 405.
- Any other GET: `resolvePage(env, url)`. If not-found, try `env.ASSETS.fetch(request)` and return it
  unless 404; otherwise render HTML (404 status for not-found). Resolve once per request.
- `GET /api/page?path=/notes/x` → `resolvePage` → `{ id, data }` JSON (public cache 60 s +
  stale-while-revalidate); reject paths not starting with `/` or starting with `//` (400).
- Every `/api/*` response without its own Cache-Control gets `private, no-store` + `Vary: Origin`.
- Handlers throw `HttpError(status, code, headers?)`; one catch turns it into `{ error: code }`.
  Unknown errors → logged as one JSON line, plain 500 with security headers.
- `sitemap.xml` lists registry paths without `:` params (+ optional extra URLs from loaders later).
- Export `{ fetch, scheduled } satisfies ExportedHandler<Env>`; `scheduled` is an empty stub with a comment.

`wrangler.jsonc` assets: `"run_worker_first": ["/*", "!/assets/*", "!/favicon.ico"]` — no per-page lists.

### 4.4 HTML document — `src/ssr.tsx`

`renderDocument(page, site, url)`:
- body = `renderToString(<App page initialUrl site server />)`;
- bootstrap = base64url(JSON) in `data-bootstrap` on `#app` (never an inline script; no escaping holes);
- `<title>` and `<meta description>` from the registry; `<link rel=canonical>` = origin + pathname;
- CSS `/assets/styles.css?v=<build>` and `<script type=module src=/assets/client.js?v=<build>>`;
- skip link to `#main`; `<html lang>` and body classes from Tailwind.

Security headers on HTML: CSP built from a commented array —
`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self';
base-uri 'none'; frame-ancestors 'none'; form-action 'self'` — plus `Referrer-Policy`,
`Permissions-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.
HTML cache: `public, max-age=60, stale-while-revalidate=300` for 200, `no-store` otherwise.

### 4.5 Browser — `src/browser.tsx`, `src/app.tsx`, `src/routes/PageRoute.tsx`

- `browser.tsx`: read `#app[data-bootstrap]`, decode base64url → `Bootstrap { page, initialUrl, site }`, `hydrate(<App {...bootstrap} />)`.
- `App`: `server` → `<Shell path><PageView page/></Shell>`; browser → `<Router><Shell>{routes}</Shell></Router>`.
  Build route components **once at module level** from `PAGES` (stable identities, no remounts).
- `PageRoute({ id })`: static page → render directly; data page → if `url === initialUrl` use the
  bootstrap page (no fetch on hydration), else `fetch('/api/page?path=…')`, 404 → NotFoundPage,
  error → ErrorPage, **while loading render nothing** (no loading text — it only flashes).
- Update `document.title` from the registry after client navigation.
- Hydration must produce identical markup to the server (there's a test for it).

### 4.6 Own router — `src/router.tsx` (~80 lines, replaces preact-iso)

- `LocationContext { url, path, query, navigate(href, { replace? }) }` backed by `history`.
- Intercept clicks on same-origin `<a href>` without `target`, `download`, modifier keys or
  non-left button; `preventDefault`, `pushState`, update state, `scrollTo(0, 0)`.
- `popstate` → update state (no scroll reset).
- Matching: reuse `URLPattern` against `location.href` using registry paths, pass decoded `params`.
- Server rendering doesn't use the router (the server already knows the page).

### 4.7 HTTP helpers — `src/server/http.ts`

`HttpError`, `json(data, init)` (+ nosniff), `readJsonBody(request)` (stream with an 8 KB cap, 413/400,
must be an object), `decodeParams`, `requireId`/`requireOneOf` validators, `sameOrigin(request)`
(Origin + Sec-Fetch-Site), `guardMutation(request)`, `requireBearer(request, secret)` with
constant-time compare via SHA-256 digests. Only what the template's examples use; keep the rest for later.

### 4.8 Database — `src/server/db.ts`, `migrations/`

- D1 with plain SQL; tiny typed helpers: `all<T>(db, sql, ...args)`, `first<T>(…)`, `run(…)`. No ORM.
- Example migration: `notes(id TEXT PK, slug TEXT UNIQUE, title, excerpt, body, published_at)` plus
  an index; `sample.sql` with two notes for `bun run db:sample`.

### 4.9 Styling — Tailwind v4

- `src/styles/app.css`: `@import "tailwindcss" source(none); @source "../";` + `@theme` tokens
  (`--color-background`, `--color-foreground`, `--color-muted`, fonts).
- No inline `style` attributes (CSP blocks them in server HTML) — express variants as classes/tokens.
- Self-host fonts in `public/assets/fonts/` with metric-matched `local(Arial)` fallbacks
  (`size-adjust`, `ascent-override`…) to avoid layout shift.

## 5. Scripts (`package.json`)

```
build:css     tailwindcss -i src/styles/app.css -o public/assets/styles.css --minify
build:client  bun build src/browser.tsx --outdir public/assets --entry-naming client.js --target browser --minify
build:assets  bun run build:css && bun run build:client
dev           bun run build:assets && wrangler dev
dev:css       tailwindcss … --watch
dev:client    bun build … --watch --sourcemap
build         bun run build:assets && wrangler deploy --dry-run --outdir .wrangler-build
deploy        bun run build:assets && wrangler deploy
typecheck     tsc --noEmit
test          bun test
types         wrangler types
db:migrate:local / db:migrate:remote / db:sample
```

`.gitignore`: `node_modules`, `.wrangler`, `.wrangler-build`, `.dev.vars`, `public/assets/client.js*`, `public/assets/styles.css`.

## 6. Tests (bun test, no extra libraries)

- **SSR**: page renders content; bootstrap is an attribute, never inline script; `</script>` in data is harmless;
  titles/descriptions come from the registry.
- **Hydration parity**: for a static page, a data page and not-found,
  `renderToString(<App … />)` (browser tree, with a stubbed `location`) equals the server tree.
- **Routing** (call `worker.fetch` with a fake `env`: `ASSETS`, `DB` stubs): static page 200,
  unknown path 404 page, malformed `%` 404, `/api/page` 200/404/400, POST to a page 405,
  unknown `/api/*` JSON 404 with `no-store`.

## 7. Pitfalls already learned (avoid them)

1. **Stale browser bundle**: after changing page code, `client.js` must be rebuilt or hydration
   reverts server output (e.g. old image paths). `dev`/`deploy` always build; document `dev:client`.
2. `URLPattern` groups are **not** percent-decoded; decode yourself and treat failures as 404.
3. Inline route components (`component={() => …}` created per render) remount pages; define once.
4. Resolve the page **once** per request (don't match then load again).
5. CSP `style-src 'self'` blocks `style="…"` in server HTML (CSSOM changes from JS are fine).
6. Preact suspense needs `preact/compat`'s `Suspense` to be referenced (side-effect imports are
   tree-shaken) — just don't use suspense.
7. Cloudflare static assets don't recompress images: ship WebP at display size (2× for retina).
8. Run `wrangler types` after editing `wrangler.jsonc`; adding a `database_id` switches local D1 to a
   fresh local database (re-run local migrations).
9. Missing glyphs (→ ↗) fall back to system fonts; metric-matched fallbacks keep rendering consistent.
10. Third-party scripts the site needs must be added to the CSP explicitly (script/connect/frame/img).

## 8. Build order and acceptance

1. Scaffold `package.json`, `tsconfig.json`, `wrangler.jsonc`, `.gitignore`; `bun install`; `wrangler types`.
2. `server/http.ts`, `pages/registry.tsx` with Home + NotFound, `server/loaders.ts`, `ssr.tsx`, `worker.ts`.
   ✔ `bun run dev` serves `/` and a 404 page.
3. `router.tsx`, `app.tsx`, `browser.tsx`, `routes/PageRoute.tsx`, `/api/page`.
   ✔ client navigation works, no fetch on first load, title updates, back/forward works.
4. D1 migration + `db.ts` + Notes/Note pages and loaders. ✔ `/notes`, `/notes/:slug`, missing slug → 404.
5. Tailwind + Shell + nav + fonts. ✔ no inline styles; CSP passes with no console errors.
6. Tests (§6). ✔ `bun run typecheck && bun test` green.
7. README: quick start, "add a page in 3 steps", deploy steps (create D1, set `database_id`, migrate, deploy).
8. Make it a GitHub template repo; verify `bun create <user>/<repo> demo && cd demo && bun run dev`.
9. Later: `create-<name>` package; platform interface (DB, storage, static files, scheduler) with
   Bun (`Bun.serve` + `bun:sqlite`) and Node adapters; optional add-ons (content sync from Google
   Drive, R2 media) as separate modules, never in the core.

## 9. Open decisions

- Framework/package name.
- Whether `/api/page` responses should be cached at the edge (Cache API) by default or left to loaders.
- Whether the template ships Tailwind by default or as an option in the CLI.

## 10. Platform, database and storage options (decided)

The core is platform-independent. Cloudflare is one option, not a requirement.

- `create-klein <dir> --db sqlite|pg|d1 --platform bun|cloudflare --storage r2|s3`. Defaults: `--db sqlite`;
  `--platform cloudflare` when `--db d1`, otherwise `bun`; no storage.
- The app only uses the `Database` (`all` / `first` / `run`, portable SQL with `?` placeholders) and `Storage`
  (`get` / `put` / `delete`) interfaces in `src/platform/types.ts`. `src/services.ts` (generated) picks the adapters.
- `src/server/app.ts` exports `handleRequest(request, app)`. Entries: `src/worker.ts` (Workers) and `src/bun.ts`
  (`Bun.serve`, serves `public/`). Site name and description live in `src/site.ts`, not in wrangler vars.
- Adapters: D1 (binding), SQLite (`bun:sqlite`), Postgres (Bun `SQL`, or `postgres` + Hyperdrive on Workers),
  R2 (binding), S3-compatible (Bun `S3Client`; also R2 through its S3 API). Workers + Postgres is the only combination
  that adds a runtime dependency (`postgres`).
- Migrations are the same `migrations/NNNN_name.sql` files everywhere: wrangler applies them for D1;
  `scripts/migrate.ts` for SQLite and Postgres. `GET /media/<key>` serves objects when storage is configured.
- Repo layout: `template/<overlay>/` folders (base, platform, db, storage) + `create-klein/` CLI +
  `scripts/check-variants.ts`, which generates and verifies every combination.
- Per-page `cache` (seconds, default 60, `0` → no-store) applies to the HTML and `/api/page`. After the
  first client navigation, data pages always fetch (bootstrap data is reused only for hydration), so
  pages show fresh data after writes.
- Services may expose `close()`; Workers call it via `ctx.waitUntil` (closes the per-request Postgres client).
- Secrets reach handlers as `App.secrets` (`ADMIN_TOKEN`: `.env` on Bun, `.dev.vars` / `wrangler secret` on Workers).
- Examples shipped in every project: notes (read), guestbook (progressive-enhancement write), admin API
  (bearer), media (storage), scheduled cleanup. Dependencies are pinned to exact, tested versions.
- Full documentation lives in `docs/`.

## 11. Sign-in and sessions (decided)

- `--auth github|google` is opt-in. Only then does the project get `migrations/0003_auth.sql` (`users`, `accounts`,
  `sessions`), `src/server/auth/` (OAuth with PKCE + database sessions), `/account`, a user menu and `test/auth.test.tsx`.
  The CLI adds the registry entry, loader, menu and types to the base files.
- Base projects only carry the seam: an optional `Auth` service (`session()`, `handle()` for `/auth/*`, `prune()`),
  `auth?: "required" | "optional"` on registry pages, `user` / `session` in loader and handler contexts, `user` in
  the bootstrap. Without `--auth` these are always null and nothing changes.
- Sessions: 32-byte random token in an `HttpOnly; Secure; SameSite=Lax` `__Host-` cookie (plain names on
  http://localhost); only its SHA-256 is stored; 30-day absolute lifetime, 7-day idle timeout, rotated on sign-in,
  revocable (sign out / everywhere), pruned by the scheduled job. No JWTs, no passwords.
- Caching: with auth, all page HTML is `private, no-cache` + `Vary: Cookie`; `/api/page` for pages with `auth` is
  `private, no-store`. Loaders of pages without `auth` never see the user, so their data stays cacheable.
- The client router only intercepts links to registry pages; `/auth/*` and other server paths are full navigations.
- No Durable Objects (also for future realtime work).
