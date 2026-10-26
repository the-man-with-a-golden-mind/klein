// Test helpers: a real in-memory SQLite database built from migrations/, an in-memory Storage, and an App.
// bun:sqlite is part of Bun, so these work whatever database the project itself uses.
import { Database as SQLite, type SQLQueryBindings } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database, Storage } from "../src/platform/types";
import type { App } from "../src/server/app";

export const NOTES = [
  {
    slug: "second",
    title: "Second note",
    excerpt: "The newer one.",
    body: "Para one.\n\nPara two with </script><script>alert(1)</script>.",
    published_at: "2026-02-02T09:00:00Z",
  },
  { slug: "first", title: "First note", excerpt: "The older one.", body: "Hello.", published_at: "2026-01-15T09:00:00Z" },
];

const MIGRATIONS = join(import.meta.dir, "..", "migrations");

/** A fresh database with every migration applied and the NOTES above. */
export function testDb(): Database & { sqlite: SQLite } {
  const sqlite = new SQLite(":memory:", { strict: true });
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  const insert = sqlite.query("INSERT INTO notes (id, slug, title, excerpt, body, published_at) VALUES (?, ?, ?, ?, ?, ?)");
  for (const n of NOTES) insert.run(n.slug, n.slug, n.title, n.excerpt, n.body, n.published_at);

  const bind = (params: unknown[]) => params as SQLQueryBindings[];
  return {
    sqlite,
    all: async <T,>(sql: string, ...params: unknown[]) => sqlite.query(sql).all(...bind(params)) as T[],
    first: async <T,>(sql: string, ...params: unknown[]) => (sqlite.query(sql).get(...bind(params)) as T | null) ?? null,
    run: async (sql: string, ...params: unknown[]) => ({ changes: sqlite.query(sql).run(...bind(params)).changes }),
  };
}

export function memoryStorage(initial: Record<string, string> = {}): Storage & { files: Map<string, { bytes: Uint8Array; type?: string }> } {
  const files = new Map<string, { bytes: Uint8Array; type?: string }>(Object.entries(initial).map(([k, v]) => [k, { bytes: new TextEncoder().encode(v), type: "text/plain" }] as const));
  return {
    files,
    async get(key) {
      const file = files.get(key);
      if (!file) return null;
      return { body: new Response(file.bytes as Uint8Array<ArrayBuffer>).body!, size: file.bytes.byteLength, contentType: file.type, etag: '"1"' };
    },
    async put(key, body, options = {}) {
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
      files.set(key, { bytes, type: options.contentType });
    },
    async delete(key) {
      files.delete(key);
    },
  };
}

export const ADMIN_TOKEN = "test-admin-token";

const ASSET_FILES: Record<string, string> = { "/assets/hello.txt": "hello" };

export function testApp(overrides: Partial<App> = {}): App {
  return {
    services: { db: testDb() },
    build: "test-build",
    secrets: { adminToken: ADMIN_TOKEN },
    async assets(request) {
      const file = ASSET_FILES[new URL(request.url).pathname];
      return file === undefined ? new Response("Not found", { status: 404 }) : new Response(file);
    },
    ...overrides,
  };
}
