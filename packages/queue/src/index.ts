import {
  Queue,
  Worker,
  type ConnectionOptions,
  type Job,
  type JobsOptions,
  type Processor,
  type WorkerOptions,
} from "bullmq";
import { Redis, type RedisOptions } from "ioredis";
import { z } from "zod";
import { PIPELINE_STAGES, type PipelineStage } from "@dominio-x/contracts";

export type { Job };

/** Queue namespace/version. Bump when job contracts change incompatibly. */
export const QUEUE_PREFIX = "dx-v1";

export const QUEUE_NAMES: Record<PipelineStage, string> = {
  preflight: "domain-preflight",
  dns: "domain-dns",
  crawl: "domain-crawl",
  candidate_gate: "domain-candidate-gate",
  seo: "domain-seo",
  traffic: "domain-traffic",
  rules: "domain-rules",
  score: "domain-score",
  complete: "domain-complete",
};

export const stageJobSchema = z.object({
  analysisRunId: z.string().uuid(),
  domainId: z.string().uuid(),
  stage: z.enum(PIPELINE_STAGES),
  /** Optional marker for timeout/continuation jobs (e.g. crawl wait timeout). */
  kind: z.enum(["stage", "crawl_timeout"]).default("stage"),
});
export type StageJobData = z.infer<typeof stageJobSchema>;

export function stageJobId(
  stage: PipelineStage,
  analysisRunId: string,
  kind: StageJobData["kind"] = "stage",
): string {
  // BullMQ custom ids must not contain ':'.
  return kind === "stage" ? `${stage}--${analysisRunId}` : `${kind}--${analysisRunId}`;
}

export function createRedisConnection(url: string, options: RedisOptions = {}): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
    ...options,
  });
}

export function redisConnectionOptions(url: string): ConnectionOptions {
  const parsed = new URL(url);
  const opts: RedisOptions = {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
  if (parsed.username) opts.username = decodeURIComponent(parsed.username);
  if (parsed.password) opts.password = decodeURIComponent(parsed.password);
  if (parsed.protocol === "rediss:") opts.tls = { rejectUnauthorized: false };
  const dbMatch = /^\/(\d+)$/.exec(parsed.pathname);
  if (dbMatch) opts.db = Number(dbMatch[1]);
  if (parsed.hostname.endsWith(".railway.internal")) opts.family = 0;
  return opts;
}

/** Exponential backoff with jitter: base * 2^(attempt-1) ± 30%, capped at 5 minutes. */
export function backoffDelayMs(attemptsMade: number, baseMs = 5_000): number {
  const exp = Math.min(baseMs * 2 ** Math.max(0, attemptsMade - 1), 300_000);
  const jitter = exp * 0.3 * (Math.random() * 2 - 1);
  return Math.round(exp + jitter);
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "custom" },
  removeOnComplete: { age: 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export type QueueMap = Record<PipelineStage, Queue<StageJobData>>;

export function createQueues(connection: ConnectionOptions): QueueMap {
  const entries = PIPELINE_STAGES.map((stage) => [
    stage,
    new Queue<StageJobData>(QUEUE_NAMES[stage], {
      connection,
      prefix: QUEUE_PREFIX,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
  ]);
  return Object.fromEntries(entries) as QueueMap;
}

export async function closeQueues(queues: QueueMap): Promise<void> {
  await Promise.all(Object.values(queues).map((q) => q.close()));
}

export interface EnqueueStageOptions {
  delayMs?: number;
  priority?: number;
  attempts?: number;
}

/**
 * Enqueues a stage job with a deterministic job id, so that the same (stage, run) pair is
 * never processed twice concurrently. Adding an existing job id is a no-op in BullMQ.
 */
export async function enqueueStage(
  queues: QueueMap,
  data: Omit<StageJobData, "kind"> & { kind?: StageJobData["kind"] },
  options: EnqueueStageOptions = {},
): Promise<string> {
  const payload = stageJobSchema.parse(data);
  const jobId = stageJobId(payload.stage, payload.analysisRunId, payload.kind);
  await queues[payload.stage].add(payload.kind === "stage" ? "run" : payload.kind, payload, {
    jobId,
    delay: options.delayMs,
    priority: options.priority,
    attempts: options.attempts,
  });
  return jobId;
}

export interface StageWorkerOptions {
  connection: ConnectionOptions;
  concurrency?: number;
  lockDurationMs?: number;
}

export function createStageWorker(
  stage: PipelineStage,
  processor: Processor<StageJobData>,
  options: StageWorkerOptions,
): Worker<StageJobData> {
  const workerOptions: WorkerOptions = {
    connection: options.connection,
    prefix: QUEUE_PREFIX,
    concurrency: options.concurrency ?? 5,
    lockDuration: options.lockDurationMs ?? 60_000,
    settings: { backoffStrategy: (attemptsMade: number) => backoffDelayMs(attemptsMade) },
  };
  return new Worker<StageJobData>(QUEUE_NAMES[stage], processor, workerOptions);
}

export interface QueueCounts {
  stage: PipelineStage;
  queue: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  prioritized: number;
}

export async function getQueueCounts(queues: QueueMap): Promise<QueueCounts[]> {
  return Promise.all(
    PIPELINE_STAGES.map(async (stage) => {
      const counts = await queues[stage].getJobCounts(
        "waiting",
        "active",
        "delayed",
        "failed",
        "completed",
        "prioritized",
      );
      return {
        stage,
        queue: QUEUE_NAMES[stage],
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
        prioritized: counts.prioritized ?? 0,
      };
    }),
  );
}

/**
 * Error subclass for deterministic failures that must not be retried by BullMQ.
 */
export class UnrecoverableJobError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UnrecoverableError";
  }
}
