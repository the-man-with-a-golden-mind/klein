// Sign-in with an OAuth provider + database sessions. Implements `Auth` from src/platform/types.ts.
//
//   GET  /auth/sign-in?next=/account   → redirect to the provider (state + PKCE in a short-lived cookie)
//   GET  /auth/callback                → verify state, exchange the code, create the session, back to `next`
//   POST /auth/sign-out                → end this session (or all of them with everywhere=1)
import type { Auth, Database } from "../../platform/types";
import { guardMutation, readBody } from "../http";
import { exchangeCode, type OAuthProvider, type Profile } from "./providers";
import {
  clearCookie,
  cookieName,
  createSession,
  deleteSession,
  deleteUserSessions,
  findSession,
  pruneSessions,
  randomToken,
  readCookie,
  SESSION_LIFETIME_MS,
  setCookie,
  sha256Hex,
} from "./sessions";

export { github, google } from "./providers";

export interface SessionAuthOptions {
  db: Database;
  provider: OAuthProvider;
  /** For tests. */
  fetch?: typeof fetch;
  now?: () => Date;
}

const OAUTH_COOKIE_SECONDS = 10 * 60;

export function sessionAuth({ db, provider, fetch: fetcher = fetch, now = () => new Date() }: SessionAuthOptions): Auth {
  async function signIn(request: Request, origin: string): Promise<Response> {
    if (!provider.clientId || !provider.clientSecret) {
      return text(503, `Sign-in isn't set up yet: set ${provider.env}_CLIENT_ID and ${provider.env}_CLIENT_SECRET (see README).`);
    }
    const next = safeNext(new URL(request.url).searchParams.get("next"));
    const state = randomToken();
    const verifier = randomToken();
    const authorize = new URL(provider.authorizeUrl);
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: provider.clientId,
      redirect_uri: `${origin}/auth/callback`,
      scope: provider.scope,
      state,
      code_challenge: await base64urlSha256(verifier),
      code_challenge_method: "S256",
    }).toString();
    const cookie = setCookie(request, cookieName(request, "oauth"), `${state}.${verifier}.${encodeURIComponent(next)}`, OAUTH_COOKIE_SECONDS);
    return redirect(authorize.href, [cookie]);
  }

  async function callback(request: Request, origin: string): Promise<Response> {
    const oauthCookie = cookieName(request, "oauth");
    const cleared = clearCookie(request, oauthCookie);
    const saved = parseOAuthCookie(readCookie(request, oauthCookie));
    if (!saved) return text(400, "This sign-in attempt has expired. Go back and sign in again.", [cleared]);

    const params = new URL(request.url).searchParams;
    if (params.get("error")) return redirect(saved.next, [cleared]); // e.g. the person pressed Cancel
    const code = params.get("code");
    // `state` ties the callback to the browser that started the sign-in (prevents login CSRF).
    if (!code || !constantTimeEqual(params.get("state") ?? "", saved.state)) {
      return text(400, "Sign-in failed: the request didn't match. Go back and sign in again.", [cleared]);
    }

    let profile: Profile;
    try {
      const accessToken = await exchangeCode(provider, fetcher, { code, verifier: saved.verifier, redirectUri: `${origin}/auth/callback` });
      profile = await provider.profile(accessToken, fetcher);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", message: "sign-in failed", provider: provider.id, error: String(error) }));
      return text(502, `Signing in with ${provider.label} failed. Please try again.`, [cleared]);
    }

    const at = now();
    const userId = await linkUser(db, provider.id, profile, at);
    // A new session on every sign-in (no session fixation); the previous one on this browser ends.
    const sessionCookie = cookieName(request, "session");
    const previous = readCookie(request, sessionCookie);
    if (previous) await deleteSession(db, await sha256Hex(previous));
    const token = await createSession(db, userId, request.headers.get("User-Agent"), at);
    return redirect(saved.next, [cleared, setCookie(request, sessionCookie, token, SESSION_LIFETIME_MS / 1000)]);
  }

  async function signOut(request: Request): Promise<Response> {
    guardMutation(request); // same-origin form or JSON only
    const body = await readBody(request);
    const sessionCookie = cookieName(request, "session");
    const session = await findSession(db, readCookie(request, sessionCookie), now());
    if (session && body.everywhere) await deleteUserSessions(db, session.user.id);
    else if (session) await deleteSession(db, session.id);
    return redirect("/", [clearCookie(request, sessionCookie)]);
  }

  return {
    session: (request) => findSession(db, readCookie(request, cookieName(request, "session")), now()),

    async handle(request, origin) {
      const { pathname } = new URL(request.url);
      const method = request.method;
      if (pathname === "/auth/sign-in" && method === "GET") return signIn(request, origin);
      if (pathname === "/auth/callback" && method === "GET") return callback(request, origin);
      if (pathname === "/auth/sign-out" && method === "POST") return signOut(request);
      return null;
    },

    prune: (at = now()) => pruneSessions(db, at),
  };
}

/** Finds or creates the user for a provider identity. Their name follows the provider on each sign-in. */
async function linkUser(db: Database, provider: string, profile: Profile, at: Date): Promise<string> {
  const find = () =>
    db.first<{ user_id: string }>("SELECT user_id FROM accounts WHERE provider = ? AND provider_user_id = ?", provider, profile.id);
  const existing = await find();
  if (existing) {
    await db.run("UPDATE users SET name = ? WHERE id = ?", profile.name, existing.user_id);
    return existing.user_id;
  }
  const id = crypto.randomUUID();
  await db.run("INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)", id, profile.name, at.toISOString());
  await db.run(
    "INSERT INTO accounts (provider, provider_user_id, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
    provider,
    profile.id,
    id,
    at.toISOString(),
  );
  const linked = await find();
  // Two first sign-ins at once: the other one won, so drop the user we just made.
  if (linked && linked.user_id !== id) await db.run("DELETE FROM users WHERE id = ?", id);
  return linked?.user_id ?? id;
}

/** Only same-site paths, and never back into /auth/: no open redirects, no loops. */
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  const url = new URL(value, "http://local");
  if (url.origin !== "http://local" || url.pathname.startsWith("/auth/")) return "/";
  return url.pathname + url.search;
}

function parseOAuthCookie(value: string | null): { state: string; verifier: string; next: string } | null {
  const [state, verifier, next] = value?.split(".", 3) ?? [];
  if (!state || !verifier || next === undefined) return null;
  try {
    return { state, verifier, next: safeNext(decodeURIComponent(next)) };
  } catch {
    return null;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function base64urlSha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/** Errors a person sees in the browser mid sign-in. */
function text(status: number, message: string, cookies: string[] = []): Response {
  const headers = new Headers({
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'",
    "X-Content-Type-Options": "nosniff",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(message, { status, headers });
}
