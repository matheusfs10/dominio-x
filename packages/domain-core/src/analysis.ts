import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  AppError,
  PIPELINE_VERSION,
  decodeCursor,
  encodeCursor,
  type AnalysisRunStatus,
  type AnalysisStepStatus,
  type AnalysisTriggerType,
  type Page,
  type PipelineStage,
} from "@dominio-x/contracts";
import {
  analysisRuns,
  analysisSteps,
  domainSummaries,
  type AnalysisRun,
  type AnalysisStep,
  type Db,
  type DbOrTx,
} from "@dominio-x/database";
import { sanitizeErrorMessage } from "@dominio-x/observability";
import { enqueueStage, stageJobId } from "@dominio-x/queue";
import type { CoreContext } from "./context.js";

export interface CreateRunInput {
  domainId: string;
  triggerType: AnalysisTriggerType;
  triggerReference?: string | null;
  requestedBy?: string | null;
  sourceBatchId?: string | null;
  forceDeep?: boolean;
  forceRefresh?: boolean;
  priority?: number;
}

/**
 * Creates a run unless one is already queued/running for the domain (then that run is returned).
 * Forced runs always create a new run.
 */
export async function createAnalysisRun(
  db: DbOrTx,
  input: CreateRunInput,
): Promise<{ run: AnalysisRun; created: boolean }> {
  if (!input.forceDeep && !input.forceRefresh) {
    const existing = await db.query.analysisRuns.findFirst({
      where: and(
        eq(analysisRuns.domainId, input.domainId),
        inArray(analysisRuns.status, ["queued", "running"]),
      ),
      orderBy: desc(analysisRuns.createdAt),
    });
    if (existing) return { run: existing, created: false };
  }
  const [run] = await db
    .insert(analysisRuns)
    .values({
      domainId: input.domainId,
      triggerType: input.triggerType,
      triggerReference: input.triggerReference ?? null,
      pipelineVersion: PIPELINE_VERSION,
      status: "queued",
      priority: input.priority ?? 100,
      forceDeep: input.forceDeep ?? false,
      forceRefresh: input.forceRefresh ?? false,
      requestedBy: input.requestedBy ?? null,
      sourceBatchId: input.sourceBatchId ?? null,
    })
    .returning();
  await db
    .update(domainSummaries)
    .set({
      latestRunId: run!.id,
      latestRunStatus: "queued",
      latestRunAt: run!.createdAt,
      updatedAt: new Date(),
    })
    .where(eq(domainSummaries.domainId, input.domainId));
  return { run: run!, created: true };
}

/** Bulk creation for batch analysis; skips domains that already have an active run. */
export async function createAnalysisRunsBulk(
  db: DbOrTx,
  domainIds: string[],
  input: Omit<CreateRunInput, "domainId">,
): Promise<AnalysisRun[]> {
  if (domainIds.length === 0) return [];
  const active = await db
    .select({ domainId: analysisRuns.domainId })
    .from(analysisRuns)
    .where(
      and(
        inArray(analysisRuns.domainId, domainIds),
        inArray(analysisRuns.status, ["queued", "running"]),
      ),
    );
  const skip = new Set(active.map((a) => a.domainId));
  const targets = domainIds.filter((id) => !skip.has(id));
  const created: AnalysisRun[] = [];
  const CHUNK = 500;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    const rows = await db
      .insert(analysisRuns)
      .values(
        chunk.map((domainId) => ({
          domainId,
          triggerType: input.triggerType,
          triggerReference: input.triggerReference ?? null,
          pipelineVersion: PIPELINE_VERSION,
          status: "queued" as const,
          priority: input.priority ?? 200,
          forceDeep: input.forceDeep ?? false,
          forceRefresh: input.forceRefresh ?? false,
          requestedBy: input.requestedBy ?? null,
          sourceBatchId: input.sourceBatchId ?? null,
        })),
      )
      .returning();
    created.push(...rows);
    const idList = sql.join(
      rows.map((r) => sql`${r.id}::uuid`),
      sql`, `,
    );
    await db.execute(sql`
      update ${domainSummaries} ds set latest_run_id = r.id, latest_run_status = 'queued', latest_run_at = r.created_at, updated_at = now()
      from ${analysisRuns} r where r.domain_id = ds.domain_id and r.id in (${idList})
    `);
  }
  return created;
}

