# Klein

Klein builds small websites with Preact. The server renders every page, the browser picks it up
from there, and TypeScript checks the whole path from the database query to the component.

It isn't a framework you install and keep upgrading. You run the generator once, and what you get is
a project of a few hundred lines that you own and are free to change. You also choose where it runs
and which database it uses, and the generator leaves out the code for everything you didn't pick.

It's named after Yves Klein, the painter who covered whole canvases in a single shade of blue. It
also happens to be German and Dutch for "small", which seemed fitting.

> **Status: 0.1, experimental.** It works and it's tested, but I may still change the interfaces
> before 1.0.

```sh
bun create-klein/index.ts my-app            # Bun + SQLite
cd my-app && bun run db:migrate && bun run db:sample && bun run dev
```

## Why I made it

I wanted something between a static site generator and a full framework. Every URL should return
real HTML, so the first paint is fast, the page works with JavaScript turned off, and search engines
see the content. After that, clicking around should feel like an app: links load JSON, not whole
pages.

The usual frameworks do this, but they bring a lot of machinery with them: file-based routing,
compiler plugins, their own caching layers. When something breaks you end up reading their source
instead of yours. Klein keeps all of that in your project. The router is about a hundred lines.
Data loading is a typed object. The only runtime dependencies are `preact` and
`preact-render-to-string`, and the browser bundle comes to about 25 KB (10 KB gzipped).

What I'm after is control, readability, no magic and simplicity. Astro, Next.js and Fresh are all
much bigger than a small site needs. The framework part of Klein is about 750 lines, so you can read
it in an hour and finish a small project in a couple of hours.
[Why not Astro, Next.js or Fresh?](docs/why-klein.md) compares them honestly, including when you
should pick one of them instead.

Some other things I cared about:

- A page is a component plus one line in a registry. If a page needs data and you forget to write
  its loader, TypeScript won't compile.
- Database code can't end up in the browser bundle. The folder layout makes sure of that.
- Your code talks to two small interfaces, `Database` and `Storage`. Moving from SQLite to Postgres,
  or from Bun to Cloudflare, means changing a single file.
- The defaults are strict: a Content Security Policy with no inline scripts or styles, a CSRF check
  on every write, size limits on request bodies, and uploaded files served in a sandbox.
- The build is `bun build`, the Tailwind CLI and, on Cloudflare, Wrangler. That's the whole build.

## Choose a setup

| Flags | Server | Database | Storage |
| --- | --- | --- | --- |
| *(none)* | Bun | SQLite (`bun:sqlite`) | |
| `--db pg` | Bun | Postgres (Bun's built-in `SQL`) | |
| `--db d1` | Cloudflare Workers | D1 | |
| `--db pg --platform cloudflare` | Cloudflare Workers | Postgres via Hyperdrive | |
| `--storage r2` | either | | Cloudflare R2 (binding on Workers, S3 API on Bun) |
| `--storage s3` | Bun | | any S3-compatible bucket |

Add `--auth github` or `--auth google` to any of these if people should be able to sign in. You get
users and sessions stored in your own database ([Sign-in and sessions](docs/auth.md)).

All the flags and combinations are in [docs/cli.md](docs/cli.md).

## What's in a new project

A new project comes with a handful of examples. They all work and they all have tests, so you can
copy from them, or delete them once you have your own pages:

- a static home page;
- notes, a list with pagination plus a detail page, showing how to read from the database and
  return a real 404;
- a guestbook, showing how to write data with a form that works whether JavaScript has loaded or
  not;
- a small admin API protected by a token, for publishing notes from a script or CI;
- file uploads and serving, if you picked R2 or S3;
- a scheduled cleanup job;
- with `--auth`, sign-in and an account page where you can sign out of every device.

[docs/examples.md](docs/examples.md) goes through them one by one, with `curl` commands you can try.

To give you a feel for it, this is how you add a page that needs data:

```ts
// src/pages/registry.tsx
about: dataPage<AboutData>({ path: "/about", title: "About", component: AboutPage }),

// src/server/loaders.ts
about: async ({ services: { db } }) => db.first<AboutData>("SELECT heading FROM about WHERE id = ?", 1),
```

## Documentation

If you're new, read [Getting started](docs/getting-started.md) first and
[Architecture](docs/architecture.md) second. After that, look things up as you need them:

- [Examples](docs/examples.md)
- [Pages and loaders](docs/pages-and-loaders.md), [Client routing](docs/routing.md),
  [API routes](docs/api-routes.md)
- [Database](docs/database.md), [Storage](docs/storage.md), [Sign-in and sessions](docs/auth.md)
- [Styling](docs/styling.md), [Security](docs/security.md), [Testing](docs/testing.md),
  [Deployment](docs/deployment.md)
- [CLI reference](docs/cli.md) and [Troubleshooting](docs/troubleshooting.md)

## This repository

```
template/         the app, split into folders the CLI stacks together
create-klein/   the CLI that generates projects
scripts/          check-variants.ts, which generates and tests every supported combination
docs/             the documentation
SPEC.md           the original design spec, with the decisions behind it
```

If you want to work on Klein itself, start with [CONTRIBUTING.md](CONTRIBUTING.md).
`bun run check` generates all 13 combinations and typechecks, tests, builds and smoke-tests each one.

## What's missing

I'd rather say this up front than have you find out later:

- Client-side navigation doesn't restore your scroll position when you go back to a page that loads
  data. It doesn't jump to `#anchors` on other pages, and it doesn't move keyboard focus. Details
  are in [docs/routing.md](docs/routing.md#known-limitations).
- Sign-in is OAuth only. There are no passwords, magic links or roles, and there's no rate limiting.
- On Bun, you run `dev:client` (and `dev:css`) in their own terminals while you work. There's no
  live reload yet.
- Preact 11 is a fairly new major version. I've pinned every dependency to the exact version I
  tested with.

## License

[MIT](LICENSE). The licence covers Klein and its template. Whatever you build in a generated project
is yours.
