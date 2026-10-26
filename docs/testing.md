# Testing

The tests run on `bun test`. They don't need any extra libraries or a browser. Run them with:

```sh
bun run typecheck && bun test
```

## What comes with a project

| File | What it tests |
| --- | --- |
| `test/ssr.test.tsx` | The HTML document: content, the canonical link, asset URLs, titles and descriptions, security and cache headers. It checks that the bootstrap data is an attribute and never an inline script, that a `</script>` in the data does no harm, and that no page has a `style` attribute. The **hydration parity** tests are here too; see below. |
| `test/routing.test.ts` | `handleRequest()` from start to finish: pages, 404s, broken `%` escapes, static files, `HEAD`, 405s, `/api/page`, the guestbook (JSON, plain form, honeypot, CSRF, limits), the admin API (tokens, validation, conflicts), uploading, serving and deleting media, the sitemap, robots.txt, 500s and the scheduled job. |
| `test/http.test.ts` | Body limits, param decoding, `sameOrigin`, `requireBearer`. |
| `test/platform/*.test.ts` | Your database and storage adapters. Database adapters all run the shared contract in `test/database-contract.ts`. |
| `test/auth.test.tsx` | Only in `--auth` projects. The whole sign-in flow against a fake provider, session expiry and rotation, signing out, `/account`, cache headers and hydration with a signed-in user. [Sign-in and sessions](auth.md#other-security-details) has the full list. |

Hydration parity deserves a word. For every kind of page, the test renders the tree the server
builds and the tree the browser builds, and checks that both produce the same HTML. If they ever
differ, users would see the page change as soon as the JavaScript loads. This test catches that while
you're still working on it.

## The test app

`test/test-app.ts` gives you a working app with a real database and no setup:

```ts
import { ADMIN_TOKEN, memoryStorage, testApp, testDb } from "./test-app";

const app = testApp();                                          // in-memory SQLite + every migration + 2 notes
const withFiles = testApp({ services: { db: testDb(), storage: memoryStorage({ "a.txt": "hi" }) } });
const noSecrets = testApp({ secrets: {} });
```

The database is `bun:sqlite`, which comes with Bun, so this works whatever database you use in
production, D1 and Postgres included. If your SQL is [portable](database.md#write-portable-sql), a
query that passes here will behave the same there.

## Testing a new page

```ts
import { expect, test } from "bun:test";
import { handleRequest } from "../src/server/app";
import { testApp } from "./test-app";

test("about page", async () => {
  const res = await handleRequest(new Request("https://example.com/about"), testApp());
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("<title>About — ");
});
```

Then add the page to the `cases` list in the hydration parity block of `test/ssr.test.tsx`.

## Testing an endpoint

```ts
test("POST /api/guestbook validates the name", async () => {
  const res = await handleRequest(
    new Request("https://example.com/api/guestbook", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://example.com" },
      body: JSON.stringify({ name: "", message: "hi" }),
    }),
    testApp(),
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_name" });
});
```

Don't forget the `Origin` header when you test a write that browsers make. Without it,
`guardMutation` treats the request as cross-site and answers 403, and you'll spend a while wondering
why.

## Testing against a real Postgres

If `TEST_DATABASE_URL` is set, the Postgres adapter test runs the contract against a real server.
Each run gets a fresh schema, so it won't touch your data:

```sh
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres bun test
```

In the same way, setting `TEST_S3_BUCKET` (along with the usual `S3_*` credentials) turns on the S3
adapter test.

## What the tests don't cover

They don't use a real browser. Hydration parity is checked by rendering both trees to strings, and
nothing clicks through the site automatically. While developing Klein I check that with headless
Chrome, but that isn't part of a generated project. If your site has complicated interactions,
adding Playwright is a sensible next step.

They don't run on the real platform either. The tests call `handleRequest()` directly. Anything
specific to Workers or Bun shows up in `wrangler dev` or `bun run dev`.
