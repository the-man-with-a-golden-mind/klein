// POST /api/admin/notes — example of a machine-to-machine endpoint (scripts, CI, a CMS webhook).
// Protected by a bearer token: ADMIN_TOKEN in .env / .dev.vars locally, a secret in production.
import type { RouteContext } from "../app";
import { HttpError, json, readJsonBody, requireBearer, requireText } from "../http";
import { SLUG } from "../loaders";

const MAX_NOTE_BYTES = 256 * 1024;

export async function createNote({ request, app }: RouteContext): Promise<Response> {
  await requireBearer(request, app.secrets.adminToken);
  const body = await readJsonBody(request, MAX_NOTE_BYTES);

  const slug = requireText(body.slug, 100, "invalid_slug");
  if (!SLUG.test(slug)) throw new HttpError(400, "invalid_slug");
  const title = requireText(body.title, 200, "invalid_title");
  const text = requireText(body.body, MAX_NOTE_BYTES, "invalid_body");
  const excerpt = body.excerpt === undefined ? "" : requireText(body.excerpt, 300, "invalid_excerpt");
  const publishedAt = body.publishedAt === undefined ? new Date() : new Date(String(body.publishedAt));
  if (Number.isNaN(publishedAt.getTime())) throw new HttpError(400, "invalid_published_at");

  const { db } = app.services;
  if (await db.first("SELECT id FROM notes WHERE slug = ?", slug)) throw new HttpError(409, "slug_taken");
  await db.run(
    "INSERT INTO notes (id, slug, title, excerpt, body, published_at) VALUES (?, ?, ?, ?, ?, ?)",
    crypto.randomUUID(),
    slug,
    title,
    excerpt,
    text,
    publishedAt.toISOString(),
  );
  return json({ slug, url: `/notes/${slug}` }, { status: 201, headers: { Location: `/notes/${slug}` } });
}
