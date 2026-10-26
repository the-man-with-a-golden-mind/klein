// Server-only data for each data page. Never import this from browser code.
import { PAGE_IDS, PAGES, type DataPageId, type PageData, type ResolvedPage } from "../pages/registry";
import type { GuestbookNotice, Note, NoteSummary, User } from "../shared/types";
import type { Services, Session } from "../platform/types";
import { decodeParams, HttpError } from "./http";

interface LoadContext {
  services: Services;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Set only for pages with `auth` in the registry; always null elsewhere, so their data stays cacheable. */
  user: User | null;
  session: Session | null;
}
type Loader<D> = (ctx: LoadContext) => Promise<D | null>; // null → 404

const NOTES_PER_PAGE = 20;
const GUESTBOOK_ENTRIES = 50;
const GUESTBOOK_NOTICES: GuestbookNotice[] = ["signed", "invalid_name", "invalid_message"];
export const SLUG = /^[a-z0-9-]{1,100}$/;

interface NoteRow {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  published_at: string;
}

const toSummary = (row: Omit<NoteRow, "body">): NoteSummary => ({
  slug: row.slug,
  title: row.title,
  excerpt: row.excerpt,
  publishedAt: row.published_at,
});

/** `?page=` must be absent or an integer 1–10000; anything else is a 404. */
function pageNumber(query: URLSearchParams): number | null {
  const raw = query.get("page");
  if (raw === null) return 1;
  if (!/^[1-9][0-9]{0,4}$/.test(raw)) return null;
  const page = Number(raw);
  return page <= 10000 ? page : null;
}

const LOADERS: { [K in DataPageId]: Loader<PageData<K>> } = {
  notes: async ({ services: { db }, query }) => {
    const page = pageNumber(query);
    if (page === null) return null;
    // Fetch one extra row to know whether an older page exists.
    const rows = await db.all<Omit<NoteRow, "body">>(
      "SELECT slug, title, excerpt, published_at FROM notes ORDER BY published_at DESC LIMIT ? OFFSET ?",
      NOTES_PER_PAGE + 1,
      (page - 1) * NOTES_PER_PAGE,
    );
    if (page > 1 && rows.length === 0) return null;
    return {
      notes: rows.slice(0, NOTES_PER_PAGE).map(toSummary),
      page,
      hasMore: rows.length > NOTES_PER_PAGE,
    };
  },

  note: async ({ services: { db }, params }) => {
    const slug = params.slug ?? "";
    if (!SLUG.test(slug)) return null;
    const row = await db.first<NoteRow>(
      "SELECT slug, title, excerpt, body, published_at FROM notes WHERE slug = ?",
      slug,
    );
    if (!row) return null;
    const note: Note = { ...toSummary(row), body: row.body };
    return { note };
  },

  guestbook: async ({ services: { db }, query }) => {
    const rows = await db.all<{ id: string; name: string; message: string; created_at: string }>(
      "SELECT id, name, message, created_at FROM guestbook ORDER BY created_at DESC LIMIT ?",
      GUESTBOOK_ENTRIES,
    );
    // ?notice= comes back from a plain form post (src/server/api/guestbook.ts); unknown values are ignored.
    const notice = query.get("notice");
    return {
      entries: rows.map((r) => ({ id: r.id, name: r.name, message: r.message, createdAt: r.created_at })),
      notice: GUESTBOOK_NOTICES.find((n) => n === notice) ?? null,
    };
  },
};

const PATTERNS = PAGE_IDS.map((id) => ({ id, pattern: new URLPattern({ pathname: PAGES[id].path }) }));
const NOT_FOUND: ResolvedPage = { id: "not-found" };

/** Finds the page for `url` and runs its loader. Throws 401 `sign_in_required` for `auth: "required"` pages. */
export async function resolvePage(services: Services, url: URL, session: Session | null = null): Promise<ResolvedPage> {
  for (const { id, pattern } of PATTERNS) {
    const match = pattern.exec({ pathname: url.pathname });
    if (!match) continue;
    const params = decodeParams(match.pathname.groups);
    if (!params) return NOT_FOUND;
    const { auth, hasData } = PAGES[id];
    if (auth === "required" && !session) throw new HttpError(401, "sign_in_required");
    if (!hasData) return { id, data: undefined };
    const visible = auth ? session : null;
    const loader = LOADERS[id as DataPageId] as Loader<unknown>;
    const data = await loader({ services, params, query: url.searchParams, user: visible?.user ?? null, session: visible });
    return data === null ? NOT_FOUND : { id, data };
  }
  return NOT_FOUND;
}
