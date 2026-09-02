import { and, eq, sql } from "drizzle-orm";
import {
  AppError,
  METRICS,
  PROVIDER_KEYS,
  type CrawlerJob,
  type CrawlerResult,
} from "@dominio-x/contracts";
import {
  crawlerJobs,
  domainSummaries,
  type CrawlerJobRecord,
  type DbOrTx,
} from "@dominio-x/database";
import {
  measuredObservation,
  unknownObservation,
  type ObservationInput,
} from "@dominio-x/providers";
import { enqueueStage } from "@dominio-x/queue";
import { completeStep, findStep } from "./analysis.js";
import type { CoreContext } from "./context.js";
import { recordObservations, recordProviderRequests } from "./observations.js";

/**
 * Lease-based job queue consumed by the isolated crawler project through the machine API.
 */
export async function createCrawlerJob(
  db: DbOrTx,
  input: { analysisRunId: string; domainId: string; fqdn: string },
): Promise<CrawlerJobRecord> {
  const [job] = await db
    .insert(crawlerJobs)
    .values({ ...input, status: "pending" })
    .returning();
  return job!;
}

export async function claimCrawlerJobs(
  db: DbOrTx,
  input: { workerId: string; max: number; leaseSeconds: number },
): Promise<CrawlerJob[]> {
  const rows = await db.execute<{
    id: string;
    analysis_run_id: string;
    domain_id: string;
    fqdn: string;
    lease_expires_at: string | Date;
    attempt: number;
  }>(sql`
    with candidates as (
      select id from ${crawlerJobs}
      where (status = 'pending' or (status = 'claimed' and lease_expires_at < now()))
        and attempt < max_attempts
      order by created_at
      limit ${input.max}
      for update skip locked
    )
    update ${crawlerJobs} j
      set status = 'claimed', claimed_by = ${input.workerId}, claimed_at = now(), heartbeat_at = now(),
          lease_expires_at = now() + (${input.leaseSeconds} || ' seconds')::interval, attempt = j.attempt + 1
      from candidates c where j.id = c.id
      returning j.id, j.analysis_run_id, j.domain_id, j.fqdn, j.lease_expires_at, j.attempt
  `);
  return (rows as unknown as typeof rows extends Array<infer T> ? T[] : never[]).map((r) => ({
    id: r.id,
    analysisRunId: r.analysis_run_id,
    domainId: r.domain_id,
    fqdn: r.fqdn,
    leaseExpiresAt: new Date(r.lease_expires_at).toISOString(),
    attempt: r.attempt,
  }));
}

async function requireClaimed(
  db: DbOrTx,
  jobId: string,
  workerId: string,
): Promise<CrawlerJobRecord> {
  const job = await db.query.crawlerJobs.findFirst({ where: eq(crawlerJobs.id, jobId) });
  if (!job) throw new AppError("CRAWLER_JOB_NOT_FOUND", "Crawler job not found.");
  if (job.status !== "claimed" || job.claimedBy !== workerId)
    throw new AppError("CRAWLER_JOB_NOT_CLAIMED", "Job is not claimed by this worker.");
  if (job.leaseExpiresAt && job.leaseExpiresAt < new Date())
    throw new AppError("CRAWLER_JOB_LEASE_EXPIRED", "Job lease expired.");
  return job;
}

export async function heartbeatCrawlerJob(
  db: DbOrTx,
  input: { jobId: string; workerId: string; leaseSeconds: number },
): Promise<{ leaseExpiresAt: string }> {
  await requireClaimed(db, input.jobId, input.workerId);
  const leaseExpiresAt = new Date(Date.now() + input.leaseSeconds * 1000);
  await db
    .update(crawlerJobs)
    .set({ heartbeatAt: new Date(), leaseExpiresAt })
    .where(eq(crawlerJobs.id, input.jobId));
  return { leaseExpiresAt: leaseExpiresAt.toISOString() };
}

export function crawlerResultToObservations(
  result: CrawlerResult,
  ttlHours: number,
): ObservationInput[] {
  const opts = { licenseClass: "public_source" as const, ttlHours };
  const o: ObservationInput[] = [
    measuredObservation(METRICS.HTTP_REACHABLE, result.reachable, opts),
    measuredObservation(METRICS.HTTP_SECURITY_BLOCKED, result.securityBlocked, opts),
    measuredObservation(METRICS.HTTP_REDIRECT_COUNT, result.redirectCount, opts),
    measuredObservation(METRICS.HTTP_REDIRECT_CHAIN, result.redirectChain, opts),
  ];
  const text = (key: string, v: string | null) =>
    o.push(
      v === null
        ? unknownObservation(key, "not_available", "no value", opts)
        : measuredObservation(key, v, opts),
    );
  const num = (key: string, v: number | null) =>
    o.push(
      v === null
        ? unknownObservation(key, "not_available", "no value", opts)
        : measuredObservation(key, v, opts),
    );
  num(METRICS.HTTP_STATUS, result.status);
  o.push(
    result.httpsAvailable === null
      ? unknownObservation(METRICS.HTTP_HTTPS_AVAILABLE, "unknown", "not probed", opts)
      : measuredObservation(METRICS.HTTP_HTTPS_AVAILABLE, result.httpsAvailable, opts),
  );
  text(METRICS.HTTP_FINAL_URL, result.finalUrl);
  text(METRICS.HTTP_FINAL_HOSTNAME, result.finalHostname);
  text(METRICS.HTTP_TITLE, result.title);
  text(METRICS.HTTP_META_DESCRIPTION, result.metaDescription);
  text(METRICS.HTTP_CONTENT_TYPE, result.contentType);
  num(METRICS.HTTP_CONTENT_LENGTH, result.contentLength);
  text(METRICS.HTTP_SERVER, result.server);
  if (result.error) o.push(measuredObservation(METRICS.HTTP_ERROR, result.error, opts));
  return o;
}

