/**
 * Explicit migration command. Run once per deploy (Railway pre-deploy on the api service),
 * never at boot of every replica.
 */
import { loadDatabaseConfig } from "@dominio-x/config";
import { createDatabase } from "./client.js";
import { migrationsFolder, runMigrations } from "./migrator.js";

async function main() {
  const config = loadDatabaseConfig();
  const handle = createDatabase({
    url: config.DATABASE_URL,
    max: 1,
    applicationName: "dominio-x-migrate",
  });
  const startedAt = Date.now();
  console.error(`[migrate] applying migrations from ${migrationsFolder()}`);
  try {
    await runMigrations(handle.db);
    console.error(`[migrate] done in ${Date.now() - startedAt}ms`);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error("[migrate] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
