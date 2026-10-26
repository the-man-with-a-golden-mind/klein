import { Database as SQLite } from "bun:sqlite";
import { describe } from "bun:test";
import { d1Database } from "../../src/platform/db/d1";
import { databaseContract } from "../database-contract";

/** Just enough of the D1 binding, backed by an in-memory SQLite (which is what D1 is). */
function fakeD1(sqlite: SQLite): D1Database {
  const prepare = (sql: string) => ({
    bind: (...params: never[]) => ({
      all: async () => ({ results: sqlite.query(sql).all(...params) }),
      first: async () => sqlite.query(sql).get(...params) ?? null,
      run: async () => ({ meta: { changes: sqlite.query(sql).run(...params).changes } }),
    }),
  });
  return { prepare } as unknown as D1Database;
}

describe("d1 adapter", () => {
  databaseContract("d1", async () => {
    const sqlite = new SQLite(":memory:");
    return { db: d1Database(fakeD1(sqlite)), setup: async (sql) => void sqlite.exec(sql) };
  });
});
