CREATE TABLE guestbook (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL -- ISO 8601, UTC
);

CREATE INDEX guestbook_created_at ON guestbook (created_at DESC);
