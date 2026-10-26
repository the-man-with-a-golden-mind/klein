// Behaviour every Database adapter must share. Each adapter's test calls this with a fresh, empty database.
import { expect, test } from "bun:test";
import type { Database } from "../src/platform/types";

export function databaseContract(name: string, open: () => Promise<{ db: Database; setup: (sql: string) => Promise<void> }>) {
  test(`${name}: all / first / run with ? placeholders`, async () => {
    const { db, setup } = await open();
    await setup("CREATE TABLE contract_items (id TEXT PRIMARY KEY, label TEXT NOT NULL, n INTEGER NOT NULL)");

    expect(await db.run("INSERT INTO contract_items (id, label, n) VALUES (?, ?, ?)", "a", "it's ?", 1)).toEqual({ changes: 1 });
    await db.run("INSERT INTO contract_items (id, label, n) VALUES (?, ?, ?)", "b", "second", 2);

    const rows = await db.all<{ id: string; label: string }>("SELECT id, label FROM contract_items ORDER BY id");
    expect(rows).toEqual([
      { id: "a", label: "it's ?" },
      { id: "b", label: "second" },
    ]);
    expect(await db.all("SELECT id FROM contract_items WHERE n > ? AND label <> '?'", 1)).toEqual([{ id: "b" }]);
    expect(await db.first<{ label: string }>("SELECT label FROM contract_items WHERE id = ?", "b")).toEqual({ label: "second" });
    expect(await db.first("SELECT label FROM contract_items WHERE id = ?", "zzz")).toBeNull();
    expect(await db.run("UPDATE contract_items SET n = n + 1")).toEqual({ changes: 2 });
  });
}
