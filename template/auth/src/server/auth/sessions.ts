// Database-backed sessions: a random token in an HttpOnly cookie, only its SHA-256 in the database.
// Revocable (sign out, sign out everywhere), with an idle timeout and an absolute lifetime.
import type { Database, Session } from "../../platform/types";

const DAY = 24 * 60 * 60 * 1000;
/** Sign in again after this, however active the session is. Also the cookie's Max-Age. */
export const SESSION_LIFETIME_MS = 30 * DAY;
/** A session unused for this long has expired. */
export const IDLE_TIMEOUT_MS = 7 * DAY;
/** `last_seen_at` is written at most this often, so most requests are a single read. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

const TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

// ---------------------------------------------------------------- cookies

/**
 * `__Host-` cookies are HTTPS-only, bound to this host and path=/. Plain http://localhost (bun run dev,
 * wrangler dev) gets unprefixed, non-Secure cookies; any other host always gets the strict ones.
 */
function isLocal(request: Request): boolean {
  const { hostname } = new URL(request.url);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function cookieName(request: Request, name: "session" | "oauth"): string {
  return isLocal(request) ? name : `__Host-${name}`;
}

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/** HttpOnly + SameSite=Lax: invisible to scripts, and not sent with cross-site POSTs or subrequests. */
export function setCookie(request: Request, name: string, value: string, maxAgeSeconds: number): string {
  const secure = isLocal(request) ? "" : "; Secure";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export const clearCookie = (request: Request, name: string) => setCookie(request, name, "", 0);

// ---------------------------------------------------------------- tokens

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- sessions

/** Creates a session and returns the token for the cookie. The database only ever sees its hash. */
export async function createSession(db: Database, userId: string, userAgent: string | null, now = new Date()): Promise<string> {
  const token = randomToken();
  await db.run(
    "INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
    await sha256Hex(token),
    userId,
    now.toISOString(),
    now.toISOString(),
    new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
    userAgent?.slice(0, 200) ?? null,
  );
  return token;
}

interface SessionRow {
  id: string;
  user_id: string;
  name: string;
  last_seen_at: string;
  expires_at: string;
}

/** The live session for a cookie token, or null. Expired sessions are deleted on sight. */
export async function findSession(db: Database, token: string | null, now = new Date()): Promise<Session | null> {
  if (!token || !TOKEN.test(token)) return null;
  const row = await db.first<SessionRow>(
    `SELECT s.id, s.user_id, u.name, s.last_seen_at, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    await sha256Hex(token),
  );
  if (!row) return null;

  const lastSeen = Date.parse(row.last_seen_at);
  if (Date.parse(row.expires_at) <= now.getTime() || lastSeen + IDLE_TIMEOUT_MS <= now.getTime()) {
    await deleteSession(db, row.id);
    return null;
  }
  if (now.getTime() - lastSeen > TOUCH_INTERVAL_MS) {
    await db.run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", now.toISOString(), row.id);
  }
  return { id: row.id, user: { id: row.user_id, name: row.name } };
}

export async function deleteSession(db: Database, id: string): Promise<void> {
  await db.run("DELETE FROM sessions WHERE id = ?", id);
}

/** "Sign out everywhere". */
export async function deleteUserSessions(db: Database, userId: string): Promise<void> {
  await db.run("DELETE FROM sessions WHERE user_id = ?", userId);
}

export async function pruneSessions(db: Database, now = new Date()): Promise<number> {
  const idleCutoff = new Date(now.getTime() - IDLE_TIMEOUT_MS).toISOString();
  const { changes } = await db.run(
    "DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?",
    now.toISOString(),
    idleCutoff,
  );
  return changes;
}
