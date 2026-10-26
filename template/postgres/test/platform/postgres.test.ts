import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { SQL } from "bun";
import { postgresDatabase, toPostgresPlaceholders } from "../../src/platform/db/postgres";
import { databaseContract } from "../database-contract";

describe("postgres placeholders", () => {
  test("rewrites ? outside quotes", () => {
    expect(toPostgresPlaceholders("SELECT * FROM t WHERE a = ? AND b = '?' AND \"c?\" = ?")).toBe(
      "SELECT * FROM t WHERE a = $1 AND b = '?' AND \"c?\" = $2",
    );
    expect(toPostgresPlaceholders("SELECT 'it''s ?', ?")).toBe("SELECT 'it''s ?', $1");
  });
});

// Runs against a real server when TEST_DATABASE_URL is set (each run uses a fresh schema).
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("postgres adapter", () => {
  databaseContract("postgres", async () => {
    const schema = `test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const admin = new SQL({ url: url!, max: 1 });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.close();
    const client = new SQL({ url: url!, max: 1, connection: { search_path: schema } });
    const db = postgresDatabase(client);
    return { db, setup: (sql) => db.exec(sql) };
  });

  test("the migrations and sample data run", async () => {
    const schema = `test_${Date.now()}_m`;
    const client = new SQL({ url: url!, max: 1 });
    const db = postgresDatabase(client);
    await db.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};`);
    for (const file of (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort()) {
      await db.exec(await Bun.file(`migrations/${file}`).text());
    }
    await db.exec(await Bun.file("db/sample.sql").text());
    await db.exec(await Bun.file("db/sample.sql").text()); // idempotent
    expect(await db.all("SELECT slug FROM notes ORDER BY slug")).toEqual([{ slug: "hello-world" }, { slug: "small-and-fast" }]);
    expect(await db.all("SELECT id FROM guestbook")).toEqual([{ id: "g1" }]);
    await client.close();
  });
});
