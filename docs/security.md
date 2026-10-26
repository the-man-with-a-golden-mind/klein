# Security

This page covers what Klein protects you from by default, why each protection is there, and the
parts that are left to you.

## Response headers

Every HTML response, error pages included, gets these headers:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | turns off camera, microphone, geolocation and interest-cohort |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |

The Content Security Policy (CSP) does the most work. It tells the browser where scripts, styles and
other resources are allowed to come from, and here the answer is "only from this site". Even if
someone manages to get a `<script>` tag into one of your pages, perhaps through a guestbook message
you forgot to escape, the browser won't run it. The policy is built from a commented array in
`src/ssr.tsx`.

This has some consequences you'll run into.

There are no inline scripts. The only script on the page is `/assets/client.js`. The data the server
passes to the browser goes into a base64url `data-bootstrap` attribute rather than a `<script>`
block, so even a `</script>` inside your data can't break out. A test checks this.

There are no inline styles either. [Styling](styling.md#no-inline-styles) explains what to do
instead.

Anything from another site has to be added by hand. Analytics, embedded videos and fonts from other
servers each need their host added to the right directive (`script-src`, `connect-src`, `frame-src`
or `img-src`). Add only what you actually use, and leave a comment saying what it's for.

## Cross-site request forgery (CSRF)

The attack works like this. You're signed in to your site, and you visit some other site. That
other site contains a hidden form that posts to *your* site. Your browser attaches your cookies to
the request, so your site thinks you sent it.

Every handler that changes something on behalf of a browser starts with `guardMutation(request)`,
which checks two things:

1. That the request came from your own site. Modern browsers send a `Sec-Fetch-Site` header, and it
   has to say `same-origin`. Older browsers don't send it, and then the `Origin` header has to match
   your site. If neither check passes, the answer is **403**.
2. That the body is JSON or a normal form. Anything else gets **415**.

The CSP's `form-action 'self'` adds one more layer on top. Projects without `--auth` don't use
cookies, so there's nothing for this attack to steal yet. Keep the guard anyway. It costs nothing,
and once you add sign-in it's the thing standing between your users and other sites, together with
the `SameSite=Lax` session cookie.

## Sessions (`--auth`)

Sessions are stored in the database, and the cookie is `HttpOnly; Secure; SameSite=Lax` with the
`__Host-` prefix. The database only holds a hash of each token. Sessions expire after a period of
inactivity and after a fixed lifetime, a new one is made at every sign-in, and people can sign out
of one browser or all of them. OAuth sign-in is protected with `state` and PKCE, and pages that show
the user are never cached publicly. [Sign-in and sessions](auth.md) explains what each of these
protects against.

## Request bodies

All the body readers stop reading at a fixed size. They check `Content-Length` before they start,
and keep counting while they read, in case the header lied:

| Reader | Default limit |
| --- | --- |
| `readJsonBody`, `readBody` | 8 KB |
| `readJsonBody(request, n)` | `n` bytes (the admin notes endpoint uses 256 KB) |
| `readBytes(request, n)` | `n` bytes (media uploads use 10 MB) |

A body that's too big gets **413** before it's held in memory. Without a limit, a few people sending
huge requests could exhaust the server's memory. `readJsonBody` also only accepts JSON objects,
so a handler never gets a bare string or array when it expected fields.

## Input

Route params and query strings come from whoever typed the URL. Loaders check them and return
`null` (a 404) when they get something they didn't expect. Broken percent-escapes are 404s, not 500s.

`/api/page` only accepts paths that start with a single `/`, so nobody can use it to make your
server fetch some other host.

The validators (`requireText`, `requireId`, `requireOneOf`) throw `HttpError(400, code)`.

SQL always uses `?` placeholders. Never build a query by gluing strings together with user input.
That's how SQL injection happens.

## Secrets

`ADMIN_TOKEN` protects `/api/admin/*`. `create-klein` puts a random one in `.env` (Bun) or
`.dev.vars` (Cloudflare), and both files are in `.gitignore`.

In production, set it as an environment variable on Bun, or with `npx wrangler secret put
ADMIN_TOKEN` on Cloudflare. If it isn't set, the admin endpoints refuse everyone.

Tokens are compared by hashing both sides with SHA-256 and comparing the hashes in constant time.
A naive comparison stops at the first wrong character, and by timing many attempts an attacker can
work the token out one character at a time.

Secrets live in `App.secrets`, which only server code can reach. **Never return a secret from a
loader.** Whatever a loader returns ends up in the page source.

## Files people upload

`/media/<key>` responses carry `Content-Security-Policy: default-src 'none'; sandbox` and `nosniff`.
If someone uploads an HTML or SVG file with a script in it, the browser won't run that script as
part of your site. Keys are limited to a safe set of characters.

## Errors

When something unexpected throws, the server logs one line of JSON (message, stack, method, path)
and the visitor gets a generic `500 Internal Server Error`. Stack traces never reach the browser,
because they tell an attacker which code you run and where it breaks.

## What's up to you

Accounts for people only come with `--auth`, and then only through OAuth. There are no passwords,
magic links or roles.

Rate limiting isn't built in. Use your platform for it (Cloudflare WAF rules) or your proxy.

HSTS, the header that tells browsers to always use HTTPS for your site, isn't set by the app. Set it
wherever HTTPS is handled: in your proxy, or in the Cloudflare dashboard. The Bun server usually sits
behind a proxy that handles TLS, so that's the right place for it.
