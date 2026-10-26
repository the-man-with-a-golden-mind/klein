import type { ScriptableDatabase } from "../types";

/**
 * The part of a Postgres client we use. Both Bun's built-in `SQL` and the `postgres` package
 * (used on Workers with Hyperdrive) have this method.
 */
export interface PostgresClient {
  unsafe(query: string, params?: unknown[]): PromiseLike<ArrayLike<unknown> & { count?: number | null }>;
}

/** Rewrites `?` placeholders to `$1, $2…`, leaving quoted strings and identifiers alone. */
export function toPostgresPlaceholders(sql: string): string {
  let out = "";
  let quote: string | null = null;
  let n = 0;
  for (const char of sql) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "?") {
      out += `$${++n}`;
      continue;
    }
    out += char;
  }
  return out;
}

export function postgresDatabase(client: PostgresClient): ScriptableDatabase {
  const query = (sql: string, params: unknown[]) => client.unsafe(toPostgresPlaceholders(sql), params);
  return {
    async all<T>(sql: string, ...params: unknown[]) {
      return Array.from(await query(sql, params)) as T[];
    },
    async first<T>(sql: string, ...params: unknown[]) {
      const rows = await query(sql, params);
      return (rows[0] as T | undefined) ?? null;
    },
    async run(sql: string, ...params: unknown[]) {
      const result = await query(sql, params);
      return { changes: result.count ?? 0 };
    },
    async exec(script: string) {
      // No parameters → simple query protocol, which runs several statements in one round trip.
      await client.unsafe(script);
    },
  };
}
