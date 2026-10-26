CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL -- ISO 8601, UTC
);

CREATE INDEX notes_published_at ON notes (published_at DESC);
