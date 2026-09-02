import { loadSchedulerConfig, type SchedulerConfig } from "@dominio-x/config";
import { createDatabase, type DatabaseHandle } from "@dominio-x/database";
import type { CoreContext } from "@dominio-x/domain-core";
import { createLogger, initSentry, type Logger } from "@dominio-x/observability";
import { createProviderRegistry } from "@dominio-x/providers";
import {
  closeQueues,
  createQueues,
  createRedisConnection,
  redisConnectionOptions,
} from "@dominio-x/queue";
import { createObjectStorage } from "@dominio-x/storage";
import { semrushSchema } from "@dominio-x/config";

export interface SchedulerRuntime {
  config: SchedulerConfig;
  logger: Logger;
  database: DatabaseHandle;
  core: CoreContext;
  close(): Promise<void>;
}

/** Builds a short-lived runtime for one-shot cron jobs and closes every resource afterwards. */
export async function createSchedulerRuntime(service: string): Promise<SchedulerRuntime> {
  const config = loadSchedulerConfig();
  const logger = createLogger({ service, level: config.LOG_LEVEL });
  await initSentry({ dsn: config.SENTRY_DSN, service, environment: config.NODE_ENV });
  const database = createDatabase({
    url: config.DATABASE_URL,
    max: 4,
    applicationName: `dominio-x-${service}`,
  });
  const redis = createRedisConnection(config.REDIS_URL);
  const queues = createQueues(redisConnectionOptions(config.REDIS_URL));
  const storage = createObjectStorage(config);
  const semrush = semrushSchema.parse(process.env);
  const providers = createProviderRegistry({ pipeline: config, semrush });
  const core: CoreContext = {
    db: database.db,
    storage,
    queues,
    providers,
    pipeline: config,
    semrush,
    logger,
  };
  return {
    config,
    logger,
    database,
    core,
    async close() {
      await closeQueues(queues);
      await redis.quit();
      await database.close();
    },
  };
}
