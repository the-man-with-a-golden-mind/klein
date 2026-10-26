// Loader data for /account: where this person is signed in.
import type { Database, Session } from "../../platform/types";
import type { AccountData } from "../../shared/types";
import { IDLE_TIMEOUT_MS } from "./sessions";

export async function loadAccount(db: Database, session: Session | null, now = new Date()): Promise<AccountData | null> {
  if (!session) return null;
  const rows = await db.all<{ id: string; created_at: string; last_seen_at: string; user_agent: string | null }>(
    `SELECT id, created_at, last_seen_at, user_agent FROM sessions
      WHERE user_id = ? AND expires_at > ? AND last_seen_at > ?
      ORDER BY last_seen_at DESC`,
    session.user.id,
    now.toISOString(),
    new Date(now.getTime() - IDLE_TIMEOUT_MS).toISOString(),
  );
  const accounts = await db.all<{ provider: string }>("SELECT provider FROM accounts WHERE user_id = ? ORDER BY provider", session.user.id);
  return {
    providers: accounts.map((a) => a.provider),
    // Session ids (token hashes) stay on the server; the page only learns which one is this browser.
    sessions: rows.map((r) => ({ current: r.id === session.id, userAgent: r.user_agent, createdAt: r.created_at, lastSeenAt: r.last_seen_at })),
  };
}
