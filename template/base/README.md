# klein

This is a small website built with Preact. The server renders each page and the browser takes over
from there. Pages are listed in one registry and get their data from server-side loaders. The only
runtime dependencies are `preact` and `preact-render-to-string`. Routing, data loading and the HTTP
helpers are plain code in `src/`, small enough to read in an afternoon.

The "Your setup" section at the end says which platform, database and storage this copy uses, and
lists the commands to run it and deploy it.

```sh
bun run dev            # build the assets once, then start the server
bun run dev:client     # in a second terminal while you edit pages: rebuilds the browser bundle
bun run dev:css        # in a third terminal when you add Tailwind classes
bun run typecheck && bun test
```

> Keep `dev:client` running while you edit pages. If you don't, the browser takes over the page with
> an old `client.js`, and your change shows up for a moment and then disappears.

## How it fits together

| File | What it does |
| --- | --- |
| `src/pages/registry.tsx` | the list of pages: path, title, description, cache, component |
| `src/server/loaders.ts` | each page's data, loaded on the server, and `resolvePage()` |
| `src/server/app.ts` | the platform-neutral server: `handleRequest(request, app)` and the API route table |
| `src/server/api/*.ts` | the example endpoints: guestbook, admin notes, media |
| `src/server/http.ts` | `HttpError`, `json()`, `redirect()`, body readers, the CSRF and token guards |
| `src/worker.ts` / `src/bun.ts` | the platform entry: builds the `App` and calls `handleRequest` |
| `src/services.ts` | connects the database and storage adapters |
| `src/platform/types.ts` | the `Database` and `Storage` interfaces the rest of the app uses |
| `src/ssr.tsx` | turns a page into a full HTML document, with the bootstrap data and security headers |
| `src/browser.tsx`, `src/app.tsx` | hydration, and the browser's tree built from the registry |
| `src/router.tsx` | the client router: history, link handling, URLPattern |
| `src/routes/PageRoute.tsx` | reuses the server's data on the first load, fetches `/api/page` after that |
| `migrations/` | SQL migrations, applied in order |

Every URL returns a complete HTML page. Once the page has hydrated, links are handled in the browser
and only fetch data, from `/api/page?path=…`, through the same loaders the server used. Browser code
never imports anything from `src/server/` or `src/platform/`, which is what keeps database code and
secrets out of the bundle.

## The examples

| Example | URL | What it shows |
| --- | --- | --- |
| Home | `/` | a page with no data |
| Notes | `/notes`, `/notes/:slug` | reading data: pagination, URL params, 404s, titles from the data |
| Guestbook | `/guestbook` | writing data with a form that works with or without JavaScript, validation, CSRF protection, a honeypot |
| Admin API | `POST /api/admin/notes` | an endpoint for scripts and CI, protected by `ADMIN_TOKEN` |
| Media | `/media/<key>`, `PUT /api/admin/media/<key>` | file storage, in projects created with `--storage` |
| Cleanup job | `runScheduled()` | a scheduled job that removes guestbook entries older than a year |

To try the admin API (the token is in `.env`, or `.dev.vars` on Cloudflare):

```sh
curl -X POST http://localhost:3000/api/admin/notes \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"slug":"from-curl","title":"From curl","body":"Hello."}'
```

## Adding a page

Write the component in `src/pages/AboutPage.tsx`:

```tsx
import type { AboutData } from "../shared/types";
export function AboutPage({ data }: { data: AboutData }) {
  return <h1>{data.heading}</h1>;
}
```

Add a line to `src/pages/registry.tsx`:

```ts
about: dataPage<AboutData>({ path: "/about", title: "About", component: AboutPage }),
```

If the page has no data, use `staticPage({ path, component })` instead and you're done.

Otherwise, add a loader to `LOADERS` in `src/server/loaders.ts`. TypeScript keeps complaining until
you do:

```ts
about: async ({ services: { db } }) => {
  return db.first<AboutData>("SELECT heading FROM about WHERE id = ?", 1);   // null → 404
},
```

If it belongs in the menu, add it to `src/components/layout/nav.ts`. The page now works when loaded
directly and when navigated to, gets its `<title>`, and appears in `/sitemap.xml`.

## Adding an API endpoint

Write a handler (there are examples in `src/server/api/`) and add a line to `ROUTES` in
`src/server/app.ts`:

```ts
route("GET", "/api/stats", stats),
```

To fail, throw `new HttpError(status, "code")`, and the client gets `{"error":"code"}`. Writes that
come from the browser should start with `guardMutation(request)`. Endpoints for scripts should start
with `await requireBearer(request, app.secrets.adminToken)`.

## Database

Loaders get `services.db`, which has `all<T>(sql, ...params)`, `first<T>(…)` and `run(…)`. Use `?` for
placeholders and keep the SQL plain, and the same queries and `migrations/NNNN_name.sql` files will
run on SQLite, D1 and Postgres alike. The Postgres adapter turns `?` into `$1, $2…` for you. Steer
clear of `INSERT OR REPLACE`, `AUTOINCREMENT` and JSON operators. Use `INSERT … ON CONFLICT`, text
ids and ISO-8601 dates stored as text instead.

Once a migration has run somewhere, don't edit it. Add a new one.

## Worth remembering

- There are no inline scripts or styles. The CSP in `src/ssr.tsx` only allows files from your own
  site, so `style="…"` in server HTML is blocked. Use Tailwind classes. Changing styles from
  JavaScript is fine.
- Scripts and embeds from other sites have to be added to the CSP by hand.
- Define components once, at the top level of a module. A component created inside a render
  function gets thrown away and mounted again on every render.
- Check params and query strings inside loaders, and return `null` for anything unexpected.
- Never return a secret from a loader. Whatever a loader returns ends up in the page source.
- Give pages that change after someone does something `cache: 0` in the registry.
- Nothing recompresses your images. Upload WebP at the size you'll display it (twice that for
  high-density screens).

The full documentation, covering architecture, routing, API routes, the database, storage,
security, deployment and troubleshooting, is in the `docs/` folder of the Klein repository.
