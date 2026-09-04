import { PIPELINE_STAGES } from "@dominio-x/contracts";
import { loadWorkerConfig } from "@dominio-x/config";
import { createDatabase } from "@dominio-x/database";
import { processStage, type CoreContext } from "@dominio-x/domain-core";
import { createLogger, initSentry } from "@dominio-x/observability";
import { createProviderRegistry } from "@dominio-x/providers";
import {
  closeQueues,
  createQueues,
  createRedisConnection,
  createStageWorker,
  redisConnectionOptions,
  stageJobSchema,
} from "@dominio-x/queue";
import { createObjectStorage } from "@dominio-x/storage";

async function main() {
  const config = loadWorkerConfig();
  const logger = createLogger({ service: "worker", level: config.LOG_LEVEL });
  await initSentry({ dsn: config.SENTRY_DSN, service: "worker", environment: config.NODE_ENV });

  const database = createDatabase({
    url: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    applicationName: "dominio-x-worker",
  });
  const redis = createRedisConnection(config.REDIS_URL);
  const connection = redisConnectionOptions(config.REDIS_URL);
  const queues = createQueues(connection);
  const storage = createObjectStorage(config);
  const providers = createProviderRegistry({
    pipeline: config,
    semrush: config,
    dataforseo: config,
    redis,
  });
  const core: CoreContext = {
    db: database.db,
    storage,
    queues,
    providers,
    pipeline: config,
    semrush: config,
    dataforseo: config,
    logger,
  };

  const workers = PIPELINE_STAGES.map((stage) => {
    const concurrency =
      stage === "seo"
        ? Math.min(config.PIPELINE_WORKER_CONCURRENCY, config.SEMRUSH_MAX_CONCURRENCY)
        : stage === "traffic"
          ? Math.min(config.PIPELINE_WORKER_CONCURRENCY, config.DATAFORSEO_MAX_CONCURRENCY)
          : config.PIPELINE_WORKER_CONCURRENCY;
    const worker = createStageWorker(
      stage,
      async (job) => {
        const data = stageJobSchema.parse(job.data);
        const startedAt = Date.now();
        await processStage(core, data, {
          attemptsMade: job.attemptsMade,
          maxAttempts: job.opts.attempts ?? 3,
          jobId: job.id ?? "unknown",
        });
        logger.debug(
          {
            jobId: job.id,
            stage,
            analysisRunId: data.analysisRunId,
            durationMs: Date.now() - startedAt,
          },
          "job done",
        );
      },
      { connection, concurrency, lockDurationMs: 120_000 },
    );
    worker.on("failed", (job, error) =>
      logger.error(
        {
          jobId: job?.id,
          stage,
          analysisRunId: job?.data.analysisRunId,
          attemptsMade: job?.attemptsMade,
          err: error,
        },
        "job failed",
      ),
    );
    worker.on("error", (error) => logger.error({ stage, err: error }, "worker error"));
    return worker;
  });

  logger.info(
    {
      stages: PIPELINE_STAGES,
      concurrency: config.PIPELINE_WORKER_CONCURRENCY,
      crawler: config.CRAWLER_ENABLED,
      semrush: providers.semrush.describeStatus().state,
      dataforseo: providers.dataforseo.describeStatus().state,
    },
    "worker started",
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down worker");
    try {
      await Promise.all(workers.map((w) => w.close()));
      await closeQueues(queues);
      await redis.quit();
      await database.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) =>
    logger.error({ err: reason }, "unhandled rejection"),
  );
  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "uncaught exception");
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  console.error("[worker] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
