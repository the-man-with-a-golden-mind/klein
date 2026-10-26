// Data shapes shared by the server (loaders) and the browser (pages).

export interface SiteInfo {
  name: string;
  description: string;
  origin: string;
  /** Cache-busting version for /assets/client.js and /assets/styles.css. */
  build: string;
}

/** The signed-in person, as pages see them (projects created with --auth). Never put secrets here. */
export interface User {
  id: string;
  name: string;
}

export interface NoteSummary {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string; // ISO 8601
}

export interface Note extends NoteSummary {
  body: string;
}

export interface NotesData {
  notes: NoteSummary[];
  page: number;
  hasMore: boolean;
}

export interface NoteData {
  note: Note;
}

export interface GuestbookEntry {
  id: string;
  name: string;
  message: string;
  createdAt: string; // ISO 8601
}

/** Result of the last no-JavaScript form post, passed back through the query string. */
export type GuestbookNotice = "signed" | "invalid_name" | "invalid_message";

export interface GuestbookData {
  entries: GuestbookEntry[];
  notice: GuestbookNotice | null;
}
