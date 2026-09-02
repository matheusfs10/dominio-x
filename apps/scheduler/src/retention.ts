/** Standalone retention/maintenance command (also executed at the end of each watcher run). */
import { runRetention } from "@dominio-x/domain-core";
import { createSchedulerRuntime } from "./bootstrap.js";

async function main() {
  const runtime = await createSchedulerRuntime("scheduler-retention");
  try {
    const report = await runRetention(runtime.core.db, {
      restrictedRetentionDays: runtime.config.PROVIDER_RESTRICTED_RETENTION_DAYS,
    });
    runtime.logger.info({ report }, "retention finished");
  } finally {
    await runtime.close();
  }
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("[retention] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
