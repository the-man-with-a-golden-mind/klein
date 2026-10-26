# Client routing

Klein comes with its own router, `src/router.tsx`. It's about 100 lines, built on the browser's
`history` API and `URLPattern`, and it does the job you might otherwise use preact-iso for. Most of the
time you won't touch it. You write normal links and the registry decides what's a page.

## Links

Write a normal `<a href>`, or use the `Link` component, which renders exactly the same thing:

```tsx
import { Link } from "../components/Link";
<Link href="/notes/hello-world">Read it</Link>
```

The router listens for clicks anywhere on the page. It takes over a click, instead of letting the
browser load a new page, only when all of these are true:

- the link points at a page in the registry, on the same site;
- it has no `target` or `download` attribute;
- it's a plain left click, without Ctrl, ⌘, Shift or Alt;
- it isn't only a `#hash` on the current page.

In every other case the browser handles the link normally. That covers more than you might expect.
`/auth/sign-in`, `/media/…`, `/sitemap.xml` and paths that don't exist all load as real pages, so the
server can answer with a redirect, a file or a proper 404. Hash links are left alone so that the
"Skip to content" link and in-page anchors still work. External links, new tabs and downloads behave
as they would on any website.

When the router does handle a click, it calls `history.pushState`, renders the new page and scrolls
to the top.

## `useLocation()`

```ts
import { useLocation } from "../router";

const { url, path, query, initial, navigate } = useLocation();
```

| Field | What it is |
| --- | --- |
| `url` | path plus query string, e.g. `/notes?page=2` |
| `path` | just the path |
| `query` | a `URLSearchParams` |
| `initial` | `true` until the first client-side navigation, while the page on screen is still the one the server rendered |
| `navigate(href, { replace? })` | adds a history entry (or replaces the current one) and renders it |

For example, a search box that keeps its text in the URL:

```tsx
function Search() {
  const { query, navigate } = useLocation();
  return (
    <input
      value={query.get("q") ?? ""}
      onChange={(e) => navigate(`/search?q=${encodeURIComponent(e.currentTarget.value)}`, { replace: true })}
    />
  );
}
```

`useLocation()` only works in the browser. The server already knows which page it's rendering and
doesn't use the router, so a component that also renders on the server should take what it needs
from the page's `data`.

## How pages are matched

`src/app.tsx` builds the route list once, when the module loads:

```ts
const ROUTES: Route[] = PAGE_IDS.map((id) => ({
  pattern: new URLPattern({ pathname: PAGES[id].path }),
  component: () => <PageRoute id={id} />,
}));
```

The "once" part matters. If the routes were built inside a render function, each render would make
brand-new component functions. Preact would see a different component every time, throw the old one
away, and mount the page again from scratch.

`<Routes>` uses the first pattern that matches and decodes its params. If a `%` escape is broken, you
get the 404 page, as you would from the server.

## What `PageRoute` does

| Situation | What happens |
| --- | --- |
| The first render after the page loads | It uses the data the server embedded. No request is made. |
| A static page | It renders right away. |
| A data page after a navigation | It fetches `/api/page?path=…` and shows nothing until the data arrives. |
| `/api/page` answers 404 | It shows `NotFoundPage`. |
| The network or the server fails | It shows `ErrorPage`. |

After your first navigation, data pages fetch every time, even when you come back to the page you
started on. That way the page reflects whatever just changed, such as the guestbook entry you just
signed.

## Back and forward

Pressing back or forward renders the matching page without scrolling to the top. Since data pages
fetch again, the browser may try to restore your scroll position before the content has arrived, and
then you end up at the top instead of where you were. That's the first item below.

## Known limitations

I've left these out to keep the router small. If you need one of them, a pull request is welcome.

- Scroll position on back and forward isn't restored for data pages, as described above.
- A link like `/other-page#section` opens the page at the top, not at `#section`.
- Focus stays where it was after a client-side navigation, and screen readers aren't told that the
  page changed. Every page has a "Skip to content" link that jumps to `#main`.
- There's no hook for route params. Components get their data from the loader, and if you really
  need the raw path, `useLocation().path` has it.
- There's no error boundary. If a component throws while rendering, the page content breaks.
