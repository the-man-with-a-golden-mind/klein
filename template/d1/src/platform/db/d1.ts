import type { Database } from "../types";

/** Cloudflare D1 (SQLite at the edge). Migrations run through wrangler, so no exec() here. */
export function d1Database(d1: D1Database): Database {
  return {
    async all<T>(sql: string, ...params: unknown[]) {
      const { results } = await d1.prepare(sql).bind(...params).all<T>();
      return results;
    },
    first: <T>(sql: string, ...params: unknown[]) => d1.prepare(sql).bind(...params).first<T>(),
    async run(sql: string, ...params: unknown[]) {
      const { meta } = await d1.prepare(sql).bind(...params).run();
      return { changes: meta.changes };
    },
  };
}
