-- Example content for local development: `bun run db:sample` (after the migrations). Portable SQL.
INSERT INTO notes (id, slug, title, excerpt, body, published_at) VALUES
  ('n1', 'hello-world', 'Hello, world', 'The first note, rendered on the server and hydrated in the browser.',
   'This note comes from the database through a typed loader.

Navigate back and forth: only the data is fetched, never a whole page.', '2026-01-15T09:00:00Z'),
  ('n2', 'small-and-fast', 'Small and fast', 'Why this template has two runtime dependencies.',
   'Routing, data loading and HTTP helpers are our own code, small enough to read in an afternoon.

Preact renders on the server; the browser hydrates the same markup.', '2026-02-02T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO guestbook (id, name, message, created_at) VALUES
  ('g1', 'Ada', 'Lovely little site. Signed without a single loading spinner.', '2026-03-01T12:00:00Z')
ON CONFLICT (id) DO NOTHING;
