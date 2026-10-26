# Examples

Every new project comes with a few examples of things small sites usually need. Each one takes a few
minutes to read and has tests. Keep them around as a reference, or delete them once you have pages
of your own; the last section explains how.

| # | Example | What it shows | Files |
| --- | --- | --- | --- |
| 1 | Home | a page with no data | `pages/HomePage.tsx` |
| 2 | Notes | reading data: a paginated list, a detail page, 404s | `pages/NotesPage.tsx`, `pages/NotePage.tsx`, `server/loaders.ts` |
| 3 | Guestbook | writing data from a form that works with or without JavaScript | `pages/GuestbookPage.tsx`, `server/api/guestbook.ts` |
| 4 | Admin notes API | an endpoint for scripts, protected by a token | `server/api/notes.ts` |
| 5 | Media | storing and serving files | `server/api/media.ts` |
| 6 | Scheduled cleanup | a job that runs on its own every so often | `runScheduled` in `server/app.ts` |
| 7 | Account (only with `--auth`) | signing in, a page for signed-in people, signing out everywhere | `pages/AccountPage.tsx`, `server/auth/` |

The commands below use `http://localhost:3000`, which is where Bun runs. On Cloudflare, use
`http://localhost:8787` instead. Some of them need the admin token, which lives in `.env` (Bun) or
`.dev.vars` (Cloudflare). This puts it in your shell:

```sh
export ADMIN_TOKEN=$(sed -n 's/^ADMIN_TOKEN=//p' .env)    # or .dev.vars
```

---

## 1. A static page: Home

```ts
home: staticPage({ path: "/", component: HomePage }),
```

There's no loader and no data. When you navigate to it from another page, it appears instantly,
without asking the server for anything. About pages, legal pages and landing pages usually look like
this.

## 2. Reading data: Notes

The list is at `/notes?page=2`. The loader checks `page`, then asks for one row more than it shows.
If that extra row comes back, there's an older page, and the "Older" link appears.

```ts
notes: async ({ services: { db }, query }) => {
  const page = pageNumber(query);                      // absent → 1; must be 1–10000
  if (page === null) return null;                      // ?page=abc → 404
  const rows = await db.all<…>(
    "SELECT slug, title, excerpt, published_at FROM notes ORDER BY published_at DESC LIMIT ? OFFSET ?",
    NOTES_PER_PAGE + 1, (page - 1) * NOTES_PER_PAGE,
  );
  if (page > 1 && rows.length === 0) return null;      // past the last page → 404
  return { notes: rows.slice(0, NOTES_PER_PAGE).map(toSummary), page, hasMore: rows.length > NOTES_PER_PAGE };
},
```

Each note has its own page at `/notes/:slug`. Its title and description come from the note itself:

```ts
note: dataPage<NoteData>({
  path: "/notes/:slug",
  title: (d) => d.note.title,
  description: (d) => d.note.excerpt,
  component: NotePage,
}),
```

A few things worth trying:

- Open `/notes/hello-world` with the network tab open, then click "All notes". You'll see a single
  `/api/page` request and no HTML.
- Open `/notes/nope`. You get the not-found page with a real 404 status, which matters for search
  engines.
- The body of a note is plain text split into paragraphs. None of it is ever treated as HTML, so a
  note can't inject markup into the page.

## 3. Writing data: the Guestbook

This is the most complete example. Signing the guestbook works before the JavaScript has loaded,
without JavaScript at all, and with it.

```
                        ┌── no JS ──→ POST form → 303 → /guestbook?notice=signed → page shows "Thanks"
<form method="post" ────┤
 action="/api/guestbook">└── JS ─────→ fetch() JSON → 201 entry → added to the list in place
```

The page, `GuestbookPage.tsx`, renders a real `<form method="post" action="/api/guestbook">`. Without
JavaScript, the browser submits it the old-fashioned way. Once the page has hydrated, `onSubmit` takes
over, sends the same fields as JSON, and either adds the new entry to the top of the list or shows
the error message that matches the code it got back.

The handler, `api/guestbook.ts`, works through these steps:

