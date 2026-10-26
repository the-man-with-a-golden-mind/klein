# Why not Astro, Next.js or Fresh?

They're good tools, and for plenty of projects one of them is the right choice. Klein exists for a
narrower case: a small site that you want to understand completely.

## What Klein is going for

**Control.** The router, data loading, rendering and HTTP handling are files in your project, not
code inside a package. If you don't like how something works, you open the file and change it.
There's no config option to look for and no plugin to write.

**Readability.** The framework part of a project is about 750 lines across nine files:

| File | Lines | What it does |
| --- | --- | --- |
| `src/server/app.ts` | ~170 | handles requests: API routes, pages, errors |
| `src/server/http.ts` | ~145 | errors, JSON, redirects, body limits, CSRF and token guards |
| `src/server/loaders.ts` | ~110 | page data and URL matching |
| `src/router.tsx` | ~90 | the client router |
| `src/pages/registry.tsx` | ~80 | the list of pages |
| `src/ssr.tsx` | ~65 | turns a page into HTML with security headers |
| `src/routes/PageRoute.tsx`, `src/app.tsx`, `src/browser.tsx` | ~90 | hydration and client navigation |

You can read all of it in an hour. After that, nothing about how your site works is hidden from you.

**No magic.** No file-based routing, no special file names, no compiler that rewrites your
components, and no hidden caching layer that decides when your data is fresh. A page exists because
it's in the registry. Its data comes from the loader next to it. If you want to know what happens to
a request, you follow function calls.

**Simplicity.** Two runtime dependencies, `preact` and `preact-render-to-string`. The build is
`bun build` plus the Tailwind CLI. A typical small project, like a portfolio, a blog with a
guestbook, or a small tool with sign-in, should take a couple of hours, not a couple of weekends.

## Compared to the others

**Astro** is excellent for content-heavy sites, and has a large ecosystem of integrations. It also
has its own component format, its own build pipeline on top of Vite, islands with several hydration
directives, content collections and a long list of config options. That's a lot to learn when all
you wanted was a few pages and a form. Klein has none of it: every page is a Preact component, and
the whole page hydrates.

**Next.js** can build almost anything, which is its strength and its cost. Server components, the App
Router's file conventions, several layers of caching, and server actions all have rules you need to
learn, and when something goes wrong the answer is often deep inside the framework. Klein renders on
the server and hydrates in the browser, and that's the whole model.

**Fresh** is the closest relative: Preact, server rendering, small. It's built for Deno and Deno
Deploy, with file-based routing and islands. Klein runs on Bun or Cloudflare Workers, uses an
explicit registry instead of folders, and keeps everything, the router included, in your project.

## When to pick something else

Klein is deliberately small, so it doesn't do a lot of things:

- If you have hundreds of Markdown pages and want them built ahead of time, Astro (or another static
  site generator) will serve you better.
- If you're building a large app with a team, need React's ecosystem, or want streaming and server
  components, use Next.js or React Router.
- If you need many interactive islands on otherwise static pages, Astro or Fresh are designed for
  exactly that.
- If you want a framework that someone else maintains and upgrades for you, Klein isn't one.
  Once it's generated, the code is yours, including the responsibility for it.

If your site is small, you want to know exactly what it does, and you'd rather read 750 lines than
learn a framework, that's what Klein is for.
