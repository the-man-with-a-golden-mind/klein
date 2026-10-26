# Getting started

## What you need

[Bun](https://bun.sh) 1.3 or newer. Bun installs packages, bundles the browser code, runs the tests
and, if you deploy on Bun, it's also the web server.

Postgres setups also need a Postgres server you can reach, either installed locally or running in
Docker. Cloudflare setups don't need anything extra for local development, because `wrangler dev`
simulates D1, R2 and Hyperdrive on your machine. You'll need a Cloudflare account once you deploy.

## Create a project

```sh
bun create-klein/index.ts my-app            # from a clone of this repository
# once the package is published:
bun create klein my-app
```

Without any flags you get Bun with SQLite. It's the easiest setup to start with, because the
database is a single file and there's nothing else to install. Flags choose other setups:

```sh
bun create klein my-app --db pg                          # Bun + Postgres
bun create klein my-app --db d1                          # Cloudflare Workers + D1
bun create klein my-app --db d1 --storage r2             # … + R2 file storage
bun create klein my-app --db pg --platform cloudflare    # Workers + Postgres via Hyperdrive
bun create klein my-app --auth github                    # any of the above + sign-in
```

The [CLI reference](cli.md) lists every combination. The CLI installs the dependencies for you, and
on Cloudflare it also runs `wrangler types`.

## Run it

```sh
cd my-app
bun run db:migrate          # on D1: bun run db:migrate:local
bun run db:sample           # adds two notes and a guestbook entry
bun run dev
```

Open http://localhost:3000, or http://localhost:8787 if you're on Cloudflare. You should see a home
page, a couple of notes and a guestbook.

If you picked Postgres, create the database before you migrate (`createdb my_app`) and check that
`DATABASE_URL` in `.env` points at it.

Every project's own `README.md` ends with a section called "Your setup". It lists the commands for
exactly the combination you chose, so you don't have to work them out from these docs.

## Working on it

`bun run dev` builds the browser bundle and the CSS once, then starts the server. If you're going to
edit pages or components, open two more terminals and run:

```sh
bun run dev:client   # rebuilds public/assets/client.js whenever you save
bun run dev:css      # rebuilds public/assets/styles.css when you use new Tailwind classes
```

This step is easy to skip, so here's what happens if you do. The server renders the page from your
current source code, but the browser then takes over the page using `client.js`. If `client.js` is
still the old build, the browser redraws the page the old way. You'll see your change for a split
second and then watch it disappear. When that happens, check that `dev:client` is running.
[Troubleshooting](troubleshooting.md#a-change-flashes-and-then-reverts) has more on this.

When you change server code, the server restarts by itself, on Bun and in `wrangler dev` alike.
Nothing reloads the browser for you, though, so refresh the page yourself.

## Add a page

Let's add an About page. It has no data, which makes it a "static page".

First, create `src/pages/AboutPage.tsx`:

```tsx
export function AboutPage(_: { data: undefined }) {
  return (
    <article class="space-y-4">
      <h1 class="text-3xl font-semibold tracking-tight">About</h1>
      <p>Hello from the about page.</p>
    </article>
  );
}
```

Then register it in `src/pages/registry.tsx`:

```ts
import { AboutPage } from "./AboutPage";
// inside PAGES:
about: staticPage({ path: "/about", title: "About", component: AboutPage }),
```

If you want it in the menu, add it to `src/components/layout/nav.ts`:

```ts
{ href: "/about", label: "About" },
```

Now open `/about`. It works when you load it directly and when you click to it from another page,
and it shows up in `/sitemap.xml` too. You didn't write a server route or a client route, because
both come from that one registry line.

Pages that read from the database have one more step, a loader. That's covered in
[Pages and loaders](pages-and-loaders.md).

## Check your work

```sh
bun run typecheck && bun test
```

Both pass in a fresh project, and it's worth keeping it that way. Among other things, the tests check
that the server and the browser produce the same HTML for every page. When they don't, users see the
page flicker, and the tests catch that before your users do.

## Where to go next

- [Architecture](architecture.md) follows a request through the code.
- [Examples](examples.md) covers reading and writing data, the admin API, file storage and
  scheduled jobs.
- [Deployment](deployment.md) is for when you want it online.
