import { loadApiConfig } from "@dominio-x/config";
import { createDatabase } from "@dominio-x/database";
import type { CoreContext } from "@dominio-x/domain-core";
import { createLogger, initSentry } from "@dominio-x/observability";
import { createProviderRegistry } from "@dominio-x/providers";
import {
  closeQueues,
  createQueues,
  createRedisConnection,
  redisConnectionOptions,
} from "@dominio-x/queue";
import { createObjectStorage } from "@dominio-x/storage";
import { buildApp } from "./app.js";

async function main() {
  const config = loadApiConfig();
  const logger = createLogger({ service: "api", level: config.LOG_LEVEL });
  await initSentry({ dsn: config.SENTRY_DSN, service: "api", environment: config.NODE_ENV });

  const database = createDatabase({
    url: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    applicationName: "dominio-x-api",
  });
  const redis = createRedisConnection(config.REDIS_URL);
  const queues = createQueues(redisConnectionOptions(config.REDIS_URL));
  const storage = createObjectStorage(config);
  const providers = createProviderRegistry({ pipeline: config, semrush: config, redis });
  const core: CoreContext = {
    db: database.db,
    storage,
    queues,
    providers,
    pipeline: config,
    semrush: config,
    logger,
  };

  const app = await buildApp({
    config,
    database,
    redis,
    core,
    storageHealth: () => storage.healthcheck(),
  });
  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info(
    {
      port: config.PORT,
      storage: storage.driver,
      semrush: providers.semrush.describeStatus().state,
    },
    "api listening",
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    try {
      await app.close();
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
  console.error("[api] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