/** Records the crawler result, finishes the crawl step and advances the pipeline. */
export async function completeCrawlerJob(
  ctx: CoreContext,
  input: { jobId: string; workerId: string; result: CrawlerResult },
): Promise<void> {
  const job = await requireClaimed(ctx.db, input.jobId, input.workerId);
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(crawlerJobs)
      .set({ status: "completed", completedAt: new Date(), resultJson: input.result })
      .where(eq(crawlerJobs.id, job.id));
    await recordObservations(
      tx,
      {
        domainId: job.domainId,
        analysisRunId: job.analysisRunId,
        providerKey: PROVIDER_KEYS.CRAWLER,
      },
      crawlerResultToObservations(input.result, ctx.pipeline.HTTP_TTL_HOURS),
    );
    await recordProviderRequests(
      tx,
      {
        providerKey: PROVIDER_KEYS.CRAWLER,
        analysisRunId: job.analysisRunId,
        domainId: job.domainId,
      },
      [
        {
          endpointKey: "fetch",
          durationMs: input.result.durationMs,
          statusCode: input.result.status ?? undefined,
          errorCode: input.result.securityBlocked
            ? "SECURITY_BLOCKED"
            : input.result.error
              ? "FETCH_ERROR"
              : undefined,
        },
      ],
    );
    const step = await findStep(tx, job.analysisRunId, "crawl");
    if (step && step.status === "running")
      await completeStep(tx, step, {
        status: "completed",
        metadata: { crawlerJobId: job.id, workerId: input.workerId, attempt: job.attempt },
      });
    await tx
      .update(domainSummaries)
      .set({ httpStatus: input.result.status, updatedAt: new Date() })
      .where(eq(domainSummaries.domainId, job.domainId));
  });
  await enqueueStage(ctx.queues, {
    analysisRunId: job.analysisRunId,
    domainId: job.domainId,
    stage: "candidate_gate",
  });
}

export async function failCrawlerJob(
  ctx: CoreContext,
  input: {
    jobId: string;
    workerId: string;
    errorCode: string;
    message?: string;
    retryable: boolean;
  },
): Promise<{ willRetry: boolean }> {
  const job = await requireClaimed(ctx.db, input.jobId, input.workerId);
  const willRetry = input.retryable && job.attempt < job.maxAttempts;
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(crawlerJobs)
      .set({
        status: willRetry ? "pending" : "failed",
        errorCode: input.errorCode,
        errorMessage: (input.message ?? "").slice(0, 500),
        leaseExpiresAt: null,
        claimedBy: null,
        ...(willRetry ? {} : { completedAt: new Date() }),
      })
      .where(eq(crawlerJobs.id, job.id));
    if (!willRetry) {
      const opts = {
        licenseClass: "public_source" as const,
        ttlHours: ctx.pipeline.HTTP_TTL_HOURS,
      };
      await recordObservations(
        tx,
        {
          domainId: job.domainId,
          analysisRunId: job.analysisRunId,
          providerKey: PROVIDER_KEYS.CRAWLER,
        },
        [
          unknownObservation(METRICS.HTTP_REACHABLE, "error", input.errorCode, opts),
          unknownObservation(METRICS.HTTP_STATUS, "error", input.errorCode, opts),
        ],
      );
      const step = await findStep(tx, job.analysisRunId, "crawl");
      if (step && step.status === "running")
        await completeStep(tx, step, {
          status: "failed",
          errorCode: input.errorCode,
          metadata: { crawlerJobId: job.id, workerId: input.workerId },
        });
    }
  });
  if (!willRetry)
    await enqueueStage(ctx.queues, {
      analysisRunId: job.analysisRunId,
      domainId: job.domainId,
      stage: "candidate_gate",
    });
  return { willRetry };
}

/** Called by the delayed timeout job: gives up waiting for the crawler and moves on. */
export async function expireCrawlerJobForRun(ctx: CoreContext, runId: string): Promise<boolean> {
  const job = await ctx.db.query.crawlerJobs.findFirst({
    where: and(eq(crawlerJobs.analysisRunId, runId)),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
  if (!job || job.status === "completed" || job.status === "failed" || job.status === "expired")
    return false;
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(crawlerJobs)
      .set({ status: "expired", completedAt: new Date(), errorCode: "CRAWL_WAIT_TIMEOUT" })
      .where(eq(crawlerJobs.id, job.id));
    const opts = { licenseClass: "public_source" as const, ttlHours: 1 };
    await recordObservations(
      tx,
      { domainId: job.domainId, analysisRunId: runId, providerKey: PROVIDER_KEYS.CRAWLER },
      [
        unknownObservation(
          METRICS.HTTP_REACHABLE,
          "unknown",
          "crawler did not pick up the job in time",
          opts,
        ),
      ],
    );
    const step = await findStep(tx, runId, "crawl");
    if (step && step.status === "running")
      await completeStep(tx, step, {
        status: "skipped",
        errorCode: "CRAWL_WAIT_TIMEOUT",
        metadata: { crawlerJobId: job.id },
      });
  });
  return true;
}

export async function crawlerQueueCounts(db: DbOrTx): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: crawlerJobs.status, n: sql<number>`count(*)::int` })
    .from(crawlerJobs)
    .groupBy(crawlerJobs.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