1. `guardMutation(request)` refuses requests from other sites (that's CSRF protection) and anything
   that isn't JSON or a form.
2. `readBody(request)` reads JSON or a form, up to 8 KB.
3. `requireText(body.name, 60, "invalid_name")` validates each field and fails with a code the page
   knows how to explain.
4. A hidden field called `website` catches bots. People never see it, but bots tend to fill in every
   field they find. If it has a value, the handler pretends everything went fine and stores nothing.
5. A form post gets a redirect, either `?notice=signed` or `?notice=invalid_name`. A `fetch()` gets
   JSON.

The page sets `cache: 0` in the registry, so it's never cached and a reload right after signing
shows your entry.

Try it with JavaScript switched off in devtools, then with it on, and then from the terminal:

```sh
curl -i -X POST http://localhost:3000/api/guestbook \
  -H "Origin: http://localhost:3000" -H "Content-Type: application/json" \
  -d '{"name":"Ada","message":"Hello from curl"}'
# 201 {"id":"…","name":"Ada","message":"Hello from curl","createdAt":"…"}

curl -i -X POST http://localhost:3000/api/guestbook \
  -H "Origin: https://evil.example" -H "Content-Type: application/json" -d '{}'
# 403 {"error":"cross_origin"}
```

## 4. An endpoint for scripts: admin notes

`POST /api/admin/notes` creates a note. It's meant to be called from a script, a CI job or a CMS
webhook, not from a browser:

```sh
curl -i -X POST http://localhost:3000/api/admin/notes \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"slug":"from-the-api","title":"From the API","body":"Created with curl.\n\nSecond paragraph.","excerpt":"Hello"}'
# 201 {"slug":"from-the-api","url":"/notes/from-the-api"}
```

| Response | When |
| --- | --- |
| 201 | the note was created |
| 400 `invalid_slug` / `invalid_title` / `invalid_body` / `invalid_excerpt` / `invalid_published_at` | a field didn't validate |
| 401 | the token is missing or wrong, or `ADMIN_TOKEN` isn't set |
| 409 `slug_taken` | there's already a note with that slug |
| 413 | the body is over 256 KB |

The interesting parts are `requireBearer()`, one endpoint having a bigger body limit than the
default, the 409 for a conflict, and the way the secret reaches the handler through `app.secrets`.

Here's a small publishing script, say for text files kept in a repository:

```ts
// scripts/publish.ts: bun scripts/publish.ts my-note "My note" note.txt
const [slug, title, file] = process.argv.slice(2);
const res = await fetch(`${process.env.SITE_URL ?? "http://localhost:3000"}/api/admin/notes`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ slug, title, body: await Bun.file(file!).text() }),
});
console.log(res.status, await res.text());
```

## 5. File storage: media

This only does anything in projects created with `--storage`. [Storage](storage.md) has the details.

```sh
curl -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: image/svg+xml" \
  --data '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>' \
  http://localhost:3000/api/admin/media/img/square.svg
# 201 {"key":"img/square.svg","url":"/media/img/square.svg"}

curl -i http://localhost:3000/media/img/square.svg      # the file, with an ETag and a sandboxing CSP
```

Then use it in a page: `<img src="/media/img/square.svg" alt="" width={10} height={10} />`.

## 6. A scheduled job: guestbook cleanup

```ts
export async function runScheduled(services: Services): Promise<void> {
  const removed = await pruneGuestbook(services.db);   // DELETE … WHERE created_at < one year ago
  console.log(JSON.stringify({ level: "info", message: "scheduled run", guestbookRemoved: removed }));
}
```

On Cloudflare, give it a schedule in `wrangler.jsonc`, for example
`"triggers": { "crons": ["0 3 * * *"] }` for every night at three. To try it locally, run
`npx wrangler dev --test-scheduled` and then `curl "http://localhost:8787/__scheduled"`.

On Bun there's nothing to set up. `src/bun.ts` calls it once an hour.

## 7. Signing in: Account (`--auth` projects)

You get this with `--auth github` or `--auth google`. Once you've added the OAuth credentials
([setup](auth.md#setting-it-up)):

1. Click **Sign in** in the header. It takes you to `/auth/sign-in?next=<this page>`, then to the
   provider, and back again, signed in.
2. Your name is now in the header, linking to `/account`.
3. `/account` lists every browser you're signed in on. It has `auth: "required"` in the registry,
   so its loader can read your sessions, and its data is never cached publicly.
4. **Sign out** ends the session in this browser. **Sign out everywhere** ends all of them. Both are
   plain forms.

```sh
curl -i http://localhost:3000/account
# 303 Location: /auth/sign-in?next=%2Faccount

curl -s "http://localhost:3000/api/page?path=/account"
# {"error":"sign_in_required"}
```

---

## Removing the examples

When you're ready to replace them with your own content:

1. Delete their entries from `PAGES` in `src/pages/registry.tsx`, along with their components,
   loaders, shared types and menu entries.
2. Delete their routes from `ROUTES` in `src/server/app.ts`, and the files in `src/server/api/`.
   Keep `media.ts` if you use storage.
3. Empty out `runScheduled()`.
4. Write a migration that drops the example tables (`DROP TABLE guestbook;`). Don't edit the
   migrations that created them.
5. Replace `db/sample.sql`, and update the tests that use the examples: `test/routing.test.ts`, the
   parity cases in `test/ssr.test.tsx`, and `NOTES` in `test/test-app.ts`.

You don't have to find everything yourself. Run the typecheck and the tests and they'll point at
whatever you missed.
