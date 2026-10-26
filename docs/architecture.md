# Architecture

Klein is a few hundred lines of code in your project, sitting on top of Preact. This page explains
how those lines connect, so that the rest of the source makes sense when you read it.

## The ideas behind it

All of the code lives in your project. Routing, data loading and the HTTP helpers are files in
`src/`, not a package. The only runtime dependencies are `preact` and `preact-render-to-string`,
plus the `postgres` driver if you run Postgres on Workers. When something misbehaves, the code you
need to read is code you can open and change.

Pages are listed explicitly. There's one registry file. Nothing gets routed because of where a file
happens to sit, and no folder names carry any meaning.

The server renders first. Every URL returns a complete HTML page. The browser then hydrates it,
meaning Preact attaches to the HTML that's already there instead of drawing it again. From then on,
clicking a link fetches only the data for the next page, from the same loader the server used.

I've left things out on purpose. There are no suspense boundaries, no client-side cache, no loading
spinners and no build plugins. Each of these solves a real problem, but none of them solve a problem
that a small site has.

## Where things live

```
src/
  pages/registry.tsx      the list of pages: path, title, description, cache, component
  pages/*.tsx             page components; each gets { data }
  server/loaders.ts       the server-side data for each page, and resolvePage(url)
  server/app.ts           handleRequest(request, app): API routes, pages, errors
  server/api/*.ts         the example endpoints: guestbook, admin notes, media
  server/http.ts          HttpError, json(), redirect(), body readers, guards
  ssr.tsx                 renderDocument(): turns a page into a full HTML document
  app.tsx                 <App>, which builds the server tree or the browser tree
  browser.tsx             the browser entry: reads the bootstrap data and hydrates
  bootstrap.ts            the data the server embeds in the HTML for the browser
  router.tsx              the client router (about 100 lines)
  routes/PageRoute.tsx    in the browser: reuses the server's data on first load, fetches after that
  platform/types.ts       the Database, Storage and Auth interfaces
  platform/db/*.ts        the database adapter for your setup
  platform/storage/*.ts   the storage adapter, if you have one
  services.ts             generated; connects the adapters
  worker.ts | bun.ts      the entry point for your platform
  site.ts                 site name and description
  server/auth/            only with --auth: OAuth sign-in and sessions
  shared/                 types and helpers both sides use
  components/             the layout (Shell), nav, Link, NoteDate
  styles/app.css          the Tailwind entry file
```

There's one rule here worth remembering. Nothing the browser bundle imports may import anything from
`src/server/` or `src/platform/`. That's what stops database code and secrets from ending up in
`client.js`. If both sides need some piece of code, put it in `src/shared/`.

## Following a request

Here's what happens when someone opens `/notes/hello-world`:

```
GET /notes/hello-world
        │
        ▼
src/bun.ts or src/worker.ts      builds an App { services, build, assets, secrets }
        │
        ▼
handleRequest()  (src/server/app.ts)
  1. is it in the API route table? (/api/*, /media/*, robots.txt, sitemap.xml) → its handler
  2. an unknown /api/* path → JSON 404; any method but GET → 405
  3. resolvePage(services, url)
        │   "/notes/:slug" matches, so params = { slug: "hello-world" }
        │   the "note" loader runs and returns { note }, or null
        ▼
  4. nothing found? try a static file, then fall back to the 404 page
  5. renderDocument(page, site, url)  (src/ssr.tsx)
        │   renderToString(<App page … server />)
        │   <title>, description and canonical link come from the registry
        │   the data is base64url JSON, in #app[data-bootstrap]
        ▼
  HTML, with the CSP and the Cache-Control header from the page's `cache` setting
```

The browser receives that HTML and shows it right away. Then `src/browser.tsx` reads
`data-bootstrap`, decodes it, and calls `hydrate(<App …/>)`. The browser builds its component tree
from the same registry, so it produces the same markup the server sent, and a test checks that for
every page. Since the data came along with the HTML, the first load makes no extra requests.

## Clicking a link

```
click <a href="/notes">
  router.tsx      a link to a known page: stop the browser, call history.pushState
  <Routes>        "/notes" matches the registry, so render PageRoute id="notes"
  PageRoute       a data page, so fetch /api/page?path=/notes (nothing is shown meanwhile)
  /api/page       resolvePage() runs the same loader and returns { id, data } as JSON
  PageView        renders NotesPage with that data and updates document.title
```

Static pages don't need data, so they render straight away. Data pages always go through
`/api/page`, which uses the same loaders as a full page load. Data reaches a page in exactly one
way, which leaves one place to look when it's wrong.

## Why the data is base64 in an attribute

The obvious approach is an inline `<script type="application/json">` holding the data. That would
force a hole in the Content Security Policy for inline scripts, and you'd have to escape the data
carefully in case it contains `</script>`.

A base64url string only contains letters, digits, `-` and `_`. You can drop it into a `data-`
attribute and nothing in it can break out, so the CSP stays at `script-src 'self'`. The cost is that
the data is about a third bigger.

## Running on different platforms

The core, meaning `src/server/app.ts` and everything it imports, only uses web-standard APIs:
`Request`, `Response`, `URL`, `URLPattern`, `crypto.subtle` and streams. It reaches data through two
interfaces:

```ts
interface Database { all<T>(sql, ...params); first<T>(sql, ...params); run(sql, ...params) }
interface Storage  { get(key); put(key, body, { contentType }); delete(key) }
```

Each platform has a small entry file that builds an `App` and passes requests to `handleRequest`.
The differences between the platforms are confined to those entry files:

| | Cloudflare (`src/worker.ts`) | Bun (`src/bun.ts`) |
| --- | --- | --- |
| Server | the Workers runtime | `Bun.serve` |
| Static files | Workers Static Assets (`env.ASSETS`) | `serveStatic()` reading `public/` |
| Asset version (`?v=`) | the deployment's version id | `BUILD_ID`, or the time the server started |
| Secrets | `env.ADMIN_TOKEN` (`.dev.vars` / `wrangler secret`) | `process.env.ADMIN_TOKEN` |
| Scheduled jobs | Cron Triggers call `scheduled()` | an hourly `setInterval` |

`src/services.ts`, which the CLI generates, is the only file that mentions a specific database or
storage adapter.

## What it doesn't do

There's no client-side cache. Navigating to a data page always asks the server again. The browser's
own HTTP cache still applies, depending on the page's `cache` setting.

There's no loading indicator. While a data page loads, the content area stays empty for a moment.
For a small, fast site that usually feels calmer than a spinner flashing up and vanishing.

There's no code splitting. The whole browser bundle is about 25 KB, and splitting it would add more
machinery than it would save.

There's no streaming and no suspense. A page renders once its loader is done.
