// POST /api/guestbook — example of a browser-facing write.
// Serves both fetch() with JSON (201 + the entry) and a plain HTML form (303 back to /guestbook?notice=…).
import type { Database } from "../../platform/types";
import type { GuestbookEntry } from "../../shared/types";
import type { RouteContext } from "../app";
import { guardMutation, HttpError, isFormPost, json, readBody, redirect, requireText } from "../http";

export async function signGuestbook({ request, app }: RouteContext): Promise<Response> {
  guardMutation(request); // same-origin only (CSRF), JSON or form
  const fromForm = isFormPost(request);
  try {
    const body = await readBody(request);
    const entry: GuestbookEntry = {
      id: crypto.randomUUID(),
      name: requireText(body.name, 60, "invalid_name"),
      message: requireText(body.message, 500, "invalid_message"),
      createdAt: new Date().toISOString(),
    };
    // Honeypot filled in → pretend it worked, store nothing.
    if (!body.website) {
      await app.services.db.run(
        "INSERT INTO guestbook (id, name, message, created_at) VALUES (?, ?, ?, ?)",
        entry.id,
        entry.name,
        entry.message,
        entry.createdAt,
      );
    }
    return fromForm ? redirect("/guestbook?notice=signed") : json(entry, { status: 201 });
  } catch (error) {
    if (fromForm && error instanceof HttpError && error.status === 400) {
      return redirect(`/guestbook?notice=${encodeURIComponent(error.code)}`);
    }
    throw error;
  }
}

/** Called from runScheduled(): keeps the guestbook to the last year. */
export async function pruneGuestbook(db: Database, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const { changes } = await db.run("DELETE FROM guestbook WHERE created_at < ?", cutoff);
  return changes;
}
