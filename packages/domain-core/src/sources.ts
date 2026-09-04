import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  AppError,
  SOURCE_KEYS,
  decodeCursor,
  encodeCursor,
  type AnalysisTriggerType,
  type Page,
} from "@dominio-x/contracts";
import {
  analysisRuns,
  analysisSteps,
  domainSummaries,
  sourceBatchDomains,
  sourceBatches,
  sources,
  type Db,
  type SourceBatch,
} from "@dominio-x/database";
import { normalizeDomain, type NormalizedDomain } from "@dominio-x/normalization";
import {
  parseRegistroBrTimestamp,
  type RegistroBrReleaseSourceAdapter,
  type SourceAdapter,
  type SourceArtifact,
} from "@dominio-x/source-adapters";
import { createAnalysisRunsBulk, enqueueRunsBulk } from "./analysis.js";
import { recordOperationalEvent } from "./audit.js";
import type { CoreContext } from "./context.js";
import { upsertDomains } from "./domains.js";

export interface IngestInput {
  adapter: SourceAdapter;
  artifact: SourceArtifact;
  name?: string | null;
  createdBy?: string | null;
  analyze: boolean;
  triggerType: AnalysisTriggerType;
  /** Analyze only domains never seen before this batch. */
  onlyNew?: boolean;
  forceRefresh?: boolean;
}

export interface IngestResult {
  batch: SourceBatch;
  created: boolean;
  stats: {
    total: number;
    newDomains: number;
    invalid: number;
    duplicates: number;
    runsCreated: number;
    enqueued: number;
  };
}

export function artifactKeyFor(sourceKey: string, artifact: SourceArtifact): string {
  const at = artifact.fetchedAt;
  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  const ts = at.toISOString().replace(/[:.]/g, "-");
  return `sources/${sourceKey.replace(/_/g, "-")}/${yyyy}/${mm}/${ts}-${artifact.sha256}.txt`;
}

/**
 * Turns a fetched artifact into an immutable source batch:
 * store raw bytes → create batch (unique per source+sha) → parse/normalize/dedupe → upsert domains →
 * link batch domains → (optionally) create and enqueue analysis runs.
 */
