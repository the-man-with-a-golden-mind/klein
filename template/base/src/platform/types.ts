// What the app needs from the platform. Adapters in src/platform/db and src/platform/storage
// implement these for D1, SQLite, Postgres, R2 and S3; src/services.ts picks the ones this app uses.
import type { User } from "../shared/types";

/**
 * SQL database. Write portable SQL with `?` placeholders; the Postgres adapter rewrites them to $1, $2…
 */
export interface Database {
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  first<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
}

/** A Database that can also run a script of several statements (used by scripts/migrate.ts). */
export interface ScriptableDatabase extends Database {
  exec(script: string): Promise<void>;
}

export interface StoredObject {
  body: ReadableStream<Uint8Array>;
  size: number;
  contentType?: string;
  etag?: string;
}

/** Object storage (R2 binding on Cloudflare, any S3-compatible bucket elsewhere). */
export interface Storage {
  get(key: string): Promise<StoredObject | null>;
  put(key: string, body: string | Uint8Array | ArrayBuffer, options?: { contentType?: string }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** A signed-in session. `id` is the SHA-256 of the cookie token, never the token itself. Server-only. */
export interface Session {
  id: string;
  user: User;
}

/** Sign-in and sessions (src/server/auth/ in projects created with --auth). */
export interface Auth {
  /** The session for this request's cookie, or null. */
  session(request: Request): Promise<Session | null>;
  /** Handles /auth/* (sign-in, callback, sign-out). Returns null for paths it doesn't own. */
  handle(request: Request, origin: string): Promise<Response | null>;
  /** Deletes expired sessions. Called by runScheduled(). */
  prune(now?: Date): Promise<number>;
}

export interface Services {
  db: Database;
  storage?: Storage; // present when the app was created with --storage
  auth?: Auth; // present when the app was created with --auth
  /** Releases per-request resources (e.g. a Postgres client on Workers). Called after the response. */
  close?: () => Promise<void>;
}
