# Pages and loaders

Each page has an entry in `src/pages/registry.tsx`. If the page needs data, it also has a loader in
`src/server/loaders.ts`. Most of this page is details of those two things.

## The registry

```ts
export const PAGES = {
  home: staticPage({ path: "/", component: HomePage }),
  notes: dataPage<NotesData>({ path: "/notes", title: "Notes", component: NotesPage }),
  note: dataPage<NoteData>({
    path: "/notes/:slug",
    title: (d) => d.note.title,
    description: (d) => d.note.excerpt,
    component: NotePage,
  }),
  guestbook: dataPage<GuestbookData>({ path: "/guestbook", title: "Guestbook", cache: 0, component: GuestbookPage }),
};
```

| Field | What it does |
| --- | --- |
| `path` | A [URLPattern](https://developer.mozilla.org/docs/Web/API/URL_Pattern_API) path such as `/notes/:slug` or `/files/:path+`. The server and the browser both use it. When two patterns match, the one that comes first in the registry wins. |
| `title` | A string, or a function that gets the page's data and returns one. It's shown as "Title — Site name". Leave it out and you get just the site name. |
| `description` | A function from the data to the `<meta name="description">` text. Leave it out and the description from `src/site.ts` is used. |
| `cache` | How many seconds browsers and CDNs may reuse the HTML and the page data. The default is 60, with `stale-while-revalidate` set to five times that. `0` means `no-store`. |
| `auth` | Only in `--auth` projects. `"required"` sends anonymous visitors to sign in, and `"optional"` lets them in. See [Sign-in and sessions](auth.md#pages-auth-in-the-registry). |
| `component` | The Preact component. It gets `{ data }`. |

There are two kinds of page. A `staticPage()` has no loader, and its component gets
`data: undefined`. A `dataPage<D>()` needs a loader that returns a `D`.

About `cache`: 60 seconds is fine for content that changes now and then. Set it to `0` for any page
that should change as soon as someone does something. The guestbook uses `0`; otherwise someone who
signs it and reloads might not see their own entry.

### Adding a page

1. Write the component in `src/pages/`.
2. Add a line to `PAGES`.
3. If it's a `dataPage`, write its loader. TypeScript shows an error until you do.
4. Add it to `src/components/layout/nav.ts` if it belongs in the menu.

That's it. The server route, the client route, the `/api/page` endpoint, the title and the sitemap
entry all come from the registry line.

## Loaders

A loader is an async function that runs on the server and returns a page's data. This is what it
receives:

```ts
interface LoadContext {
  services: Services;              // { db, storage? }
  params: Record<string, string>;  // decoded URL params, e.g. { slug: "hello-world" }
  query: URLSearchParams;          // the query string
  user: User | null;               // the signed-in user, only for pages with `auth`
  session: Session | null;
}
type Loader<D> = (ctx: LoadContext) => Promise<D | null>;   // null means 404
```

`LOADERS` has the type `{ [K in DataPageId]: Loader<PageData<K>> }`. Put simply, TypeScript knows
which pages need data and what type that data has. If you forget a loader, or return the wrong
shape, or give a static page a loader, it won't compile.

### A detail page

```ts
note: async ({ services: { db }, params }) => {
  const slug = params.slug ?? "";
  if (!SLUG.test(slug)) return null;                       // check the input first
  const row = await db.first<NoteRow>(
    "SELECT slug, title, excerpt, body, published_at FROM notes WHERE slug = ?",
    slug,
  );
  if (!row) return null;                                   // no such note
  return { note: { ...toSummary(row), body: row.body } };  // database columns → your types
},
```

Both `return null` lines end up as a 404 page with a real 404 status.

### Things to keep in mind

Anything that comes from the URL is input from strangers, and that includes params and the query
string. The notes loader only accepts `?page=` if it's a whole number between 1 and 10000, and
returns `null` for anything else. If you're not sure what to do with odd input, return `null`.
A 404 is a better answer than a 500.

The data has to survive `JSON.stringify`. It gets embedded in the HTML and sent from `/api/page`, so
`Date` objects, `Map`s and class instances won't make it through. Use ISO strings for dates.

Everything a loader returns is visible to anyone, because it's in the page source. Don't put secrets
in it.

It also pays to map database rows to your own types. The database uses `snake_case` columns, and the
types in `src/shared/types.ts` use `camelCase`. A small mapping function like `toSummary` keeps the
database's column layout out of your components, so renaming a column later only touches one place.

## How a URL becomes a page

`resolvePage(services, url)` does this:

1. It tries each registry pattern against `url.pathname`, in order.
2. It percent-decodes the params. URLPattern doesn't do that for you, and a broken escape like
   `%E0%A4%A` is treated as "not found".
3. For a static page it returns `{ id, data: undefined }`. For a data page it runs the loader, and if
   the loader returns `null`, the result is `{ id: "not-found" }`.
4. If no pattern matches, the result is also `{ id: "not-found" }`.

The server calls it once per request. Whatever it returns decides whether the server renders a page,
serves a static file, or shows the 404 page.

## When things go wrong

`NotFoundPage` is shown when no page matches, and when a loader returns `null`. On the server the
status is 404 with `Cache-Control: no-store`. In the browser, a 404 from `/api/page` shows the same
component.

If a loader throws, a full page load gets a plain `500 Internal Server Error` and the error is logged
as one line of JSON. During client-side navigation the browser shows `ErrorPage` instead.

## `/api/page`

`GET /api/page?path=/notes/hello-world` returns `{ "id": "note", "data": { … } }`. Client-side
navigation uses it, and it goes through `resolvePage` as well, so it answers the same way the page
would:

- 200, cached according to the page's `cache` setting;
- 404 with `{ "error": "not_found" }`;
- 400 if the path doesn't start with `/`, or starts with `//`.

Nothing stops you calling it yourself, for example from a script that needs a page's data.

## Titles

After a client-side navigation, `PageRoute` sets `document.title` from the same registry `title`. The
tab shows the same title whether you loaded the page directly or clicked your way to it.
