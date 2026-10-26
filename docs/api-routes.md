# API routes

Pages are for reading. For anything else, like form submissions, admin endpoints, files or feeds,
you add a route to the table at the top of `src/server/app.ts`:

```ts
const ROUTES = [
  route("GET", "/api/page", pageData),
  route("POST", "/api/guestbook", signGuestbook),
  route("POST", "/api/admin/notes", createNote),
  route("PUT", "/api/admin/media/:key+", putMedia),
  route("DELETE", "/api/admin/media/:key+", deleteMedia),
  route("GET", "/media/:key+", getMedia),
  route("GET", "/robots.txt", robots),
  route("GET", "/sitemap.xml", sitemap),
];
```

## Adding an endpoint

Write a handler first. The examples live in `src/server/api/`, so put yours next to them:

```ts
// src/server/api/stats.ts
import type { RouteContext } from "../app";
import { json } from "../http";

export async function stats({ app }: RouteContext): Promise<Response> {
  const row = await app.services.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM notes");
  return json({ notes: row?.n ?? 0 });
}
```

Then add it to `ROUTES`:

```ts
route("GET", "/api/stats", stats),
```

Every handler gets this:

```ts
interface RouteContext {
  request: Request;
  app: App;                        // { services: { db, storage? }, secrets, origin?, build, assets? }
  url: URL;
  params: Record<string, string>;  // URLPattern groups, NOT percent-decoded
  user: User | null;               // the signed-in user in --auth projects, otherwise null
  session: Session | null;
}
```

Note that `params` here are raw. If a param can contain encoded characters, run it through
`decodeParams()`.

## How requests get matched

A `HEAD` request is treated as a `GET`. If the path matches a route but the method doesn't, the
answer is `405` with an `Allow` header listing the methods that would work.

An `/api/*` path with no route gets a JSON 404, `{ "error": "not_found" }`. Any other `GET` goes to
the page registry, and any other method gets a `405`.

Responses under `/api/*` are `private, no-store` with `Vary: Origin`, unless you set `Cache-Control`
yourself. That default is deliberate. API answers often depend on who's asking, and it's safer to opt
in to caching than to discover later that something was cached by mistake.

## Errors

When something is wrong, throw an `HttpError`:

```ts
throw new HttpError(404, "not_found");
throw new HttpError(409, "slug_taken");
throw new HttpError(401, "unauthorized", { "WWW-Authenticate": "Bearer" });
```

A single `catch` in `handleRequest` turns it into `{"error": "<code>"}` with that status and those
headers. Make the code something a program can switch on and you can map to a friendly message. The
guestbook's `NOTICES` table does exactly that.

Anything else that's thrown gets logged as one line of JSON, and the client gets a plain `500` that
reveals nothing about what went wrong.

## Helpers

These are in `src/server/http.ts`:

| Helper | What it's for |
| --- | --- |
| `json(data, init?)` | a JSON response, with `nosniff` |
| `redirect(location, status = 303)` | the usual answer to a form post |
| `readJsonBody(request, maxBytes = 8 KB)` | reads a JSON object; 400 if it isn't one, 413 if it's too big |
| `readBody(request)` | reads JSON *or* a URL-encoded form with the same limits, so one handler can serve both `fetch()` and plain forms |
| `readBytes(request, maxBytes)` | raw bytes with a hard limit, checking `Content-Length` and counting as it reads |
| `isFormPost(request)` | `true` for `application/x-www-form-urlencoded` |
| `requireText(value, max, code)` | a trimmed string of 1 to `max` characters, otherwise 400 with `code` |
| `requireId(value)` / `requireOneOf(value, allowed)` | small validators that throw a 400 |
| `decodeParams(groups)` | percent-decodes URLPattern groups; `null` if an escape is broken |
| `sameOrigin(request)` | whether the request came from your own site |
| `guardMutation(request)` | for writes from the browser: 403 if cross-site, 415 unless the body is JSON or a form |
| `requireBearer(request, secret)` | for scripts: 401 unless `Authorization: Bearer <secret>` matches, compared in constant time |

## Writes from the browser

The guestbook handler in `src/server/api/guestbook.ts` is a good template:

```ts
export async function signGuestbook({ request, app }: RouteContext): Promise<Response> {
  guardMutation(request);                   // CSRF + content type, always first
  const fromForm = isFormPost(request);
  try {
    const body = await readBody(request);   // JSON or form, 8 KB max
    const entry = {
      id: crypto.randomUUID(),
      name: requireText(body.name, 60, "invalid_name"),
      message: requireText(body.message, 500, "invalid_message"),
      createdAt: new Date().toISOString(),
    };
    await app.services.db.run("INSERT INTO guestbook (id, name, message, created_at) VALUES (?, ?, ?, ?)",
      entry.id, entry.name, entry.message, entry.createdAt);
    return fromForm ? redirect("/guestbook?notice=signed") : json(entry, { status: 201 });
  } catch (error) {
    // Plain forms can't show JSON errors: send the user back with the error code in the URL.
    if (fromForm && error instanceof HttpError && error.status === 400) {
      return redirect(`/guestbook?notice=${encodeURIComponent(error.code)}`);
    }
    throw error;
  }
}
```

It handles two kinds of caller. The form in `GuestbookPage.tsx` is a real
`<form method="post" action="/api/guestbook">`, so it works before the JavaScript has loaded, or if it
never loads. Those submissions get a redirect back to the page. Once the page has hydrated,
`onSubmit` sends the same fields with `fetch()` and gets JSON back, so the list updates without a
reload. [Examples](examples.md#3-writing-data-the-guestbook) goes through it step by step.

## Endpoints for scripts

For scripts, CI jobs and webhooks, use a token instead of cookies:

```ts
export async function createNote({ request, app }: RouteContext) {
  await requireBearer(request, app.secrets.adminToken);   // 401 unless it matches
  const body = await readJsonBody(request, 256 * 1024);
  …
}
```

`app.secrets.adminToken` comes from the `ADMIN_TOKEN` environment variable. Locally that's in `.env`
on Bun or `.dev.vars` on Cloudflare. In production, set it as an environment variable, or with
`wrangler secret put ADMIN_TOKEN` on Cloudflare. If it isn't set at all, these endpoints refuse
everyone with a 401, which is the safe way to fail.

To add a secret of your own, add a field to `App["secrets"]` in `src/server/app.ts` and fill it in
the platform entry: `src/bun.ts` reads it from `process.env`, `src/worker.ts` from `env`. On
Cloudflare, also add it to `.dev.vars` and run `bun run types`.

## Not included yet

If you need signed-in users, create the project with `--auth github` or `--auth google`, described in
[Sign-in and sessions](auth.md). Handlers then get `ctx.user`, and `requireUser(ctx.user)` answers
401 for anyone who isn't signed in.

Nothing here does rate limiting. The guestbook's hidden honeypot field keeps out simple bots, but it
won't stop someone who is determined. On Cloudflare, use WAF rate limiting rules. On Bun, let your
proxy do it (nginx `limit_req`, Caddy), or keep request counts in a small table.
