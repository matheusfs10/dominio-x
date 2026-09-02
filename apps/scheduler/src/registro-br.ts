/**
 * Registro.br release-list watcher. Runs as a Railway cron job (`0 * /6 * * *` UTC, see railway.json),
 * is idempotent, and exits when done so Railway considers the run complete.
 */
import { recordOperationalEvent, runRetention, watchRegistroBr } from "@dominio-x/domain-core";
import { RegistroBrReleaseSourceAdapter } from "@dominio-x/source-adapters";
import { createSchedulerRuntime } from "./bootstrap.js";

async function main() {
  const runtime = await createSchedulerRuntime("scheduler-registro-br");
  const { config, logger, core } = runtime;
  const startedAt = Date.now();
  let exitCode = 0;
  try {
    const adapter = new RegistroBrReleaseSourceAdapter({
      url: config.REGISTRO_BR_RELEASE_URL,
      userAgent: config.REGISTRO_BR_USER_AGENT,
      timeoutMs: config.REGISTRO_BR_TIMEOUT_MS,
    });
    const result = await watchRegistroBr(core, adapter);
    logger.info(
      {
        changed: result.changed,
        reason: result.reason,
        httpStatus: result.httpStatus,
        sourceBatchId: result.batch?.id,
        stats: result.stats,
        durationMs: Date.now() - startedAt,
      },
      "registro.br watch finished",
    );
    const retention = await runRetention(core.db, {
      restrictedRetentionDays: config.PROVIDER_RESTRICTED_RETENTION_DAYS,
    });
    logger.info({ retention }, "retention finished");
  } catch (error) {
    exitCode = 1;
    logger.error({ err: error }, "registro.br watch failed");
    await recordOperationalEvent(core.db, {
      component: "scheduler",
      code: "REGISTRO_BR_WATCH_FAILED",
      message: error instanceof Error ? error.message : "unknown",
    }).catch(() => undefined);
  } finally {
    await runtime.close();
  }
  process.exit(exitCode);
}

main().catch((error: unknown) => {
  console.error("[scheduler] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
