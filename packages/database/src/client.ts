import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema/index.js";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DatabaseHandle {
  db: Db;
  sql: Sql;
  close(): Promise<void>;
  ping(timeoutMs?: number): Promise<boolean>;
}

export interface CreateDatabaseOptions {
  url: string;
  max?: number;
  /** Application name reported to PostgreSQL (visible in pg_stat_activity). */
  applicationName?: string;
}

export function createDatabase(options: CreateDatabaseOptions): DatabaseHandle {
  const sql = postgres(options.url, {
    max: options.max ?? 10,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => undefined,
    connection: { application_name: options.applicationName ?? "dominio-x" },
  });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  return {
    db,
    sql,
    async close() {
      await sql.end({ timeout: 5 });
    },
    async ping(timeoutMs = 2000) {
      try {
        await Promise.race([
          sql`select 1`,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("db ping timeout")), timeoutMs),
          ),
        ]);
        return true;
      } catch {
        return false;
      }
    },
  };
}
