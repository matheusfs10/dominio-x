import type { PipelineConfig, SemrushConfig } from "@dominio-x/config";
import type { Db } from "@dominio-x/database";
import type { Logger } from "@dominio-x/observability";
import type { ProviderRegistry } from "@dominio-x/providers";
import type { QueueMap } from "@dominio-x/queue";
import type { ObjectStorage } from "@dominio-x/storage";

/**
 * Dependencies shared by every service. Built once per process (api, worker, scheduler)
 * and passed explicitly — no globals — so tests can substitute any piece.
 */
export interface CoreContext {
  db: Db;
  storage: ObjectStorage;
  queues: QueueMap;
  providers: ProviderRegistry;
  pipeline: PipelineConfig;
  semrush: SemrushConfig;
  logger: Logger;
  now?: () => Date;
}

export function nowOf(ctx: CoreContext): Date {
  return ctx.now ? ctx.now() : new Date();
}
