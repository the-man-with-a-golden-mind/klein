-- Sign-in (create-klein --auth). Portable across SQLite, D1 and Postgres. Dates are ISO-8601 text.

-- A person. One user can sign in through several providers (see accounts).
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- A provider identity (e.g. GitHub user 123) linked to a user.
CREATE TABLE accounts (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX accounts_user_id ON accounts (user_id);

-- A signed-in browser. `id` is the SHA-256 (hex) of the cookie token: a leaked table holds no usable sessions.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_user_id ON sessions (user_id);
CREATE INDEX sessions_expires_at ON sessions (expires_at);
