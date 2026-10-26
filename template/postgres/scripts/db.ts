// The database scripts/migrate.ts and scripts/sample.ts work on. Set DATABASE_URL (Bun loads .env).
import { SQL } from "bun";
import { postgresDatabase } from "../src/platform/db/postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL, e.g. in .env (see .env.example).");
const client = new SQL({ url, max: 1 });

export const db = postgresDatabase(client);
export const close = () => client.close();
