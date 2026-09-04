import { dataForSeoSchema, pipelineSchema, semrushSchema } from "@dominio-x/config";
import { createLogger } from "@dominio-x/observability";
import { createProviderRegistry } from "@dominio-x/providers";
import type { QueueMap, StageJobData } from "@dominio-x/queue";
import { MemoryObjectStorage } from "@dominio-x/storage";
import type { Db } from "@dominio-x/database";
import type { CoreContext } from "./context.js";
import { processStage } from "./pipeline.js";

/**
 * In-memory stand-in for the BullMQ queue map: records enqueued stage jobs so tests can
 * drive the pipeline deterministically without Redis.
 */
export interface StubQueues {
  queues: QueueMap;
  pending: { data: StageJobData; opts: Record<string, unknown> }[];
  drain(
    ctx: CoreContext,
    options?: { skipTimeouts?: boolean; maxSteps?: number },
  ): Promise<StageJobData[]>;
}

export function createStubQueues(): StubQueues {
  const pending: StubQueues["pending"] = [];
  const seen = new Set<string>();
  const makeQueue = () =>
    ({
      add: (name: string, data: StageJobData, opts: Record<string, unknown> = {}) => {
        const id = typeof opts.jobId === "string" ? opts.jobId : `${name}:${Math.random()}`;
        if (!seen.has(id)) {
          seen.add(id);
          pending.push({ data, opts });
        }
        return Promise.resolve({ id });
      },
      addBulk: (jobs: { name: string; data: StageJobData; opts?: Record<string, unknown> }[]) => {
        for (const j of jobs) {
          const id =
            typeof j.opts?.jobId === "string" ? j.opts.jobId : `${j.name}:${Math.random()}`;
          if (!seen.has(id)) {
            seen.add(id);
            pending.push({ data: j.data, opts: j.opts ?? {} });
          }
        }
        return Promise.resolve(jobs.map((j) => ({ id: j.opts?.jobId })));
      },
      getJobCounts: () =>
        Promise.resolve({
          waiting: pending.length,
          active: 0,
          delayed: 0,
          failed: 0,
          completed: 0,
          prioritized: 0,
        }),
      close: () => Promise.resolve(),
    }) as unknown as QueueMap["preflight"];
  const queues = {
    preflight: makeQueue(),
    dns: makeQueue(),
    crawl: makeQueue(),
    candidate_gate: makeQueue(),
    seo: makeQueue(),
    traffic: makeQueue(),
    rules: makeQueue(),
    score: makeQueue(),
    complete: makeQueue(),
  } satisfies QueueMap;
  return {
    queues,
    pending,
    async drain(ctx, options = {}) {
      const processed: StageJobData[] = [];
      let steps = 0;
      while (pending.length > 0 && steps < (options.maxSteps ?? 200)) {
        const job = pending.shift()!;
        if (job.data.kind === "crawl_timeout" && options.skipTimeouts) continue;
        await processStage(ctx, job.data, {
          attemptsMade: 0,
          maxAttempts: 1,
          jobId: typeof job.opts.jobId === "string" ? job.opts.jobId : "job",
        });
        processed.push(job.data);
        steps += 1;
      }
      return processed;
    },
  };
}

export function createTestContext(
  db: Db,
  overrides: Partial<CoreContext> & { env?: Record<string, string> } = {},
): CoreContext & { stub: StubQueues } {
  const env = { CRAWLER_ENABLED: "false", ...overrides.env };
  const pipeline = pipelineSchema.parse(env);
  const semrush = semrushSchema.parse(env);
  const dataforseo = dataForSeoSchema.parse(env);
  const stub = createStubQueues();
  const storage = overrides.storage ?? new MemoryObjectStorage();
  const { env: _env, ...rest } = overrides;
  return {
    db,
    storage,
    queues: stub.queues,
    providers: createProviderRegistry({ pipeline, semrush, dataforseo }),
    pipeline,
    semrush,
    dataforseo,
    logger: createLogger({ service: "test", level: "silent" }),
    ...rest,
    stub,
  };
}
