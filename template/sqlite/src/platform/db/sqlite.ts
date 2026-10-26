import { Database as SQLite, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ScriptableDatabase } from "../types";

/** SQLite file via bun:sqlite. Pass ":memory:" for a throwaway database (tests). */
export function sqliteDatabase(path: string): ScriptableDatabase {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new SQLite(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const bind = (params: unknown[]) => params as SQLQueryBindings[];

  return {
    async all<T>(sql: string, ...params: unknown[]) {
      return db.query(sql).all(...bind(params)) as T[];
    },
    async first<T>(sql: string, ...params: unknown[]) {
      return (db.query(sql).get(...bind(params)) as T | null) ?? null;
    },
    async run(sql: string, ...params: unknown[]) {
      const { changes } = db.query(sql).run(...bind(params));
      return { changes };
    },
    async exec(script: string) {
      db.exec(script);
    },
  };
}