export async function ingestArtifact(ctx: CoreContext, input: IngestInput): Promise<IngestResult> {
  const { adapter, artifact } = input;
  const source = await ctx.db.query.sources.findFirst({ where: eq(sources.key, adapter.key) });
  if (!source) throw new AppError("INTERNAL_ERROR", `Source ${adapter.key} is not registered.`);
  if (!source.enabled) throw new AppError("CONFLICT", `Source ${adapter.key} is disabled.`);

  const existing = await ctx.db.query.sourceBatches.findFirst({
    where: and(
      eq(sourceBatches.sourceId, source.id),
      eq(sourceBatches.contentSha256, artifact.sha256),
    ),
  });
  // A batch that failed mid-ingestion is resumed in place: every step below is idempotent
  // (domain upserts, ON CONFLICT DO NOTHING links, run creation skips active runs).
  const resume = existing?.status === "failed" ? existing : null;
  if (existing && !resume) {
    ctx.logger.info(
      { sourceKey: adapter.key, sourceBatchId: existing.id, sha256: artifact.sha256 },
      "source content already ingested; no new batch",
    );
    return {
      batch: existing,
      created: false,
      stats: {
        total: existing.domainCount,
        newDomains: existing.newDomainCount,
        invalid: existing.invalidLineCount,
        duplicates: 0,
        runsCreated: 0,
        enqueued: 0,
      },
    };
  }

  const artifactKey = resume?.artifactKey ?? artifactKeyFor(adapter.key, artifact);
  if (!resume?.artifactKey) {
    await ctx.storage.putObject({
      key: artifactKey,
      body: artifact.content,
      contentType: artifact.contentType ?? "text/plain",
      metadata: { sha256: artifact.sha256, source: adapter.key },
    });
  }

  let batch: SourceBatch;
  if (resume) {
    const [row] = await ctx.db
      .update(sourceBatches)
      .set({ status: "ingesting", artifactKey })
      .where(eq(sourceBatches.id, resume.id))
      .returning();
    batch = row!;
    ctx.logger.warn(
      { sourceKey: adapter.key, sourceBatchId: batch.id },
      "resuming failed batch ingestion",
    );
  } else
    try {
      const [row] = await ctx.db
        .insert(sourceBatches)
        .values({
          sourceId: source.id,
          name: input.name ?? null,
          externalReference: artifact.url,
          status: "ingesting",
          contentSha256: artifact.sha256,
          artifactKey,
          etag: artifact.etag,
          lastModified: artifact.lastModified,
          detectedAt: artifact.fetchedAt,
          createdBy: input.createdBy ?? null,
          metadataJson: {
            httpStatus: artifact.httpStatus,
            contentType: artifact.contentType,
            contentLength: artifact.content.length,
            ...artifact.metadata,
          },
        })
        .returning();
      batch = row!;
    } catch (error) {
      const again = await ctx.db.query.sourceBatches.findFirst({
        where: and(
          eq(sourceBatches.sourceId, source.id),
          eq(sourceBatches.contentSha256, artifact.sha256),
        ),
      });
      if (again)
        return {
          batch: again,
          created: false,
          stats: {
            total: again.domainCount,
            newDomains: again.newDomainCount,
            invalid: again.invalidLineCount,
            duplicates: 0,
            runsCreated: 0,
            enqueued: 0,
          },
        };
      throw error;
    }

  const log = ctx.logger.child({ sourceKey: adapter.key, sourceBatchId: batch.id });
  try {
    // Parse + normalize + dedupe (the adapter already validated; normalization is deterministic and cheap).
    const normalized: NormalizedDomain[] = [];
    const rawByFqdn = new Map<string, { raw: string; position: number }>();
    for await (const record of adapter.parse(artifact)) {
      const n = normalizeDomain(record.raw);
      if (!n.ok || rawByFqdn.has(n.asciiFqdn)) continue;
      rawByFqdn.set(n.asciiFqdn, { raw: record.raw, position: record.position });
      normalized.push(n);
    }
    const parseStats = adapter.lastParseStats();

    const upserted = await upsertDomains(ctx.db, normalized, adapter.key);
    let newDomains = 0;
    const CHUNK = 1000;
    for (let i = 0; i < upserted.length; i += CHUNK) {
      const chunk = upserted.slice(i, i + CHUNK);
      await ctx.db
        .insert(sourceBatchDomains)
        .values(
          chunk.map((d) => {
            const meta = rawByFqdn.get(d.asciiFqdn)!;
            if (d.isNew) newDomains += 1;
            return {
              sourceBatchId: batch.id,
              domainId: d.id,
              rawValue: meta.raw,
              position: meta.position,
              isNew: d.isNew,
            };
          }),
        )
        .onConflictDoNothing();
    }

    const publishedAt = parseRegistroBrTimestamp(parseStats?.metadata.generatedAt);
    const [updated] = await ctx.db
      .update(sourceBatches)
      .set({
        status: "ingested",
        domainCount: upserted.length,
        newDomainCount: newDomains,
        invalidLineCount: parseStats?.invalidLines ?? 0,
        publishedAt,
        metadataJson: sql`${sourceBatches.metadataJson} || ${JSON.stringify({
          parse: parseStats
            ? {
                totalLines: parseStats.totalLines,
                candidateLines: parseStats.candidateLines,
                commentLines: parseStats.commentLines,
                blankLines: parseStats.blankLines,
                invalidLines: parseStats.invalidLines,
                duplicateLines: parseStats.duplicateLines,
                issues: parseStats.issues.slice(0, 50),
                ...parseStats.metadata,
              }
            : null,
        })}::jsonb`,
      })
      .where(eq(sourceBatches.id, batch.id))
      .returning();
    batch = updated!;
    log.info(
      {
        domains: upserted.length,
        newDomains,
        invalid: parseStats?.invalidLines ?? 0,
        duplicates: parseStats?.duplicateLines ?? 0,
      },
      "source batch ingested",
    );

    let runsCreated = 0;
    let enqueued = 0;
    if (input.analyze) {
      const targets = (input.onlyNew ? upserted.filter((d) => d.isNew) : upserted).map((d) => d.id);
      const runs = await createAnalysisRunsBulk(ctx.db, targets, {
        triggerType: input.triggerType,
        triggerReference: batch.id,
        sourceBatchId: batch.id,
        requestedBy: input.createdBy ?? null,
        forceRefresh: input.forceRefresh ?? false,
        priority: 200,
      });
      runsCreated = runs.length;
      enqueued = await enqueueRunsBulk(ctx, runs);
      const [b] = await ctx.db
        .update(sourceBatches)
        .set({ status: "analyzing" })
        .where(eq(sourceBatches.id, batch.id))
        .returning();
      batch = b!;
      log.info({ runsCreated, enqueued }, "batch analysis enqueued");
    }
    return {
      batch,
      created: true,
      stats: {
        total: upserted.length,
        newDomains,
        invalid: parseStats?.invalidLines ?? 0,
        duplicates: parseStats?.duplicateLines ?? 0,
        runsCreated,
        enqueued,
      },
    };
  } catch (error) {
    await ctx.db
      .update(sourceBatches)
      .set({
        status: "failed",
        metadataJson: sql`${sourceBatches.metadataJson} || ${JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 300) : "unknown" })}::jsonb`,
      })
      .where(eq(sourceBatches.id, batch.id));
    await recordOperationalEvent(ctx.db, {
      component: "ingestion",
      code: "BATCH_INGEST_FAILED",
      message: error instanceof Error ? error.message : "unknown",
      context: { sourceBatchId: batch.id },
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Registro.br watcher
// ---------------------------------------------------------------------------
export interface WatchResult {
  changed: boolean;
  reason: "not_modified" | "same_sha" | "new_batch" | "already_ingested";
  batch?: SourceBatch;
  stats?: IngestResult["stats"];
  httpStatus: number | null;
}

export async function watchRegistroBr(
  ctx: CoreContext,
  adapter: RegistroBrReleaseSourceAdapter,
): Promise<WatchResult> {
  const source = await ctx.db.query.sources.findFirst({
    where: eq(sources.key, SOURCE_KEYS.REGISTRO_BR_RELEASE),
  });
  if (!source)
    throw new AppError("INTERNAL_ERROR", "Registro.br source is not registered (run db:seed).");
  const last = await ctx.db.query.sourceBatches.findFirst({
    where: eq(sourceBatches.sourceId, source.id),
    orderBy: desc(sourceBatches.detectedAt),
  });
  // A failed batch must be re-fetched and re-ingested: no conditional request, no SHA short-circuit.
  const retryFailed = last?.status === "failed";
  const artifact = await adapter.fetch({
    lastEtag: retryFailed ? null : (last?.etag ?? null),
    lastModified: retryFailed ? null : (last?.lastModified ?? null),
  });
  if (artifact.notModified) {
    ctx.logger.info({ etag: artifact.etag }, "registro.br: not modified (304)");
    return { changed: false, reason: "not_modified", httpStatus: artifact.httpStatus, batch: last };
  }
  if (last && !retryFailed && last.contentSha256 === artifact.sha256) {
    ctx.logger.info({ sha256: artifact.sha256 }, "registro.br: identical content (sha256 match)");
    return { changed: false, reason: "same_sha", httpStatus: artifact.httpStatus, batch: last };
  }
  const result = await ingestArtifact(ctx, {
    adapter,
    artifact,
    analyze: true,
    triggerType: "batch",
    onlyNew: false,
  });
  return {
    changed: result.created,
    reason: result.created ? "new_batch" : "already_ingested",
    batch: result.batch,
    stats: result.stats,
    httpStatus: artifact.httpStatus,
  };
}

// ---------------------------------------------------------------------------
// Listing / detail
// ---------------------------------------------------------------------------
const batchCursor = z.object({ detectedAt: z.string(), id: z.string() });

export async function listBatches(
  db: Db,
  query: { limit: number; cursor?: string; sourceKey?: string },
): Promise<Page<SourceBatch & { sourceKey: string; sourceName: string }>> {
  const cursor = decodeCursor(query.cursor, batchCursor);
  const conditions = [];
  if (query.sourceKey) conditions.push(eq(sources.key, query.sourceKey));
  if (cursor) conditions.push(lt(sourceBatches.detectedAt, new Date(cursor.detectedAt)));
  const rows = await db
    .select({ batch: sourceBatches, sourceKey: sources.key, sourceName: sources.name })
    .from(sourceBatches)
    .innerJoin(sources, eq(sources.id, sourceBatches.sourceId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(sourceBatches.detectedAt), desc(sourceBatches.id))
    .limit(query.limit + 1);
  const items = rows
    .slice(0, query.limit)
    .map((r) => ({ ...r.batch, sourceKey: r.sourceKey, sourceName: r.sourceName }));
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ detectedAt: last.detectedAt.toISOString(), id: last.id })
        : null,
  };
}

export interface BatchFunnel {
  total: number;
  newDomains: number;
  previouslySeen: number;
  invalidLines: number;
  queued: number;
  running: number;
  analyzed: number;
  failed: number;
  rejectedLocally: number;
  quarantined: number;
  needsReview: number;
  gatePassed: number;
  paidAnalyzed: number;
  /** Domains of this batch for which a paid traffic lookup was actually made. */
  trafficLookedUp: number;
  /** Domains of this batch for which a paid authority lookup was actually made. */
  authorityLookedUp: number;
  highPotential: number;
  shortlisted: number;
}

export async function getBatchDetail(db: Db, batchId: string) {
  const row = await db
    .select({ batch: sourceBatches, sourceKey: sources.key, sourceName: sources.name })
    .from(sourceBatches)
    .innerJoin(sources, eq(sources.id, sourceBatches.sourceId))
    .where(eq(sourceBatches.id, batchId))
    .limit(1);
  const found = row[0];
  if (!found) throw new AppError("NOT_FOUND", "Batch not found.");
  const batch = found.batch;

  const [runCounts] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${analysisRuns.status} = 'queued')::int`,
      running: sql<number>`count(*) filter (where ${analysisRuns.status} = 'running')::int`,
      analyzed: sql<number>`count(*) filter (where ${analysisRuns.status} in ('completed','partial'))::int`,
      failed: sql<number>`count(*) filter (where ${analysisRuns.status} = 'failed')::int`,
      gatePassed: sql<number>`count(*) filter (where (${analysisRuns.summaryJson}->>'candidateGatePassed')::boolean = true)::int`,
    })
    .from(analysisRuns)
    .where(eq(analysisRuns.sourceBatchId, batchId));

  const [paid] = await db
    .select({ n: sql<number>`count(distinct ${analysisRuns.domainId})::int` })
    .from(analysisSteps)
    .innerJoin(analysisRuns, eq(analysisRuns.id, analysisSteps.analysisRunId))
    .where(
      and(
        eq(analysisRuns.sourceBatchId, batchId),
        eq(analysisSteps.stepKey, "seo"),
        eq(analysisSteps.status, "completed"),
        sql`${analysisSteps.metadataJson}->>'outcome' = 'measured'`,
      ),
    );

  const measuredInBatch = (stepKey: "traffic" | "authority") =>
    db
      .select({ n: sql<number>`count(distinct ${analysisRuns.domainId})::int` })
      .from(analysisSteps)
      .innerJoin(analysisRuns, eq(analysisRuns.id, analysisSteps.analysisRunId))
      .where(
        and(
          eq(analysisRuns.sourceBatchId, batchId),
          eq(analysisSteps.stepKey, stepKey),
          eq(analysisSteps.status, "completed"),
          sql`${analysisSteps.metadataJson}->>'outcome' = 'measured'`,
        ),
      );
  const [traffic] = await measuredInBatch("traffic");
  const [authority] = await measuredInBatch("authority");

  const [summaryCounts] = await db
    .select({
      rejected: sql<number>`count(*) filter (where ${domainSummaries.disposition} = 'rejected')::int`,
      quarantined: sql<number>`count(*) filter (where ${domainSummaries.disposition} = 'quarantined')::int`,
      needsReview: sql<number>`count(*) filter (where ${domainSummaries.disposition} = 'needs_review')::int`,
      highPotential: sql<number>`count(*) filter (where ${domainSummaries.overallScore} >= 70)::int`,
      shortlisted: sql<number>`count(*) filter (where ${domainSummaries.shortlistCount} > 0)::int`,
    })
    .from(sourceBatchDomains)
    .innerJoin(domainSummaries, eq(domainSummaries.domainId, sourceBatchDomains.domainId))
    .where(eq(sourceBatchDomains.sourceBatchId, batchId));

  const funnel: BatchFunnel = {
    total: batch.domainCount,
    newDomains: batch.newDomainCount,
    previouslySeen: batch.domainCount - batch.newDomainCount,
    invalidLines: batch.invalidLineCount,
    queued: runCounts?.queued ?? 0,
    running: runCounts?.running ?? 0,
    analyzed: runCounts?.analyzed ?? 0,
    failed: runCounts?.failed ?? 0,
    rejectedLocally: summaryCounts?.rejected ?? 0,
    quarantined: summaryCounts?.quarantined ?? 0,
    needsReview: summaryCounts?.needsReview ?? 0,
    gatePassed: runCounts?.gatePassed ?? 0,
    paidAnalyzed: paid?.n ?? 0,
    trafficLookedUp: traffic?.n ?? 0,
    authorityLookedUp: authority?.n ?? 0,
    highPotential: summaryCounts?.highPotential ?? 0,
    shortlisted: summaryCounts?.shortlisted ?? 0,
  };
  return { batch: { ...batch, sourceKey: found.sourceKey, sourceName: found.sourceName }, funnel };
}

export async function latestBatchForSource(
  db: Db,
  sourceKey: string,
): Promise<SourceBatch | undefined> {
  const source = await db.query.sources.findFirst({ where: eq(sources.key, sourceKey) });
  if (!source) return undefined;
  return db.query.sourceBatches.findFirst({
    where: eq(sourceBatches.sourceId, source.id),
    orderBy: desc(sourceBatches.detectedAt),
  });
}

/** Analyze (or re-analyze) every domain of a batch. */
export async function analyzeBatch(
  ctx: CoreContext,
  batchId: string,
  input: { onlyNew: boolean; forceRefresh: boolean; requestedBy: string | null },
): Promise<{ runsCreated: number }> {
  const batch = await ctx.db.query.sourceBatches.findFirst({
    where: eq(sourceBatches.id, batchId),
  });
  if (!batch) throw new AppError("NOT_FOUND", "Batch not found.");
  const rows = await ctx.db
    .select({ domainId: sourceBatchDomains.domainId })
    .from(sourceBatchDomains)
    .where(
      input.onlyNew
        ? and(eq(sourceBatchDomains.sourceBatchId, batchId), eq(sourceBatchDomains.isNew, true))
        : eq(sourceBatchDomains.sourceBatchId, batchId),
    );
  const runs = await createAnalysisRunsBulk(
    ctx.db,
    rows.map((r) => r.domainId),
    {
      triggerType: "reanalysis",
      triggerReference: batchId,
      sourceBatchId: batchId,
      requestedBy: input.requestedBy,
      forceRefresh: input.forceRefresh,
      priority: 200,
    },
  );
  await enqueueRunsBulk(ctx, runs);
  await ctx.db
    .update(sourceBatches)
    .set({ status: "analyzing" })
    .where(eq(sourceBatches.id, batchId));
  return { runsCreated: runs.length };
}
