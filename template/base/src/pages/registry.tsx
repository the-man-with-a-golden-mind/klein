import type { FunctionComponent } from "preact";
import type { GuestbookData, NoteData, NotesData } from "../shared/types";
import { GuestbookPage } from "./GuestbookPage";
import { HomePage } from "./HomePage";
import { NotePage } from "./NotePage";
import { NotesPage } from "./NotesPage";
import { NotFoundPage } from "./NotFoundPage";

export interface PageDefinition<D> {
  path: string; // URLPattern syntax, shared by server and browser: "/notes/:slug"
  hasData: boolean; // true → loader in src/server/loaders.ts
  title?: string | ((data: D) => string); // "<title> — <site name>"; none → site name
  description?: (data: D) => string; // none → site description
  cache?: number; // seconds browsers/CDNs may reuse the HTML and /api/page data; 0 → no-store. Default 60
  // Only these pages' loaders see the signed-in user (--auth). "required" → anonymous visitors are sent to sign in.
  auth?: "required" | "optional";
  component: FunctionComponent<{ data: D }>;
}

const staticPage = (p: Omit<PageDefinition<undefined>, "hasData">): PageDefinition<undefined> => ({ ...p, hasData: false });
const dataPage = <D,>(p: Omit<PageDefinition<D>, "hasData">): PageDefinition<D> => ({ ...p, hasData: true });

// THE list of pages. Adding a page: component + one line here (+ loader if dataPage) + optional nav entry.
export const PAGES = {
  home: staticPage({ path: "/", component: HomePage }),
  notes: dataPage<NotesData>({ path: "/notes", title: "Notes", component: NotesPage }),
  note: dataPage<NoteData>({
    path: "/notes/:slug",
    title: (d) => d.note.title,
    description: (d) => d.note.excerpt,
    component: NotePage,
  }),
  guestbook: dataPage<GuestbookData>({ path: "/guestbook", title: "Guestbook", cache: 0, component: GuestbookPage }),
};

export type PageId = keyof typeof PAGES;
export type PageData<K extends PageId> = (typeof PAGES)[K] extends PageDefinition<infer D> ? D : never;
export type DataPageId = { [K in PageId]: PageData<K> extends undefined ? never : K }[PageId];
export type ResolvedPage = { id: PageId; data: unknown } | { id: "not-found" };

export const PAGE_IDS = Object.keys(PAGES) as PageId[];

// The registry is typed per entry; here we only need the shape shared by all of them.
function definition(id: PageId): PageDefinition<unknown> {
  return PAGES[id] as PageDefinition<unknown>;
}

export function PageView({ page }: { page: ResolvedPage }) {
  if (page.id === "not-found") return <NotFoundPage />;
  const Component = definition(page.id).component;
  return <Component data={page.data} />;
}

export function pageTitle(page: ResolvedPage): string | undefined {
  if (page.id === "not-found") return "Page not found";
  const { title } = definition(page.id);
  return typeof title === "function" ? title(page.data) : title;
}

export function pageDescription(page: ResolvedPage): string | undefined {
  if (page.id === "not-found") return undefined;
  return definition(page.id).description?.(page.data);
}

const DEFAULT_CACHE_SECONDS = 60;

/** Cache-Control for a page's HTML and its /api/page data. */
export function pageCacheControl(page: ResolvedPage): string {
  if (page.id === "not-found") return "no-store";
  const { auth, cache } = definition(page.id);
  if (auth) return "private, no-store"; // the data depends on who is asking
  const seconds = cache ?? DEFAULT_CACHE_SECONDS;
  return seconds > 0 ? `public, max-age=${seconds}, stale-while-revalidate=${seconds * 5}` : "no-store";
}

export function documentTitle(title: string | undefined, siteName: string): string {
  return title ? `${title} — ${siteName}` : siteName;
}
