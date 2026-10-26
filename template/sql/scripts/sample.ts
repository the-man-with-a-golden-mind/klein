// Loads db/sample.sql (example content). Usage: bun run db:sample
import { join } from "node:path";
import { close, db } from "./db";

await db.exec(await Bun.file(join(import.meta.dir, "..", "db", "sample.sql")).text());
console.log("Sample data loaded.");
await close();
