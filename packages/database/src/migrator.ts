import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Db } from "./client.js";

/** Resolves the immutable migrations folder from either src/ or dist/. */
export function migrationsFolder(): string {
  return fileURLToPath(new URL("../migrations", import.meta.url));
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, {
    migrationsFolder: migrationsFolder(),
    migrationsTable: "__drizzle_migrations",
  });
}
