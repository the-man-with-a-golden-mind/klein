# Troubleshooting

These are the problems people actually run into, what they look like, and how to fix them.

## A change flashes and then reverts

You edit a page, reload, and for a split second you see your change. Then the old version comes
back, with the old text or old image paths.

The server is rendering your new code, but the browser takes over the page with
`public/assets/client.js`, and that file is an old build. The browser then redraws everything the
old way.

Run `bun run dev:client` while you work, so it rebuilds every time you save, or `bun run build:client`
once. `dev`, `build` and `deploy` always build it first, so this only happens while you're editing.

## New Tailwind classes do nothing

Run `bun run dev:css` while you work, or `bun run build:css` once. If that doesn't help, check that
the class name is written out in full somewhere under `src/`. Tailwind can't see a class built from
pieces, like `` `text-${color}` ``.

## An inline style is ignored

The CSP (`style-src 'self'`) blocks `style="…"` attributes in the server's HTML, and the browser
console says so. Use classes or tokens instead ([Styling](styling.md#no-inline-styles)). Setting
styles from JavaScript after hydration, with `el.style.setProperty`, is allowed.

## A script, font or embed from another site is blocked

Add the other site's origin to the matching CSP directive in `src/ssr.tsx`. That's `script-src` for
scripts, `connect-src` for `fetch` and analytics beacons, `frame-src` for embeds, `img-src` for
images and `font-src` for fonts.

## A page loses its state on every render

You've probably created a component inside a render function. Writing `component={() => <Page />}`
inline in JSX makes a new function, and so a new component type, every time it renders. Preact sees
a different component each time, throws the old one away and mounts a new one. Define page and route
components once, at the top level of a module. That's why `src/app.tsx` builds its routes outside any
component.

## A URL with `%` in it gives a 404

That's on purpose. URLPattern doesn't decode `%` escapes, so Klein decodes them itself, and treats
a broken one like `%E0%A4%A` as "not found" rather than crashing.

## Data looks out of date

When you load a page directly, the browser may reuse its copy for up to 60 seconds, because that's
the default `cache` setting. Set `cache: 0` in the registry for pages that should change as soon as
someone does something.

Clicking to a page always asks the server for fresh data. The browser's HTTP cache still applies to
that request, though, following the same `cache` setting.

## TypeScript errors about `Env` after editing `wrangler.jsonc`

Run `bun run types` after every change to `wrangler.jsonc` or `.dev.vars`. If TypeScript says
`ADMIN_TOKEN` doesn't exist on `Env`, you're missing `.dev.vars`. Copy it from `.dev.vars.example`.

## Local D1 is suddenly empty

When you change `database_id` in `wrangler.jsonc`, local development switches to a new, empty local
database. Run `bun run db:migrate:local` (and `db:sample`, if you want the examples) again.

## `wrangler dev` with Postgres says "You must provide a password"

Hyperdrive's `localConnectionString` needs a user and a password in it, such as
`postgres://postgres:postgres@localhost:5432/my_app`. Keep it the same as `DATABASE_URL` in `.env`.

## "Set DATABASE_URL" when the server starts

Postgres setups read `DATABASE_URL` from the environment. Bun loads `.env` on its own, so check that
the file exists and that the database it names exists too (`createdb my_app`).

## Arrows or symbols look different from the text

Characters that aren't in the bundled Inter subset (→, ↗, emoji) come from system fonts instead. If
they matter to your design, include them in your font subset.

## Images are heavy or blurry

Nothing recompresses your images, not Cloudflare and not R2 or S3. Upload WebP or AVIF at the size
you'll display them (twice that for high-density screens) and set `width` and `height` on the
`<img>`.

## Sign-in says "Sign-in isn't set up yet"

`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (or the `GOOGLE_…` pair) are empty. Fill them in `.env`
on Bun or `.dev.vars` on Cloudflare, and restart `bun run dev`. In production on Cloudflare, set them
with `wrangler secret put`.

## The provider says the redirect URI doesn't match

The callback URL you registered with the provider has to be exactly `<origin>/auth/callback`, with
the same scheme, host and port. Locally that's `http://localhost:3000` on Bun or
`http://localhost:8787` on Cloudflare. GitHub only allows one callback URL per OAuth app, so local
and production need separate apps.

If you run Bun behind a proxy, set `ORIGIN=https://<your-domain>`. Otherwise the app builds the URL
from the address the proxy connects to, which isn't the one you registered.

## Sign-in works locally, but in production I'm signed out straight away

The session cookie is `__Host-session` and it's marked `Secure`, so browsers only keep it over HTTPS.
Serve the site over HTTPS, at Cloudflare or at your proxy. Plain `http://` only works on `localhost`.

## `/media/...` gives a 500 on Bun

It's almost always the `S3_*` credentials, either missing or wrong. The server log shows the actual
S3 error, and `.env.example` lists the variables you need.
