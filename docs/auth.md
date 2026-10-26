# Sign-in and sessions

If you create a project with `--auth github` or `--auth google`, people can sign in to your site with
that account. The project gets three extra database tables (users, accounts and sessions) and the
code that runs sign-in, in `src/server/auth/`. That's about 300 lines, and like the rest of the
project, they're yours. Projects created without `--auth` contain none of this.

```sh
bun create-klein/index.ts my-app --auth github
bun create-klein/index.ts my-app --db d1 --auth google
```

Here's what you end up with:

- a "Sign in" link in the header, which turns into your name once you're signed in;
- sessions stored in your own database, on any combination of platform and database;
- an `/account` page, as an example of a page only signed-in people can see, listing the browsers
  you're signed in on, with "Sign out" and "Sign out everywhere" buttons;
- an `auth` setting for registry pages, `user` in loaders and handlers, and `useUser()` in
  components;
- cache headers set up so that one person's page is never shown to someone else.

Sign-in uses OAuth, the "Continue with GitHub" kind. Your site never sees a password, so there are
none to store, hash, reset or protect from guessing.

## Setting it up

You need to register your site with GitHub or Google first. They give you a client id and a secret,
which your site uses to prove who it is.

For **GitHub**, go to github.com → Settings → Developer settings → OAuth Apps → *New OAuth App*.
GitHub allows one callback URL per app, so you'll end up with two apps, one for local development
and one for production.

For **Google**, go to console.cloud.google.com → APIs & Services → Credentials → *Create
credentials* → *OAuth client ID* → *Web application*. Google asks you to configure the consent
screen before it lets you continue.

Either way, you'll be asked for a callback (or redirect) URL. That's where the provider sends people
back after they approve. Locally, use `http://localhost:3000/auth/callback` on Bun or
`http://localhost:8787/auth/callback` on Cloudflare.

Copy the client id and secret into `.env` (Bun) or `.dev.vars` (Cloudflare):

```sh
GITHUB_CLIENT_ID=Iv1.0123456789abcdef
GITHUB_CLIENT_SECRET=0123456789abcdef0123456789abcdef01234567
```

For Google they're called `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Then create the tables with `bun run db:migrate` (`db:migrate:local` on D1), start the site with
`bun run dev`, and click **Sign in**. If you forgot a variable, `/auth/sign-in` tells you which one.

For production, register `https://<your-domain>/auth/callback` with the provider and set the same two
variables there: as environment variables on Bun, or with `npx wrangler secret put GITHUB_CLIENT_ID`
(and the secret) on Cloudflare. If you run Bun behind a proxy, also set
`ORIGIN=https://<your-domain>`. Without it, the app builds the callback URL from the address the
proxy connects to, and the provider rejects it because it doesn't match.

## What happens when someone signs in

```
Sign in ─→ GET /auth/sign-in?next=/account
             │  pick a random state and PKCE verifier, keep them in a short-lived cookie (10 min)
             └→ 303 to the provider's consent page
                  │  the person clicks "Authorize"
Provider ─→ GET /auth/callback?code=…&state=…
             │  the state has to match the cookie (otherwise 400)
             │  code + verifier + secret → access token (server to server)
             │  access token → profile { id, name }
             │  find or create the user, drop this browser's old session
             │  new session: a random token in the cookie, its SHA-256 in the database
             └→ 303 back to /account
```

Two of those steps are there to stop specific attacks, so they deserve a closer look.

The **state** is a random value that the sign-in step stores in a cookie and also sends to the
provider. When the person comes back, the two have to match. Without that check, an attacker could
start a sign-in with their own account, then trick you into opening the callback link. You'd be
signed in to the site as them without noticing, and anything you then saved would land in their
account. This attack is called login CSRF.

**PKCE** ties the code the provider hands back to the browser that started the sign-in. Even if
someone intercepted the code on its way back, they couldn't trade it for a token without the
verifier, and the verifier never left your server's cookie.

