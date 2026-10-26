import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { sqliteDatabase } from "../../src/platform/db/sqlite";
import { databaseContract } from "../database-contract";

describe("sqlite adapter", () => {
  databaseContract("sqlite", async () => {
    const db = sqliteDatabase(":memory:");
    return { db, setup: (sql) => db.exec(sql) };
  });

  test("the migrations and sample data run", async () => {
    const db = sqliteDatabase(":memory:");
    for (const file of (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort()) {
      await db.exec(await Bun.file(`migrations/${file}`).text());
    }
    await db.exec(await Bun.file("db/sample.sql").text());
    await db.exec(await Bun.file("db/sample.sql").text()); // idempotent
    expect(await db.all("SELECT slug FROM notes ORDER BY slug")).toEqual([{ slug: "hello-world" }, { slug: "small-and-fast" }]);
    expect(await db.all("SELECT id FROM guestbook")).toEqual([{ id: "g1" }]);
  });
});