export async function enqueueRun(
  ctx: CoreContext,
  run: Pick<AnalysisRun, "id" | "domainId" | "priority">,
): Promise<void> {
  await enqueueStage(
    ctx.queues,
    { analysisRunId: run.id, domainId: run.domainId, stage: "preflight" },
    { priority: run.priority },
  );
}

export async function enqueueRunsBulk(
  ctx: CoreContext,
  runs: Pick<AnalysisRun, "id" | "domainId" | "priority">[],
): Promise<number> {
  const CHUNK = 1000;
  let n = 0;
  for (let i = 0; i < runs.length; i += CHUNK) {
    const chunk = runs.slice(i, i + CHUNK);
    await ctx.queues.preflight.addBulk(
      chunk.map((r) => ({
        name: "run",
        data: {
          analysisRunId: r.id,
          domainId: r.domainId,
          stage: "preflight" as const,
          kind: "stage" as const,
        },
        opts: { jobId: stageJobId("preflight", r.id), priority: r.priority },
      })),
    );
    n += chunk.length;
  }
  return n;
}

export async function requestAnalysis(
  ctx: CoreContext,
  input: CreateRunInput,
): Promise<{ run: AnalysisRun; created: boolean }> {
  const result = await createAnalysisRun(ctx.db, input);
  if (result.created) await enqueueRun(ctx, result.run);
  return result;
}

export async function getRun(db: DbOrTx, id: string): Promise<AnalysisRun | undefined> {
  return db.query.analysisRuns.findFirst({ where: eq(analysisRuns.id, id) });
}

export async function requireRun(db: DbOrTx, id: string): Promise<AnalysisRun> {
  const run = await getRun(db, id);
  if (!run) throw new AppError("NOT_FOUND", "Analysis run not found.");
  return run;
}

export async function getRunSteps(db: DbOrTx, runId: string): Promise<AnalysisStep[]> {
  return db
    .select()
    .from(analysisSteps)
    .where(eq(analysisSteps.analysisRunId, runId))
    .orderBy(analysisSteps.startedAt);
}

export async function markRunRunning(db: DbOrTx, run: AnalysisRun): Promise<void> {
  if (run.status === "running") return;
  await db
    .update(analysisRuns)
    .set({ status: "running", startedAt: run.startedAt ?? new Date() })
    .where(eq(analysisRuns.id, run.id));
  await db
    .update(domainSummaries)
    .set({ latestRunStatus: "running", updatedAt: new Date() })
    .where(eq(domainSummaries.domainId, run.domainId));
}

export async function finishRun(
  db: DbOrTx,
  run: Pick<AnalysisRun, "id" | "domainId">,
  status: Extract<AnalysisRunStatus, "completed" | "partial" | "failed" | "cancelled">,
  extras: { errorCode?: string; error?: unknown; summary?: Record<string, unknown> } = {},
): Promise<void> {
  const now = new Date();
  await db
    .update(analysisRuns)
    .set({
      status,
      completedAt: status === "failed" ? null : now,
      failedAt: status === "failed" ? now : null,
      errorCode: extras.errorCode ?? null,
      errorMessageSanitized: extras.error ? sanitizeErrorMessage(extras.error) : null,
      ...(extras.summary ? { summaryJson: extras.summary } : {}),
    })
    .where(eq(analysisRuns.id, run.id));
  await db
    .update(domainSummaries)
    .set({
      latestRunStatus: status,
      updatedAt: now,
      ...(status === "completed" || status === "partial" ? { latestCompletedRunId: run.id } : {}),
    })
    .where(eq(domainSummaries.domainId, run.domainId));
}

