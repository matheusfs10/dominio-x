/**
 * Seed command: reference data + versioned defaults + bootstrap admin.
 * `--dev` adds development sample data (refused in production).
 */
import { loadBootstrapConfig, loadDatabaseConfig } from "@dominio-x/config";
import { createDatabase } from "./client.js";
import { seedDatabase } from "./seed-core.js";

async function main() {
  const config = loadDatabaseConfig();
  const bootstrap = loadBootstrapConfig();
  const dev =
    process.argv.includes("--dev") ||
    (config.NODE_ENV !== "production" && !process.argv.includes("--no-dev"));
  if (dev && config.NODE_ENV === "production") {
    throw new Error("Refusing to seed development data in production");
  }
  const handle = createDatabase({
    url: config.DATABASE_URL,
    max: 2,
    applicationName: "dominio-x-seed",
  });
  try {
    const report = await seedDatabase(handle.db, {
      dev,
      bootstrapAdmin:
        bootstrap.BOOTSTRAP_ADMIN_EMAIL && bootstrap.BOOTSTRAP_ADMIN_PASSWORD
          ? { email: bootstrap.BOOTSTRAP_ADMIN_EMAIL, password: bootstrap.BOOTSTRAP_ADMIN_PASSWORD }
          : null,
      log: (m) => console.error(`[seed] ${m}`),
    });
    console.error(`[seed] report: ${JSON.stringify(report)}`);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error("[seed] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
