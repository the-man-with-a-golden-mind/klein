// Sign-in and sessions, end to end through handleRequest, with a fake GitHub behind `fetch`.
import { afterEach, describe, expect, test } from "bun:test";
import { renderToString } from "preact-render-to-string";
import { App as AppTree } from "../src/app";
import { decodeBootstrap } from "../src/bootstrap";
import { handleRequest, runScheduled } from "../src/server/app";
import { github, safeNext, sessionAuth } from "../src/server/auth";
import { IDLE_TIMEOUT_MS, SESSION_LIFETIME_MS, sha256Hex } from "../src/server/auth/sessions";
import { resolvePage } from "../src/server/loaders";
import { testApp, testDb } from "./test-app";

const ORIGIN = "https://example.com";
const FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5) Gecko/20100101 Firefox/140.0";
const HOUR = 60 * 60 * 1000;

interface FakeGitHub {
  user: { id: number; login: string; name: string | null };
  tokenRequests: URLSearchParams[];
}

function setup(origin = ORIGIN, credentials = { clientId: "client-id", clientSecret: "client-secret" }) {
  const db = testDb();
  let clock = new Date(); // the /account loader filters with the real clock
  const fake: FakeGitHub = { user: { id: 42, login: "ada", name: "Ada Lovelace" }, tokenRequests: [] };

  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://github.com/login/oauth/access_token") {
      const body = new URLSearchParams(String(init?.body));
      fake.tokenRequests.push(body);
      // Like GitHub: 200 with { error } for a bad code.
      return Response.json(body.get("code") === "good-code" ? { access_token: "gho_test" } : { error: "bad_verification_code" });
    }
    if (url === "https://api.github.com/user") {
      const auth = new Headers(init?.headers).get("Authorization");
      return auth === "Bearer gho_test" ? Response.json(fake.user) : new Response("bad credentials", { status: 401 });
    }
    return new Response("unexpected request", { status: 500 });
  };

  const auth = sessionAuth({ db, provider: github(credentials), fetch: fetcher as typeof fetch, now: () => clock });
  const app = testApp({ services: { db, auth } });
  const request = (path: string, init: RequestInit = {}) => handleRequest(new Request(origin + path, init), app);
  return {
    db,
    auth,
    app,
    fake,
    request,
    advance: (ms: number) => (clock = new Date(clock.getTime() + ms)),
  };
}
type Setup = ReturnType<typeof setup>;

const cookie = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
const cookieValue = (res: Response, name: string) => cookie(res, name)?.split(";")[0]!.slice(name.length + 1);

/** The whole browser dance: /auth/sign-in → (GitHub) → /auth/callback. */
async function signIn(t: Setup, { next = "/account", previous }: { next?: string; previous?: string } = {}) {
  const start = await t.request(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  const oauth = cookieValue(start, "__Host-oauth")!;
  const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
  const cookies = [`__Host-oauth=${oauth}`, ...(previous ? [`__Host-session=${previous}`] : [])].join("; ");
  const done = await t.request(`/auth/callback?code=good-code&state=${state}`, { headers: { Cookie: cookies, "User-Agent": FIREFOX } });
  return { start, done, token: cookieValue(done, "__Host-session")! };
}

const as = (token: string, init: RequestInit = {}) => ({ ...init, headers: { ...init.headers, Cookie: `__Host-session=${token}` } });
const form = (body: string) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin" },
  body,
});

