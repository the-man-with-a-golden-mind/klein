import { describe, expect, test } from "bun:test";
import { decodeBootstrap } from "../src/bootstrap";
import type { Auth } from "../src/platform/types";
import { handleRequest, runScheduled, type App } from "../src/server/app";
import { HttpError, requireUser } from "../src/server/http";
import { ADMIN_TOKEN, memoryStorage, testApp, testDb } from "./test-app";

const ORIGIN = "https://example.com";
const request = (path: string, init?: RequestInit, app: App = testApp()) =>
  handleRequest(new Request(`${ORIGIN}${path}`, init), app);
const get = (path: string, app?: App) => request(path, undefined, app);

describe("pages", () => {
  test("static page 200", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  test("data pages 200", async () => {
    expect((await get("/notes")).status).toBe(200);
    expect((await get("/notes/first")).status).toBe(200);
    expect((await get("/guestbook")).status).toBe(200);
  });

  test("unknown path → 404 page", async () => {
    const res = await get("/no/such/page");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Page not found");
  });

  test("missing slug → 404 page", async () => {
    expect((await get("/notes/missing")).status).toBe(404);
  });

  test("malformed % → 404 page", async () => {
    const res = await get("/notes/%E0%A4%A");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  test("invalid query in loader → 404", async () => {
    for (const q of ["abc", "0", "10001", "99"]) expect((await get(`/notes?page=${q}`)).status).toBe(404);
  });

  test("unmatched path falls back to static assets", async () => {
    const res = await get("/assets/hello.txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  test("HEAD is treated as GET", async () => {
    expect((await request("/", { method: "HEAD" })).status).toBe(200);
  });

  test("POST to a page → 405", async () => {
    const res = await request("/", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
    expect(await res.json()).toEqual({ error: "method_not_allowed" });
  });
});

describe("/api/page", () => {
  test("200 with { id, data } and the page's cache setting", async () => {
    const res = await get("/api/page?path=%2Fnotes%2Ffirst");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
    const body = (await res.json()) as { id: string; data: { note: { title: string } } };
    expect(body.id).toBe("note");
    expect(body.data.note.title).toBe("First note");
  });

  test("cache: 0 pages are no-store", async () => {
    expect((await get("/api/page?path=/guestbook")).headers.get("Cache-Control")).toBe("no-store");
  });

  test("passes the query to the loader", async () => {
    expect((await get(`/api/page?path=${encodeURIComponent("/notes?page=abc")}`)).status).toBe(404);
  });

  test("404 for unknown pages", async () => {
    const res = await get("/api/page?path=/notes/missing");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  test("400 for bad paths", async () => {
    for (const path of ["", "?path=notes", "?path=//evil.com/x", `?path=${encodeURIComponent("/\\evil.com")}`]) {
      expect((await get(`/api/page${path}`)).status).toBe(400);
    }
  });

  test("POST → 405", async () => {
    const res = await request("/api/page?path=/", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
  });
});

describe("POST /api/guestbook", () => {
  const post = (body: string, type: string, headers: Record<string, string> = { Origin: ORIGIN }, app = testApp()) =>
    request("/api/guestbook", { method: "POST", body, headers: { "Content-Type": type, ...headers } }, app);
  const postJson = (data: unknown, app = testApp()) => post(JSON.stringify(data), "application/json", undefined, app);
  const form = "application/x-www-form-urlencoded";

  test("JSON → 201 with the entry, stored", async () => {
    const app = testApp();
    const res = await postJson({ name: " Ada ", message: "Hello!" }, app);
    expect(res.status).toBe(201);
    const entry = (await res.json()) as { id: string; name: string; message: string };
    expect(entry).toMatchObject({ name: "Ada", message: "Hello!" });
    const page = (await (await get("/api/page?path=/guestbook", app)).json()) as { data: { entries: { id: string }[] } };
    expect(page.data.entries.map((e) => e.id)).toEqual([entry.id]);
  });

  test("JSON validation → 400 with a code", async () => {
    expect(await (await postJson({ name: "", message: "x" })).json()).toEqual({ error: "invalid_name" });
    expect(await (await postJson({ name: "A", message: "x".repeat(501) })).json()).toEqual({ error: "invalid_message" });
  });

  test("plain form → 303 back to the page, errors as ?notice=", async () => {
    const ok = await post("name=Ada&message=Hi", form);
    expect(ok.status).toBe(303);
    expect(ok.headers.get("Location")).toBe("/guestbook?notice=signed");
    const bad = await post("name=&message=Hi", form);
    expect(bad.headers.get("Location")).toBe("/guestbook?notice=invalid_name");
    expect(await (await get("/guestbook?notice=signed")).text()).toContain("Thanks for signing!");
  });

  test("honeypot → looks successful, stores nothing", async () => {
    const app = testApp();
    expect((await postJson({ name: "Bot", message: "spam", website: "x" }, app)).status).toBe(201);
    const page = (await (await get("/api/page?path=/guestbook", app)).json()) as { data: { entries: unknown[] } };
    expect(page.data.entries).toEqual([]);
  });

  test("cross-site → 403, other content types → 415, oversized → 413", async () => {
    expect((await post("name=A&message=B", form, { Origin: "https://evil.com" })).status).toBe(403);
    expect((await post("name=A&message=B", form, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect((await post("x", "text/plain")).status).toBe(415);
    expect((await postJson({ name: "A", message: "x".repeat(9000) })).status).toBe(413);
  });
});

describe("/api/admin/*", () => {
  const auth = { Authorization: `Bearer ${ADMIN_TOKEN}` };
  const note = { slug: "from-ci", title: "From CI", body: "Posted with a token." };

  test("POST /api/admin/notes: 401 without the token, 201 with it, then 409", async () => {
    const app = testApp();
    const send = (headers: Record<string, string>) =>
      request("/api/admin/notes", { method: "POST", body: JSON.stringify(note), headers }, app);

    expect((await send({})).status).toBe(401);
    expect((await send({ Authorization: "Bearer wrong" })).status).toBe(401);
    const created = await send(auth);
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ slug: "from-ci", url: "/notes/from-ci" });
    expect(await (await get("/notes/from-ci", app)).text()).toContain("Posted with a token.");
    expect((await send(auth)).status).toBe(409);
  });

  test("POST /api/admin/notes: no ADMIN_TOKEN configured → always 401", async () => {
    const app = testApp({ secrets: {} });
    const res = await request("/api/admin/notes", { method: "POST", body: JSON.stringify(note), headers: auth }, app);
    expect(res.status).toBe(401);
  });

  test("POST /api/admin/notes: validation", async () => {
    const send = (body: unknown) => request("/api/admin/notes", { method: "POST", body: JSON.stringify(body), headers: auth });
    expect(await (await send({ ...note, slug: "Not A Slug" })).json()).toEqual({ error: "invalid_slug" });
    expect(await (await send({ ...note, title: "" })).json()).toEqual({ error: "invalid_title" });
    expect(await (await send({ ...note, publishedAt: "yesterday" })).json()).toEqual({ error: "invalid_published_at" });
  });

  test("PUT / GET / DELETE media", async () => {
    const storage = memoryStorage();
    const app = testApp({ services: { db: testDb(), storage } });
    const put = await request("/api/admin/media/img/a.svg", { method: "PUT", body: "<svg/>", headers: { ...auth, "Content-Type": "image/svg+xml" } }, app);
    expect(put.status).toBe(201);
    expect(await put.json()).toEqual({ key: "img/a.svg", url: "/media/img/a.svg" });

    const res = await get("/media/img/a.svg", app);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(await res.text()).toBe("<svg/>");

    expect((await request("/api/admin/media/img/a.svg", { method: "DELETE", headers: auth }, app)).status).toBe(204);
    expect((await get("/media/img/a.svg", app)).status).toBe(404);
  });

  test("media: 401 without token, 501 without storage, 400 for bad keys", async () => {
    const withStorage = testApp({ services: { db: testDb(), storage: memoryStorage() } });
    expect((await request("/api/admin/media/a.txt", { method: "PUT", body: "x" }, withStorage)).status).toBe(401);
    expect((await request("/api/admin/media/a.txt", { method: "PUT", body: "x", headers: auth })).status).toBe(501);
    expect((await request("/api/admin/media/a/b%20c", { method: "PUT", body: "x", headers: auth }, withStorage)).status).toBe(400);
  });
});

describe("/media/*", () => {
  const withStorage = testApp({ services: { db: testDb(), storage: memoryStorage({ "docs/a.txt": "hi" }) } });

  test("streams objects from storage", async () => {
    const res = await get("/media/docs/a.txt", withStorage);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
    expect(res.headers.get("Content-Type")).toBe("text/plain");
    expect(res.headers.get("ETag")).toBe('"1"');
  });

  test("404 for missing objects, bad keys and apps without storage", async () => {
    expect((await get("/media/docs/missing.txt", withStorage)).status).toBe(404);
    expect((await get("/media/docs/../a.txt", withStorage)).status).toBe(404);
    expect((await get("/media/docs/%2E%2E/a.txt", withStorage)).status).toBe(404);
    expect((await get("/media/docs/a.txt")).status).toBe(404);
  });
});

describe("other endpoints", () => {
  test("unknown /api/* → JSON 404 with no-store", async () => {
    const res = await get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Vary")).toBe("Origin");
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  test("sitemap lists registry paths without params", async () => {
    const xml = await (await get("/sitemap.xml")).text();
    expect(xml).toContain("<loc>https://example.com/</loc>");
    expect(xml).toContain("<loc>https://example.com/notes</loc>");
    expect(xml).not.toContain(":slug");
  });

  test("robots.txt points to the sitemap", async () => {
    expect(await (await get("/robots.txt")).text()).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  test("unknown errors → plain 500 with security headers", async () => {
    const db = { ...testDb(), all: () => Promise.reject(new Error("db down")) };
    const originalError = console.error;
    console.error = () => {};
    try {
      const res = await get("/notes", testApp({ services: { db } }));
      expect(res.status).toBe(500);
      expect(await res.text()).toBe("Internal Server Error");
      expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    } finally {
      console.error = originalError;
    }
  });

  test("origin override is used for canonical links and the sitemap", async () => {
    const app = testApp({ origin: "https://public.example" });
    expect(await (await get("/", app)).text()).toContain('href="https://public.example/"');
    expect(await (await get("/sitemap.xml", app)).text()).toContain("<loc>https://public.example/notes</loc>");
  });
});

describe("runScheduled", () => {
  test("removes guestbook entries older than a year", async () => {
    const db = testDb();
    const old = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString();
    await db.run("INSERT INTO guestbook (id, name, message, created_at) VALUES (?, ?, ?, ?)", "old", "A", "old", old);
    await db.run("INSERT INTO guestbook (id, name, message, created_at) VALUES (?, ?, ?, ?)", "new", "B", "new", new Date().toISOString());
    const log = console.log;
    console.log = () => {};
    try {
      await runScheduled({ db });
    } finally {
      console.log = log;
    }
    expect(await db.all("SELECT id FROM guestbook")).toEqual([{ id: "new" }]);
  });
});

// The hook projects created with --auth plug into. Their own flow is tested in test/auth.test.ts there.
describe("Services.auth seam", () => {
  const ada = { id: "u1", name: "Ada" };
  const fakeAuth = (): Auth & { pruned: number } => ({
    pruned: 0,
    session: async (request) => (request.headers.get("Cookie") === "s=ok" ? { id: "hash", user: ada } : null),
    handle: async (request) => (new URL(request.url).pathname === "/auth/ping" ? new Response("pong") : null),
    async prune() {
      this.pruned++;
      return 0;
    },
  });
  const withAuth = (auth = fakeAuth()) => testApp({ services: { db: testDb(), auth } });

  test("/auth/* goes to auth.handle first; paths it doesn't own fall through", async () => {
    const app = withAuth();
    expect(await (await get("/auth/ping", app)).text()).toBe("pong");
    expect((await get("/auth/nope", app)).status).toBe(404);
  });

  test("with auth, pages are private and revalidated, and show the user", async () => {
    const app = withAuth();
    const anonymous = await get("/notes", app);
    expect(anonymous.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(anonymous.headers.get("Vary")).toContain("Cookie");
    const signedIn = await request("/notes", { headers: { Cookie: "s=ok" } }, app);
    const encoded = (await signedIn.text()).match(/data-bootstrap="([^"]+)"/)![1]!;
    expect(decodeBootstrap(encoded).user).toEqual(ada);
    // no-store pages stay no-store
    expect((await get("/guestbook", app)).headers.get("Cache-Control")).toBe("no-store");
  });

  test("without auth, the bootstrap has no user and pages keep their cache setting", async () => {
    const res = await request("/notes", { headers: { Cookie: "s=ok" } });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(decodeBootstrap((await res.text()).match(/data-bootstrap="([^"]+)"/)![1]!).user).toBeNull();
  });

  test("handlers get ctx.user; requireUser turns null into 401", async () => {
    expect(requireUser(ada)).toBe(ada);
    expect(() => requireUser(null)).toThrow(HttpError);
  });

  test("runScheduled prunes sessions", async () => {
    const auth = fakeAuth();
    const log = console.log;
    console.log = () => {};
    try {
      await runScheduled({ db: testDb(), auth });
    } finally {
      console.log = log;
    }
    expect(auth.pruned).toBe(1);
  });
});