export async function mergeRunSummary(
  db: DbOrTx,
  runId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db
    .update(analysisRuns)
    .set({ summaryJson: sql`${analysisRuns.summaryJson} || ${JSON.stringify(patch)}::jsonb` })
    .where(eq(analysisRuns.id, runId));
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
export async function findStep(
  db: DbOrTx,
  runId: string,
  stepKey: string,
): Promise<AnalysisStep | undefined> {
  return db.query.analysisSteps.findFirst({
    where: and(eq(analysisSteps.analysisRunId, runId), eq(analysisSteps.stepKey, stepKey)),
    orderBy: desc(analysisSteps.attempt),
  });
}

export async function startStep(
  db: DbOrTx,
  runId: string,
  stepKey: string,
  providerKey: string | null,
  attempt: number,
): Promise<AnalysisStep> {
  const [step] = await db
    .insert(analysisSteps)
    .values({
      analysisRunId: runId,
      stepKey,
      providerKey,
      status: "running",
      attempt,
      startedAt: new Date(),
    })
    .returning();
  return step!;
}

export async function completeStep(
  db: DbOrTx,
  step: Pick<AnalysisStep, "id" | "startedAt">,
  result: {
    status: Exclude<AnalysisStepStatus, "pending" | "running">;
    errorCode?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const now = new Date();
  await db
    .update(analysisSteps)
    .set({
      status: result.status,
      completedAt: now,
      durationMs: step.startedAt ? now.getTime() - step.startedAt.getTime() : null,
      errorCode: result.errorCode ?? null,
      metadataJson: result.metadata ?? {},
    })
    .where(eq(analysisSteps.id, step.id));
}

/** True when the step already finished in a previous attempt (idempotent re-processing). */
export async function stepAlreadyDone(
  db: DbOrTx,
  runId: string,
  stepKey: PipelineStage,
): Promise<boolean> {
  const step = await findStep(db, runId, stepKey);
  return Boolean(step && (step.status === "completed" || step.status === "skipped"));
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------
const runCursor = z.object({ createdAt: z.string(), id: z.string() });

export async function listRuns(
  db: Db,
  query: { limit: number; cursor?: string; status?: AnalysisRunStatus; domainId?: string },
): Promise<Page<AnalysisRun & { asciiFqdn: string }>> {
  const cursor = decodeCursor(query.cursor, runCursor);
  const conditions = [];
  if (query.status) conditions.push(eq(analysisRuns.status, query.status));
  if (query.domainId) conditions.push(eq(analysisRuns.domainId, query.domainId));
  if (cursor) conditions.push(lt(analysisRuns.createdAt, new Date(cursor.createdAt)));
  const rows = await db.query.analysisRuns.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(analysisRuns.createdAt), desc(analysisRuns.id)],
    limit: query.limit + 1,
    with: {},
  });
  const ids = rows.map((r) => r.domainId);
  const fqdns = ids.length
    ? await db.execute<{ id: string; ascii_fqdn: string }>(
        sql`select id, ascii_fqdn from domains where id in (${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )})`,
      )
    : [];
  const fqdnMap = new Map(
    (fqdns as unknown as { id: string; ascii_fqdn: string }[]).map((r) => [r.id, r.ascii_fqdn]),
  );
  const items = rows
    .slice(0, query.limit)
    .map((r) => ({ ...r, asciiFqdn: fqdnMap.get(r.domainId) ?? "" }));
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

export async function runStatusCounts(
  db: Db,
  since?: Date,
): Promise<Record<AnalysisRunStatus, number>> {
  const rows = await db
    .select({ status: analysisRuns.status, n: sql<number>`count(*)::int` })
    .from(analysisRuns)
    .where(since ? gte(analysisRuns.createdAt, since) : undefined)
    .groupBy(analysisRuns.status);
  const out: Record<AnalysisRunStatus, number> = {
    queued: 0,
    running: 0,
    completed: 0,
    partial: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** Retry: a new run (trigger=retry) referencing the failed one. Historic results are never mutated. */
export async function retryRun(
  ctx: CoreContext,
  runId: string,
  requestedBy: string | null,
): Promise<AnalysisRun> {
  const previous = await requireRun(ctx.db, runId);
  if (
    previous.status !== "failed" &&
    previous.status !== "cancelled" &&
    previous.status !== "partial"
  ) {
    throw new AppError("CONFLICT", "Only failed, partial or cancelled runs can be retried.");
  }
  const { run } = await createAnalysisRun(ctx.db, {
    domainId: previous.domainId,
    triggerType: "retry",
    triggerReference: previous.id,
    requestedBy,
    sourceBatchId: previous.sourceBatchId,
    forceDeep: previous.forceDeep,
    forceRefresh: true,
    priority: 50,
  });
  await enqueueRun(ctx, run);
  return run;
}
