// The database scripts/migrate.ts and scripts/sample.ts work on. Same setting as src/services.ts.
import { sqliteDatabase } from "../src/platform/db/sqlite";

export const db = sqliteDatabase(process.env.DATABASE_PATH ?? "data/app.sqlite");
export const close = async () => {};