describe("sign-in", () => {
  test("/auth/sign-in redirects to GitHub with state and PKCE, in a short-lived strict cookie", async () => {
    const t = setup();
    const res = await t.request("/auth/sign-in?next=%2Faccount");
    expect(res.status).toBe(303);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const location = new URL(res.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    const q = location.searchParams;
    expect(q.get("client_id")).toBe("client-id");
    expect(q.get("redirect_uri")).toBe("https://example.com/auth/callback");
    expect(q.get("scope")).toBe("read:user");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const set = cookie(res, "__Host-oauth")!;
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Path=/");
    expect(set).toContain("Max-Age=600");
    const [state, verifier, next] = cookieValue(res, "__Host-oauth")!.split(".");
    expect(state).toBe(q.get("state")!);
    expect(decodeURIComponent(next!)).toBe("/account");
    // code_challenge = base64url(SHA-256(verifier))
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    expect(q.get("code_challenge")).toBe(Buffer.from(digest).toString("base64url"));
  });

  test("the callback creates the user, account and session, then returns to `next`", async () => {
    const t = setup();
    const { done, token } = await signIn(t);
    expect(done.status).toBe(303);
    expect(done.headers.get("Location")).toBe("/account");
    expect(cookie(done, "__Host-oauth")).toContain("Max-Age=0");

    const set = cookie(done, "__Host-session")!;
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain(`Max-Age=${SESSION_LIFETIME_MS / 1000}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The token exchange sent the PKCE verifier and the secret, server to server.
    const exchange = t.fake.tokenRequests[0]!;
    expect(exchange.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(exchange.get("client_secret")).toBe("client-secret");
    expect(exchange.get("redirect_uri")).toBe("https://example.com/auth/callback");

    expect(await t.db.all("SELECT provider, provider_user_id FROM accounts")).toEqual([{ provider: "github", provider_user_id: "42" }]);
    expect(await t.db.all("SELECT name FROM users")).toEqual([{ name: "Ada Lovelace" }]);
    // Only the hash is stored.
    const sessions = await t.db.all<{ id: string; user_agent: string }>("SELECT id, user_agent FROM sessions");
    expect(sessions).toEqual([{ id: await sha256Hex(token), user_agent: FIREFOX }]);
    expect(JSON.stringify(sessions)).not.toContain(token);
  });

  test("signing in again: same user, name refreshed, the old session on this browser ends", async () => {
    const t = setup();
    const first = await signIn(t);
    t.fake.user.name = null; // falls back to the login
    const second = await signIn(t, { previous: first.token });
    expect(second.token).not.toBe(first.token);
    expect(await t.db.all("SELECT name FROM users")).toEqual([{ name: "ada" }]);
    expect(await t.db.all("SELECT id FROM sessions")).toEqual([{ id: await sha256Hex(second.token) }]);
    expect(await t.auth.session(new Request(ORIGIN, as(first.token)))).toBeNull();
  });

  test("rejects a callback without the browser's state cookie, or with another state", async () => {
    const t = setup();
    const start = await t.request("/auth/sign-in");
    const oauth = cookieValue(start, "__Host-oauth")!;

    const noCookie = await t.request("/auth/callback?code=good-code&state=x");
    expect(noCookie.status).toBe(400);
    expect(noCookie.headers.get("Content-Security-Policy")).toBe("default-src 'none'");

    const wrongState = await t.request(`/auth/callback?code=good-code&state=${"a".repeat(43)}`, { headers: { Cookie: `__Host-oauth=${oauth}` } });
    expect(wrongState.status).toBe(400);
    expect(cookie(wrongState, "__Host-session")).toBeUndefined();
    expect(t.fake.tokenRequests).toHaveLength(0); // never reached GitHub
    expect(await t.db.all("SELECT id FROM sessions")).toEqual([]);
  });

  test("Cancel at GitHub returns to `next`; a failed exchange is a 502 without a session", async () => {
    const t = setup();
    const start = await t.request("/auth/sign-in?next=%2Fnotes");
    const oauth = cookieValue(start, "__Host-oauth")!;
    const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
    const headers = { Cookie: `__Host-oauth=${oauth}` };

    const cancelled = await t.request(`/auth/callback?error=access_denied&state=${state}`, { headers });
    expect(cancelled.status).toBe(303);
    expect(cancelled.headers.get("Location")).toBe("/notes");

    const error = console.error;
    console.error = () => {};
    try {
      const failed = await t.request(`/auth/callback?code=bad-code&state=${state}`, { headers });
      expect(failed.status).toBe(502);
      expect(await failed.text()).toContain("GitHub");
    } finally {
      console.error = error;
    }
    expect(await t.db.all("SELECT id FROM sessions")).toEqual([]);
  });

  test("`next` only ever points into this site, never back into /auth/", () => {
    for (const bad of [null, "", "//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "/auth/sign-in", "evil"]) {
      expect(safeNext(bad)).toBe("/");
    }
    expect(safeNext("/notes?page=2")).toBe("/notes?page=2");
    expect(safeNext("/notes/a.b")).toBe("/notes/a.b");
  });

  test("without credentials, /auth/sign-in says what to set", async () => {
    const t = setup(ORIGIN, { clientId: "", clientSecret: "" });
    const res = await t.request("/auth/sign-in");
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("GITHUB_CLIENT_ID");
  });

  test("on http://localhost the cookies drop __Host- and Secure, so local dev works", async () => {
    const t = setup("http://localhost:3000");
    const res = await t.request("/auth/sign-in");
    const set = cookie(res, "oauth")!;
    expect(set).toBeDefined();
    expect(set).not.toContain("Secure");
    expect(new URL(res.headers.get("Location")!).searchParams.get("redirect_uri")).toBe("http://localhost:3000/auth/callback");
  });

  test("other methods on /auth/* are not handled", async () => {
    const t = setup();
    expect((await t.request("/auth/sign-in", { method: "POST" })).status).toBe(405);
    expect((await t.request("/auth/sign-out")).status).toBe(404);
  });
});

describe("sessions", () => {
  test("a session shows the user on every page; pages are private and revalidated", async () => {
    const t = setup();
    const { token } = await signIn(t);
    const res = await t.request("/notes", as(token));
    const html = await res.text();
    expect(html).toContain("Ada Lovelace");
    expect(decodeBootstrap(html.match(/data-bootstrap="([^"]+)"/)![1]!).user).toEqual({ id: expect.any(String), name: "Ada Lovelace" });
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(res.headers.get("Vary")).toContain("Cookie");

    const anonymous = await (await t.request("/notes")).text();
    expect(anonymous).toContain("Sign in");
    expect(anonymous).not.toContain("Ada Lovelace");
  });

  test("garbage and unknown cookies are anonymous", async () => {
    const t = setup();
    for (const value of ["", "x", "a".repeat(43), "'; DROP TABLE sessions; --"]) {
      expect(await t.auth.session(new Request(ORIGIN, as(value)))).toBeNull();
    }
  });

  test("expires after 7 idle days, and after 30 days however active", async () => {
    const t = setup();
    const idle = await signIn(t);
    t.advance(IDLE_TIMEOUT_MS + 1);
    expect(await t.auth.session(new Request(ORIGIN, as(idle.token)))).toBeNull();
    expect(await t.db.all("SELECT id FROM sessions")).toEqual([]); // deleted on sight

    const active = await signIn(t);
    for (let day = 0; day < 31; day++) {
      t.advance(24 * HOUR);
      const session = await t.auth.session(new Request(ORIGIN, as(active.token)));
      if (day < 29) expect(session).not.toBeNull();
      else expect(session).toBeNull();
    }
  });

  test("last_seen_at is written at most hourly", async () => {
    const t = setup();
    const { token } = await signIn(t);
    const seen = async () => (await t.db.first<{ last_seen_at: string }>("SELECT last_seen_at FROM sessions"))!.last_seen_at;
    const before = await seen();
    t.advance(HOUR / 2);
    await t.auth.session(new Request(ORIGIN, as(token)));
    expect(await seen()).toBe(before);
    t.advance(HOUR);
    await t.auth.session(new Request(ORIGIN, as(token)));
    expect(await seen()).not.toBe(before);
  });

  test("runScheduled prunes expired sessions", async () => {
    const t = setup();
    await signIn(t);
    t.advance(IDLE_TIMEOUT_MS + 1);
    const log = console.log;
    console.log = () => {};
    try {
      const later = new Date(Date.now() + SESSION_LIFETIME_MS + 24 * HOUR);
      await runScheduled({ db: t.db, auth: sessionAuth({ db: t.db, provider: github({ clientId: "", clientSecret: "" }), now: () => later }) });
    } finally {
      console.log = log;
    }
    expect(await t.db.all("SELECT id FROM sessions")).toEqual([]);
  });
});

describe("sign-out", () => {
  test("ends this session and clears the cookie", async () => {
    const t = setup();
    const { token } = await signIn(t);
    const res = await t.request("/auth/sign-out", as(token, form("")));
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/");
    expect(cookie(res, "__Host-session")).toContain("Max-Age=0");
    expect(await t.auth.session(new Request(ORIGIN, as(token)))).toBeNull();
  });

  test("everywhere=1 ends every session of this user", async () => {
    const t = setup();
    const laptop = await signIn(t);
    const phone = await signIn(t);
    await signIn(t);
    expect(await t.db.all("SELECT id FROM sessions")).toHaveLength(3);
    await t.request("/auth/sign-out", as(laptop.token, form("everywhere=1")));
    expect(await t.db.all("SELECT id FROM sessions")).toEqual([]);
    expect(await t.auth.session(new Request(ORIGIN, as(phone.token)))).toBeNull();
  });

  test("cross-site sign-out is refused (CSRF)", async () => {
    const t = setup();
    const { token } = await signIn(t);
    const res = await t.request(
      "/auth/sign-out",
      as(token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "cross-site" }, body: "" }),
    );
    expect(res.status).toBe(403);
    expect(await t.auth.session(new Request(ORIGIN, as(token)))).not.toBeNull();
  });
});

describe("/account (auth: \"required\")", () => {
  test("anonymous: the page redirects to sign-in, its data is a 401", async () => {
    const t = setup();
    const page = await t.request("/account?tab=1");
    expect(page.status).toBe(303);
    expect(page.headers.get("Location")).toBe("/auth/sign-in?next=%2Faccount%3Ftab%3D1");
    const data = await t.request("/api/page?path=/account");
    expect(data.status).toBe(401);
    expect(await data.json()).toEqual({ error: "sign_in_required" });
  });

  test("signed in: lists where you're signed in; never publicly cacheable", async () => {
    const t = setup();
    const other = await signIn(t);
    const { token } = await signIn(t);
    const page = await t.request("/account", as(token));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Firefox on macOS");
    expect(html).toContain("this browser");
    expect(html).toContain('action="/auth/sign-out"');

    const data = await t.request("/api/page?path=/account", as(token));
    expect(data.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await data.json()) as { data: { sessions: { current: boolean }[] } };
    expect(body.data.sessions.map((s) => s.current).sort()).toEqual([false, true]);
    // Token hashes stay on the server.
    expect(JSON.stringify(body)).not.toContain(await sha256Hex(other.token));
  });

  test("public pages' data stays cacheable for signed-in people (their loaders never see the user)", async () => {
    const t = setup();
    const { token } = await signIn(t);
    const res = await t.request("/api/page?path=/notes", as(token));
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
  });

  test("the sitemap leaves out pages behind sign-in", async () => {
    const t = setup();
    expect(await (await t.request("/sitemap.xml")).text()).not.toContain("/account");
  });
});

describe("hydration parity with a user", () => {
  const realLocation = (globalThis as { location?: unknown }).location;
  afterEach(() => {
    (globalThis as { location?: unknown }).location = realLocation;
  });

  for (const path of ["/", "/account"]) {
    test(`${path}: browser tree equals server tree`, async () => {
      const t = setup();
      const { token } = await signIn(t);
      const session = await t.auth.session(new Request(ORIGIN, as(token)));
      const url = new URL(path, ORIGIN);
      const page = await resolvePage(t.app.services, url, session);
      const bootstrap = { page, initialUrl: path, site: { name: "Klein", description: "", origin: ORIGIN, build: "b" }, user: session!.user };
      const server = renderToString(<AppTree {...bootstrap} server />);
      (globalThis as { location?: unknown }).location = { href: url.href, origin: url.origin, pathname: url.pathname, search: "", hash: "" };
      expect(renderToString(<AppTree {...bootstrap} />)).toBe(server);
      expect(server).toContain("Ada Lovelace");
    });
  }
});

test("a fresh test database has the auth tables", () => {
  const db = testDb();
  expect(db.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'accounts', 'sessions') ORDER BY name").all()).toEqual([
    { name: "accounts" },
    { name: "sessions" },
    { name: "users" },
  ]);
});
