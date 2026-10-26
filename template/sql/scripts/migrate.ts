// Applies migrations/NNNN_name.sql in order, once each. Usage: bun run db:migrate
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { close, db } from "./db";

const DIR = join(import.meta.dir, "..", "migrations");
const NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

await db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
const applied = new Set((await db.all<{ name: string }>("SELECT name FROM _migrations")).map((r) => r.name));
const files = (await readdir(DIR)).filter((f) => NAME.test(f)).sort();

for (const name of files) {
  if (applied.has(name)) continue;
  const sql = await Bun.file(join(DIR, name)).text();
  // One script, one transaction: the migration and its bookkeeping row succeed or fail together.
  // `name` matches NAME, so it is safe to inline.
  await db.exec(`BEGIN;\n${sql}\n;INSERT INTO _migrations (name, applied_at) VALUES ('${name}', '${new Date().toISOString()}');\nCOMMIT;`);
  console.log(`applied ${name}`);
}
console.log(files.every((f) => applied.has(f)) ? "Database is up to date." : "Done.");
await close();