| Route | What it does |
| --- | --- |
| `GET /auth/sign-in?next=<path>` | Starts signing in. `next` has to be a path on your own site; anything else turns into `/`. |
| `GET /auth/callback` | Finishes it. Errors (an expired attempt, a state that doesn't match, the provider failing) are shown as short plain-text pages. If the person clicks *Cancel* at the provider, they're sent back to `next`. |
| `POST /auth/sign-out` | Ends this session, or every session of this user with `everywhere=1`. Only your own site can call it. It's a plain `<form>`, so it works without JavaScript. |

The routes are in `src/server/auth/index.ts`. `src/server/app.ts` hands every `/auth/*` request to
`services.auth.handle()` before anything else gets to look at it.

## The tables

`migrations/0003_auth.sql` creates them:

| Table | Columns | What it holds |
| --- | --- | --- |
| `users` | `id`, `name`, `created_at` | One row per person. The name is updated from the provider every time they sign in. |
| `accounts` | `provider`, `provider_user_id`, `user_id`, `created_at` | Which provider account belongs to which user. The primary key is `(provider, provider_user_id)`. Someone can have more than one account if you add providers later. |
| `sessions` | `id`, `user_id`, `created_at`, `last_seen_at`, `expires_at`, `user_agent` | One row per signed-in browser. The `id` is the SHA-256 hash of the cookie's token, not the token itself. |

To add columns to `users`, write a new migration (`0004_…`). Don't edit `0003`.

You might expect an email or an avatar in there. There isn't one, and the provider's access token
isn't stored either: it's used once to read the profile and then thrown away. Data you don't have
can't leak. If you do need an email, add the `user:email` scope (GitHub) or `email` (Google) in
`src/server/auth/providers.ts`, plus a column to keep it in.

## How sessions work

When someone signs in, the server makes a random token and puts it in a cookie. The database gets a
SHA-256 hash of the token, never the token itself. On each request, the server hashes the cookie and
looks for a matching row. If your database leaks, the attacker has a list of hashes, and they can't
turn those back into cookies that work.

| | Value | Why |
| --- | --- | --- |
| Token | 32 random bytes, base64url | far too many possibilities to guess |
| Cookie | `__Host-session`, with `HttpOnly; Secure; SameSite=Lax; Path=/` | page scripts can't read it, it only travels over HTTPS, and other sites can't send it with their form posts |
| Lifetime | 30 days from sign-in, however active you are | `SESSION_LIFETIME_MS`, also the cookie's `Max-Age` |
| Idle timeout | 7 days without a request | `IDLE_TIMEOUT_MS` |
| Activity | `last_seen_at` is written at most once an hour | so most requests are a single read |
| Signing in | always creates a new token and deletes this browser's previous session | session fixation |
| Cleanup | expired sessions are deleted when they're seen, and by `runScheduled()` | `pruneSessions()` |

"Session fixation" in that table means this: if a session could survive a sign-in, an attacker could
plant a token they know in your browser, wait for you to sign in, and then use the token themselves.
Making a fresh token on every sign-in rules that out.

On `http://localhost` the cookies are simply called `session` and `oauth` and aren't marked
`Secure`. Browsers only accept `__Host-` and `Secure` cookies over HTTPS, and you're probably not
running HTTPS on your laptop. Every other host gets the strict version. A site behind an HTTPS proxy
is fine too, because the browser only ever talks HTTPS to it.

A request without a session cookie never touches the database.

## Using the signed-in user

### Pages: `auth` in the registry

```ts
account: dataPage<AccountData>({ path: "/account", title: "Account", auth: "required", component: AccountPage }),
```

| `auth` | Anonymous visitors | The loader gets `user` / `session` | `/api/page` caching |
| --- | --- | --- | --- |
| *(not set)* | see the page | always `null` | the page's `cache` setting |
| `"optional"` | see the page | the user, or `null` | `private, no-store` |
| `"required"` | a full page load redirects to `/auth/sign-in?next=…`; client-side navigation gets a `401` and then goes to sign-in | the user, never `null` | `private, no-store` |

**A loader only sees the user if its page sets `auth`.** That might look like an odd restriction,
but it's what lets public pages stay cacheable. If any loader could read the user, any page could
quietly start depending on who's asking, and a CDN would happily cache one person's version and
serve it to everyone. Making you write `auth` on the page means it's never an accident.

```ts
// src/server/loaders.ts
account: ({ services, session }) => loadAccount(services.db, session),

// your own page with auth: "required"
drafts: async ({ services: { db }, user }) => {
  if (!user) return null; // can't happen for "required"; keeps TypeScript happy
  return { drafts: await db.all("SELECT id, title FROM drafts WHERE user_id = ?", user.id) };
},
```

Pages behind sign-in are left out of `/sitemap.xml`.

### Components: `useUser()`

```tsx
import { useUser } from "../hooks/useUser";

const user = useUser(); // { id, name } or null
```

Signing in and out always reloads the page, so the user can't change while a page is open. The value
comes from the data embedded in the page. Only `{ id, name }` is sent to the browser, never the
session.

### Endpoints: `ctx.user`

Every handler gets `user` and `session`. Both are `null` when nobody is signed in.

```ts
import { guardMutation, readBody, requireUser } from "../http";

export async function saveDraft({ request, app, user }: RouteContext): Promise<Response> {
  guardMutation(request);              // CSRF: same-origin, JSON or form
  const me = requireUser(user);        // 401 { "error": "sign_in_required" } when anonymous
  const body = await readBody(request);
  …
}
```

For anything that writes, always use `requireUser` and `guardMutation` together. `SameSite=Lax`
already stops most browsers from sending the cookie with another site's form posts, and
`guardMutation` refuses cross-site requests even in browsers that don't support it.

## Caching

Without some care, caching and sign-in go badly together. A CDN might keep a copy of a page showing
"Signed in as Ada" and serve it to the next visitor, or your own browser might show a signed-out page
right after you sign in. This is how `--auth` projects avoid both:

| Response | `Cache-Control` | Why |
| --- | --- | --- |
| Every page's HTML | `private, no-cache` + `Vary: Cookie` | the header shows who's signed in |
| `/api/page` for pages with `auth` | `private, no-store` | the data depends on the person |
| `/api/page` for other pages | the page's `cache` setting | those loaders never see the user, so the data is the same for everyone |
| `/auth/*` | `no-store` | |
| `/api/*` | `private, no-store`, as in every project | |

`private` keeps CDNs and proxies from storing the response at all. `no-cache` sounds stricter than it
is: the browser may still keep the page, for example for the back button, but it has to check with
the server before showing it again.

## Other security details

The `next` parameter only accepts a path on your own site, and never one inside `/auth/`. Otherwise
someone could send people a sign-in link to your site that ends with a redirect to theirs.

Sign-in is a link, not a form. That way the CSP's `form-action 'self'` doesn't block the redirect to
the provider. The header doesn't show avatars, so `img-src` doesn't need any outside hosts. If you
add them, allow `avatars.githubusercontent.com` or `lh3.googleusercontent.com` in `img-src`.

`test/auth.test.tsx` goes through the whole flow against a fake provider. It covers the cookie
flags, PKCE, a state that doesn't match, cancelling, provider errors, bad `next` values, token
rotation, both kinds of expiry, both kinds of sign-out and a cross-site sign-out attempt, the
redirects and 401s for `/account`, the cache headers, the sitemap, and hydration with a signed-in
user.

## Adding a provider

Each provider is a plain object in `src/server/auth/providers.ts`. It holds the provider's URLs, the
scope to ask for, and a `profile()` function that turns the provider's answer into `{ id, name }`.
To add GitLab, Microsoft or Discord, copy `github()`, change those three things, and use the new one
in `src/services.ts`.

With more than one provider you'll want a small page that lists them, with "Sign in" pointing at it.
The natural next step from there is to accept `/auth/sign-in?provider=…`.

## What's not included

Email and password, magic links and passkeys aren't included. Magic links need an email service.
Passwords need a hashing setup that works on every platform, and rate limiting, and that's a lot
more code than the rest of this page.

There are no roles or permissions either. If you need them, add a `role` column to `users` and check
it in your loaders and handlers.

There's no way to delete an account yet. The SQL is `DELETE FROM users WHERE id = ?`, and
`ON DELETE CASCADE` removes the person's accounts and sessions with it. Remember to delete whatever
else of theirs you store as well.

There's no rate limiting. OAuth sign-in doesn't need it, because the provider handles the guessing
problem. Add it before you add anything that involves passwords.
