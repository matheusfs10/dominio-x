import { and, eq, sql } from "drizzle-orm";
import { METRICS, PROVIDER_KEYS, SOURCE_KEYS, type PipelineStage } from "@dominio-x/contracts";
import {
  domainBlacklist,
  providers,
  domainScores,
  domainSummaries,
  domainTags,
  ruleExecutions,
  scoreModels,
  sourceBatches,
  sources,
  tags,
  type AnalysisRun,
  type AnalysisStep,
  type DbOrTx,
  type Domain,
} from "@dominio-x/database";
import {
  measuredObservation,
  type EnrichmentProvider,
  type ProviderResult,
} from "@dominio-x/providers";
import { enqueueStage, UnrecoverableJobError, type StageJobData } from "@dominio-x/queue";
import { evaluateRuleset, type MetricContext, type RuleSummary } from "@dominio-x/rule-engine";
import { computeScores, parseScoreModel, type ProviderOutcome } from "@dominio-x/scoring";
import {
  completeStep,
  findStep,
  finishRun,
  getRunSteps,
  markRunRunning,
  mergeRunSummary,
  requireRun,
  startStep,
  stepAlreadyDone,
} from "./analysis.js";
import { recordOperationalEvent } from "./audit.js";
import type { CoreContext } from "./context.js";
import { createCrawlerJob, expireCrawlerJobForRun } from "./crawler-jobs.js";
import { findDomainById } from "./domains.js";
import {
  freshProviderObservations,
  latestObservations,
  latestProviderObservationAt,
  measuredBoolean,
  measuredNumeric,
  recordObservations,
  recordProviderRequests,
  toMetricContext,
} from "./observations.js";
import { getActiveCompiledRuleset } from "./rulesets.js";
import { getCandidateGateSettings, getTrafficGateSettings } from "./settings.js";
import {
  decideTrafficGate,
  evaluateTrafficBudget,
  evaluateTrafficQualification,
  type TrafficGateDecision,
} from "./traffic-gate.js";
import { monthlyUnitsUsed, providerCallCounters } from "./usage.js";

export interface JobMeta {
  attemptsMade: number;
  maxAttempts: number;
  jobId: string;
}

const NEXT: Partial<Record<PipelineStage, PipelineStage>> = {
  preflight: "dns",
  dns: "crawl",
  crawl: "candidate_gate",
  candidate_gate: "seo",
  seo: "traffic",
  traffic: "rules",
  rules: "score",
  score: "complete",
};

async function advance(
  ctx: CoreContext,
  run: Pick<AnalysisRun, "id" | "domainId" | "priority">,
  from: PipelineStage,
): Promise<void> {
  const next = NEXT[from];
  if (!next) return;
  await enqueueStage(
    ctx.queues,
    { analysisRunId: run.id, domainId: run.domainId, stage: next },
    { priority: run.priority },
  );
}

interface StageContext {
  run: AnalysisRun;
  domain: Domain;
  log: CoreContext["logger"];
}

/**
 * Entry point used by the worker for every stage job. Idempotent and retry-safe:
 * finished steps are skipped, unexpected errors are recorded and re-thrown for BullMQ retry,
 * and the run is marked failed on the final attempt.
 */
export async function processStage(
  ctx: CoreContext,
  data: StageJobData,
  meta: JobMeta,
): Promise<void> {
  const log = ctx.logger.child({
    analysisRunId: data.analysisRunId,
    domainId: data.domainId,
    stage: data.stage,
    jobId: meta.jobId,
  });
  const run = await requireRun(ctx.db, data.analysisRunId);
  if (
    run.status === "cancelled" ||
    run.status === "completed" ||
    run.status === "partial" ||
    run.status === "failed"
  ) {
    log.info({ status: run.status }, "run already finished; ignoring stage job");
    return;
  }
  const domain = await findDomainById(ctx.db, run.domainId);
  if (!domain) throw new UnrecoverableJobError("Domain no longer exists");
  await markRunRunning(ctx.db, run);
  const sc: StageContext = { run, domain, log };

  if (data.kind === "crawl_timeout") {
    const expired = await expireCrawlerJobForRun(ctx, run.id);
    if (expired) {
      log.warn("crawler job expired after wait timeout; continuing pipeline");
      await advance(ctx, run, "crawl");
    }
    return;
  }

  if (await stepAlreadyDone(ctx.db, run.id, data.stage)) {
    log.info("stage already done; re-enqueueing next stage");
    await advance(ctx, run, data.stage);
    return;
  }

  try {
    switch (data.stage) {
      case "preflight":
        await stagePreflight(ctx, sc);
        break;
      case "dns":
        await stageProvider(ctx, sc, "dns", ctx.providers.dns);
        break;
      case "crawl":
        await stageCrawl(ctx, sc, meta);
        break;
      case "candidate_gate":
        await stageCandidateGate(ctx, sc);
        break;
      case "seo":
        await stageSeo(ctx, sc);
        break;
      case "traffic":
        await stageTraffic(ctx, sc);
        break;
      case "rules":
        await stageRules(ctx, sc);
        break;
      case "score":
        await stageScore(ctx, sc);
        break;
      case "complete":
        await stageComplete(ctx, sc);
        break;
    }
  } catch (error) {
    const final =
      error instanceof UnrecoverableJobError || meta.attemptsMade + 1 >= meta.maxAttempts;
    log.error({ err: error, final }, "stage failed");
    const step = await findStep(ctx.db, run.id, data.stage);
    if (step && step.status === "running")
      await completeStep(ctx.db, step, {
        status: "failed",
        errorCode: "STAGE_ERROR",
        metadata: { message: error instanceof Error ? error.message.slice(0, 300) : "unknown" },
      });
    if (final) {
      await finishRun(ctx.db, run, "failed", {
        errorCode: `STAGE_${data.stage.toUpperCase()}_FAILED`,
        error,
      });
      await recordOperationalEvent(ctx.db, {
        component: "worker",
        code: "RUN_FAILED",
        message: error instanceof Error ? error.message : "unknown",
        context: { analysisRunId: run.id, stage: data.stage },
      });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Stage A — preflight (lexical + blacklist)
// ---------------------------------------------------------------------------
async function stagePreflight(ctx: CoreContext, sc: StageContext): Promise<void> {
  const { run, domain } = sc;
  const step = await startStep(ctx.db, run.id, "preflight", PROVIDER_KEYS.LEXICAL, 1);
  const result = await ctx.providers.lexical.enrich({
    domain: providerDomain(domain),
    analysisRunId: run.id,
  });
  const blacklisted = await isBlacklisted(ctx.db, domain.asciiFqdn);
  await ctx.db.transaction(async (tx) => {
    await recordObservations(
      tx,
      { domainId: domain.id, analysisRunId: run.id, providerKey: PROVIDER_KEYS.LEXICAL },
      result.observations,
    );
    await recordObservations(
      tx,
      { domainId: domain.id, analysisRunId: run.id, providerKey: "internal" },
      [
        measuredObservation("internal.blacklisted", blacklisted !== null, {
          licenseClass: "internal",
          ttlHours: 24,
          metadata: blacklisted ? { pattern: blacklisted } : {},
        }),
      ],
    );
    const digits = result.observations.find((o) => o.metricKey === METRICS.LEXICAL_DIGIT_COUNT)
      ?.value as number;
    const hyphens = result.observations.find((o) => o.metricKey === METRICS.LEXICAL_HYPHEN_COUNT)
      ?.value as number;
    const length = result.observations.find((o) => o.metricKey === METRICS.LEXICAL_FQDN_LENGTH)
      ?.value as number;
    await tx
      .update(domainSummaries)
      .set({ digitCount: digits, hyphenCount: hyphens, fqdnLength: length, updatedAt: new Date() })
      .where(eq(domainSummaries.domainId, domain.id));
    await completeStep(tx, step, {
      status: "completed",
      metadata: {
        outcome: "measured",
        observations: result.observations.length,
        blacklisted: blacklisted !== null,
      },
    });
  });
  await advance(ctx, run, "preflight");
}

async function isBlacklisted(db: DbOrTx, asciiFqdn: string): Promise<string | null> {
  const rows = await db.select({ pattern: domainBlacklist.pattern }).from(domainBlacklist);
  for (const { pattern } of rows) {
    if (pattern.startsWith(".") && (asciiFqdn.endsWith(pattern) || asciiFqdn === pattern.slice(1)))
      return pattern;
    if (
      pattern.startsWith("*") &&
      pattern.endsWith("*") &&
      pattern.length > 2 &&
      asciiFqdn.includes(pattern.slice(1, -1))
    )
      return pattern;
    if (pattern === asciiFqdn) return pattern;
  }
  return null;
}

export function providerDomain(domain: Domain) {
  return {
    id: domain.id,
    asciiFqdn: domain.asciiFqdn,
    unicodeFqdn: domain.unicodeFqdn,
    registrableDomain: domain.registrableDomain,
    sld: domain.sld,
    tld: domain.tld,
    isIdn: domain.asciiFqdn.includes("xn--"),
  };
}

// ---------------------------------------------------------------------------
// Generic provider stage with TTL reuse (used by DNS)
// ---------------------------------------------------------------------------
async function stageProvider(
  ctx: CoreContext,
  sc: StageContext,
  stage: PipelineStage,
  provider: EnrichmentProvider,
): Promise<void> {
  const { run, domain } = sc;
  const step = await startStep(ctx.db, run.id, stage, provider.key, 1);
  if (!run.forceRefresh) {
    const fresh = await freshProviderObservations(ctx.db, domain.id, provider.key);
    if (fresh) {
      await completeStep(ctx.db, step, {
        status: "completed",
        metadata: {
          outcome: "reused",
          observations: fresh.length,
          reusedFrom: fresh[0]?.analysisRunId ?? null,
        },
      });
      await syncSummaryFromProvider(ctx.db, domain.id, provider.key, toMetricContext(fresh));
      await advance(ctx, run, stage);
      return;
    }
  }
  const result = await provider.enrich({
    domain: providerDomain(domain),
    analysisRunId: run.id,
    force: run.forceRefresh,
  });
  await persistProviderResult(ctx, sc, step, result);
  await advance(ctx, run, stage);
}

async function persistProviderResult(
  ctx: CoreContext,
  sc: StageContext,
  step: AnalysisStep,
  result: ProviderResult,
): Promise<void> {
  const { run, domain } = sc;
  await ctx.db.transaction(async (tx) => {
    if (result.status !== "skipped") {
      await recordObservations(
        tx,
        { domainId: domain.id, analysisRunId: run.id, providerKey: result.providerKey },
        result.observations,
      );
    }
    await recordProviderRequests(
      tx,
      { providerKey: result.providerKey, analysisRunId: run.id, domainId: domain.id },
      result.requests,
    );
    const outcome =
      result.status === "ok" || result.status === "partial"
        ? "measured"
        : result.status === "skipped"
          ? "skipped"
          : "failed";
    await completeStep(tx, step, {
      status:
        result.status === "error"
          ? "failed"
          : result.status === "skipped"
            ? "skipped"
            : "completed",
      errorCode: result.errorCode ?? null,
      metadata: {
        outcome,
        reason: result.message ?? result.errorCode ?? null,
        observations: result.observations.length,
        durationMs: result.durationMs,
      },
    });
    if (result.status !== "skipped") {
      const ctxMetrics: MetricContext = {};
      for (const o of result.observations)
        ctxMetrics[o.metricKey] = {
          state: o.state,
          value: o.value as MetricContext[string]["value"],
        };
      await syncSummaryFromProvider(tx, domain.id, result.providerKey, ctxMetrics);
    }
  });
}

async function syncSummaryFromProvider(
  db: DbOrTx,
  domainId: string,
  providerKey: string,
  metrics: MetricContext,
): Promise<void> {
  if (providerKey === PROVIDER_KEYS.DNS) {
    const resolves = measuredBoolean(metrics, METRICS.DNS_RESOLVES);
    await db
      .update(domainSummaries)
      .set({ dnsResolves: resolves, updatedAt: new Date() })
      .where(eq(domainSummaries.domainId, domainId));
  } else if (providerKey === PROVIDER_KEYS.CRAWLER) {
    await db
      .update(domainSummaries)
      .set({ httpStatus: measuredNumeric(metrics, METRICS.HTTP_STATUS), updatedAt: new Date() })
      .where(eq(domainSummaries.domainId, domainId));
  } else if (providerKey === PROVIDER_KEYS.DATAFORSEO) {
    await db
      .update(domainSummaries)
      .set({
        trafficVisitsTotal: measuredNumeric(metrics, METRICS.TRAFFIC_VISITS_TOTAL),
        trafficVisitsLastMonth: measuredNumeric(metrics, METRICS.TRAFFIC_VISITS_LAST_MONTH),
        trafficTrendRatio: measuredNumeric(metrics, METRICS.TRAFFIC_TREND_RATIO),
        hasTrafficData: measuredBoolean(metrics, METRICS.TRAFFIC_HAS_DATA),
        updatedAt: new Date(),
      })
      .where(eq(domainSummaries.domainId, domainId));
  } else if (providerKey === PROVIDER_KEYS.SEMRUSH) {
    const has =
      measuredNumeric(metrics, METRICS.SEO_ORGANIC_KEYWORDS) !== null ||
      measuredNumeric(metrics, METRICS.SEO_AUTHORITY) !== null;
    await db
      .update(domainSummaries)
      .set({ hasSeoData: has, updatedAt: new Date() })
      .where(eq(domainSummaries.domainId, domainId));
  }
}

// ---------------------------------------------------------------------------
// Stage C — crawl (delegated to the isolated crawler project)
// ---------------------------------------------------------------------------
async function stageCrawl(ctx: CoreContext, sc: StageContext, _meta: JobMeta): Promise<void> {
  const { run, domain, log } = sc;
  const existing = await findStep(ctx.db, run.id, "crawl");
  if (existing && existing.status === "running") {
    log.info("crawl step already waiting for the crawler");
    return;
  }
  const step = await startStep(ctx.db, run.id, "crawl", PROVIDER_KEYS.CRAWLER, 1);
  if (!ctx.pipeline.CRAWLER_ENABLED) {
    await completeStep(ctx.db, step, {
      status: "skipped",
      metadata: { outcome: "skipped", reason: "crawler disabled (CRAWLER_ENABLED=false)" },
    });
    await advance(ctx, run, "crawl");
    return;
  }
  if (!run.forceRefresh) {
    const fresh = await freshProviderObservations(ctx.db, domain.id, PROVIDER_KEYS.CRAWLER);
    if (fresh) {
      await completeStep(ctx.db, step, {
        status: "completed",
        metadata: {
          outcome: "reused",
          observations: fresh.length,
          reusedFrom: fresh[0]?.analysisRunId ?? null,
        },
      });
      await syncSummaryFromProvider(
        ctx.db,
        domain.id,
        PROVIDER_KEYS.CRAWLER,
        toMetricContext(fresh),
      );
      await advance(ctx, run, "crawl");
      return;
    }
  }
  // Cheap-first: without DNS resolution the host is unreachable; do not spend crawler time unless forced.
  const metrics = toMetricContext(await latestObservations(ctx.db, domain.id));
  const resolves = measuredBoolean(metrics, METRICS.DNS_RESOLVES);
  if (resolves === false && !run.forceDeep) {
    await completeStep(ctx.db, step, {
      status: "skipped",
      metadata: { outcome: "skipped", reason: "no DNS resolution" },
    });
    await advance(ctx, run, "crawl");
    return;
  }
  const job = await createCrawlerJob(ctx.db, {
    analysisRunId: run.id,
    domainId: domain.id,
    fqdn: domain.asciiFqdn,
  });
  await ctx.db.execute(
    sql`update analysis_steps set metadata_json = metadata_json || ${JSON.stringify({ crawlerJobId: job.id, waiting: true })}::jsonb where id = ${step.id}`,
  );
  await enqueueStage(
    ctx.queues,
    { analysisRunId: run.id, domainId: domain.id, stage: "crawl", kind: "crawl_timeout" },
    { delayMs: ctx.pipeline.CRAWLER_STAGE_WAIT_TIMEOUT_MS, attempts: 1 },
  );
  log.info({ crawlerJobId: job.id }, "crawler job created; waiting for the isolated crawler");
}

// ---------------------------------------------------------------------------
// Stage D — candidate gate
// ---------------------------------------------------------------------------
async function stageCandidateGate(ctx: CoreContext, sc: StageContext): Promise<void> {
  const { run, domain } = sc;
  const step = await startStep(ctx.db, run.id, "candidate_gate", null, 1);
  const settings = await getCandidateGateSettings(ctx.db);
  const metrics = toMetricContext(await latestObservations(ctx.db, domain.id));
  const reasons: string[] = [];
  let passed: boolean;

  if (run.forceDeep) {
    passed = true;
    reasons.push("forced by analyst");
  } else if (!settings.enabled) {
    passed = true;
    reasons.push("gate disabled in settings");
  } else {
    const ruleset = await getActiveCompiledRuleset(ctx.db);
    const decision = ruleset ? evaluateRuleset(ruleset, metrics).summary : null;
    if (decision?.candidateDecision === "deny") {
      passed = false;
      reasons.push(...decision.candidateReasons);
    } else if (decision?.candidateDecision === "allow") {
      passed = true;
      reasons.push(...decision.candidateReasons);
    } else {
      const sld = measuredNumeric(metrics, METRICS.LEXICAL_SLD_LENGTH) ?? Infinity;
      const digits = measuredNumeric(metrics, METRICS.LEXICAL_DIGIT_COUNT) ?? Infinity;
      const hyphens = measuredNumeric(metrics, METRICS.LEXICAL_HYPHEN_COUNT) ?? Infinity;
      const randomness = measuredNumeric(metrics, METRICS.LEXICAL_RANDOMNESS_SCORE) ?? 1;
      const lexicalOk =
        sld <= settings.maxSldLength &&
        digits <= settings.maxDigits &&
        hyphens <= settings.maxHyphens &&
        randomness <= settings.maxRandomness;
      const evidence =
        measuredBoolean(metrics, METRICS.DNS_RESOLVES) === true ||
        measuredBoolean(metrics, METRICS.HTTP_REACHABLE) === true;
      if (!lexicalOk)
        reasons.push(
          `lexical thresholds not met (sld ${sld}, digits ${digits}, hyphens ${hyphens}, randomness ${randomness})`,
        );
      else reasons.push("lexical thresholds met");
      if (evidence) reasons.push("network evidence present");
      passed = settings.requireEvidence ? lexicalOk && evidence : lexicalOk || evidence;
      if (settings.requireEvidence && !evidence) reasons.push("network evidence required");
    }
    if (passed && run.sourceBatchId && settings.maxDeepAnalysesPerBatch !== null) {
      const [row] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(sql`analysis_runs`)
        .where(
          sql`source_batch_id = ${run.sourceBatchId} and (summary_json->>'candidateGatePassed')::boolean = true`,
        );
      if ((row?.n ?? 0) >= settings.maxDeepAnalysesPerBatch) {
        passed = false;
        reasons.push(`batch cap of ${settings.maxDeepAnalysesPerBatch} deep analyses reached`);
      }
    }
  }
  await ctx.db.transaction(async (tx) => {
    await recordObservations(
      tx,
      { domainId: domain.id, analysisRunId: run.id, providerKey: "internal" },
      [
        measuredObservation("internal.candidate_gate_passed", passed, {
          licenseClass: "internal",
          ttlHours: null,
          metadata: { reasons },
        }),
      ],
    );
    await mergeRunSummary(tx, run.id, {
      candidateGatePassed: passed,
      candidateGateReasons: reasons,
    });
    await tx
      .update(domainSummaries)
      .set({ candidateGatePassed: passed, updatedAt: new Date() })
      .where(eq(domainSummaries.domainId, domain.id));
    await completeStep(tx, step, {
      status: "completed",
      metadata: { outcome: passed ? "passed" : "denied", reasons },
    });
  });
  await advance(ctx, run, "candidate_gate");
}

// ---------------------------------------------------------------------------
// Stage E — SEO (paid provider, gated and budgeted)
// ---------------------------------------------------------------------------
async function stageSeo(ctx: CoreContext, sc: StageContext): Promise<void> {
  const { run, domain, log } = sc;
  const provider = ctx.providers.semrush;
  const step = await startStep(ctx.db, run.id, "seo", provider.key, 1);
  const runRow = await requireRun(ctx.db, run.id);
  const gatePassed =
    (runRow.summaryJson as { candidateGatePassed?: boolean }).candidateGatePassed === true;
  const skip = async (outcome: string, reason: string, errorCode?: string) => {
    await completeStep(ctx.db, step, {
      status: "skipped",
      errorCode: errorCode ?? null,
      metadata: { outcome, reason },
    });
    await advance(ctx, run, "seo");
  };

  if (!gatePassed) return skip("skipped", "candidate gate did not pass");
  if (!run.forceRefresh) {
    const fresh = await freshProviderObservations(ctx.db, domain.id, provider.key);
    if (fresh) {
      await completeStep(ctx.db, step, {
        status: "completed",
        metadata: {
          outcome: "reused",
          observations: fresh.length,
          reusedFrom: fresh[0]?.analysisRunId ?? null,
        },
      });
      await syncSummaryFromProvider(ctx.db, domain.id, provider.key, toMetricContext(fresh));
      await advance(ctx, run, "seo");
      return;
    }
  }
  const status = provider.describeStatus();
  if (!provider.isConfigured()) {
    const outcome = status.state === "decision_pending" ? "decision_pending" : "not_configured";
    return skip(
      outcome,
      status.detail ?? status.state,
      status.state === "decision_pending" ? "PROVIDER_DECISION_PENDING" : "PROVIDER_NOT_CONFIGURED",
    );
  }
  const budget = await providerBudget(ctx);
  if (budget.limit !== null) {
    const estimate = await provider.estimate({
      domain: providerDomain(domain),
      analysisRunId: run.id,
    });
    if (budget.used + estimate.units > budget.limit) {
      log.warn({ used: budget.used, limit: budget.limit }, "paid provider budget exhausted");
      return skip(
        "budget_exhausted",
        `monthly unit budget exhausted (${budget.used}/${budget.limit})`,
        "PROVIDER_BUDGET_EXHAUSTED",
      );
    }
  }
  const result = await provider.enrich({
    domain: providerDomain(domain),
    analysisRunId: run.id,
    force: run.forceRefresh,
  });
  await persistProviderResult(ctx, sc, step, result);
  await advance(ctx, run, "seo");
}

async function providerBudget(ctx: CoreContext): Promise<{ used: number; limit: number | null }> {
  const row = await ctx.db.query.providers.findFirst({
    where: eq(providers.key, PROVIDER_KEYS.SEMRUSH),
  });
  const limit = row?.monthlyUnitBudget ?? ctx.semrush.SEMRUSH_MONTHLY_UNIT_BUDGET ?? null;
  const used = await monthlyUnitsUsed(ctx.db, PROVIDER_KEYS.SEMRUSH);
  return { used, limit };
}

// ---------------------------------------------------------------------------
// Stage F — traffic (paid provider behind the free qualification gate)
// ---------------------------------------------------------------------------

/**
 * Estimated search traffic for the configured audience location (Brazil by default) over a
 * rolling window of whole months.
 *
 * Cheap-first, in this order, so that the common case costs nothing:
 *   1. fresh observations are reused (no call);
 *   2. a domain measured inside the cooldown window is not re-measured (no call);
 *   3. the free qualification gate (name shape, DNS/HTTP evidence, candidate gate) must pass;
 *   4. volume and money caps from our own ledger must pass;
 *   5. only then is one paid lookup issued, and the price the provider reports is written to
 *      the request ledger.
 * Every skip is recorded with the exact check that blocked it, so the usage dashboard can show
 * where the funnel is losing candidates.
 */
async function stageTraffic(ctx: CoreContext, sc: StageContext): Promise<void> {
  const { run, domain, log } = sc;
  const provider = ctx.providers.dataforseo;
  const step = await startStep(ctx.db, run.id, "traffic", provider.key, 1);

  /** Records why no paid call was made and moves the run on. */
  const skip = async (
    outcome: string,
    reason: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> => {
    await completeStep(ctx.db, step, {
      status: "skipped",
      errorCode: (extra.errorCode as string | undefined) ?? null,
      metadata: { outcome, reason, ...extra },
    });
    await advance(ctx, run, "traffic");
  };

  // 0. Cheapest possible exits, before touching the database for anything else. A batch of
  //    150k domains must not pay four queries each for a provider that is switched off.
  const runtimeState = provider.describeStatus().state;
  if (runtimeState !== "ready") {
    return skip(runtimeState, `provider ${runtimeState}`, {
      blockedBy: "provider_state",
      errorCode:
        runtimeState === "not_configured" ? "PROVIDER_NOT_CONFIGURED" : "PROVIDER_DISABLED",
    });
  }
  const settings = await getTrafficGateSettings(ctx.db);
  if (!settings.enabled && !run.forceDeep) {
    return skip("gate_denied", "automatic traffic lookups are disabled in settings", {
      blockedBy: "gate_enabled",
    });
  }

  // 1. Fresh data already on file — the cheapest possible outcome.
  if (!run.forceRefresh) {
    const fresh = await freshProviderObservations(ctx.db, domain.id, provider.key);
    if (fresh) {
      await completeStep(ctx.db, step, {
        status: "completed",
        metadata: {
          outcome: "reused",
          observations: fresh.length,
          reusedFrom: fresh[0]?.analysisRunId ?? null,
        },
      });
      await syncSummaryFromProvider(ctx.db, domain.id, provider.key, toMetricContext(fresh));
      await advance(ctx, run, "traffic");
      return;
    }

    // 2. Cooldown: expired data still means we asked recently. Do not pay twice for it.
    if (settings.reuseWithinDays > 0) {
      const lastAt = await latestProviderObservationAt(ctx.db, domain.id, provider.key);
      const cooldownMs = settings.reuseWithinDays * 24 * 3600 * 1000;
      if (lastAt && Date.now() - lastAt.getTime() < cooldownMs) {
        return skip(
          "cooldown",
          `measured ${lastAt.toISOString().slice(0, 10)}, cooldown ${settings.reuseWithinDays}d`,
          { blockedBy: "cooldown" },
        );
      }
    }
  }

  // 3. Free qualification gate: name shape and network evidence. Nothing but observations the
  //    pipeline already has, so a rejected domain costs no extra query.
  const runRow = await requireRun(ctx.db, run.id);
  const summary = runRow.summaryJson as { candidateGatePassed?: boolean };
  const metrics = toMetricContext(await latestObservations(ctx.db, domain.id));
  const providerState = await registryEnabledState(ctx, runtimeState);
  const qualification = evaluateTrafficQualification({
    settings,
    metrics,
    domain: { asciiFqdn: domain.asciiFqdn, tld: domain.tld },
    candidateGatePassed: summary.candidateGatePassed ?? null,
    providerState,
  });
  const qualified = decideTrafficGate(qualification, { forced: run.forceDeep });
  if (!qualified.eligible) return recordDenial(ctx, sc, skip, qualified);

  // 4. Volume and money caps. Only now is it worth aggregating the ledger.
  const counters = await providerCallCounters(ctx.db, provider.key, {
    sourceBatchId: run.sourceBatchId,
  });
  const estimate = await provider.estimate({
    domain: providerDomain(domain),
    analysisRunId: run.id,
  });
  // The balance lookup is free and cached, but only worth making when it can block a call.
  let accountBalanceUsd: number | null = null;
  if (settings.minAccountBalanceUsd > 0) {
    try {
      accountBalanceUsd = (await provider.accountBalance()).balanceUsd;
    } catch (error) {
      log.warn({ err: error }, "could not read the provider account balance");
    }
  }
  const decision = decideTrafficGate(
    [
      ...qualification,
      ...evaluateTrafficBudget({
        settings,
        counters,
        envMonthlyCostBudgetUsd: ctx.dataforseo.DATAFORSEO_MONTHLY_COST_BUDGET_USD ?? null,
        estimatedCallCostUsd: estimate.estimatedCostUsd,
        accountBalanceUsd,
      }),
    ],
    { forced: run.forceDeep },
  );
  if (!decision.eligible) return recordDenial(ctx, sc, skip, decision);
  await recordGateDecision(ctx, sc, decision);

  // 5. Spend.
  const result = await provider.enrich({
    domain: providerDomain(domain),
    analysisRunId: run.id,
    force: run.forceRefresh,
  });
  await persistProviderResult(ctx, sc, step, result);
  log.info(
    { costUsd: result.requests[0]?.estimatedCostUsd ?? 0, status: result.status },
    "traffic lookup done",
  );
  await advance(ctx, run, "traffic");
}

/**
 * An admin can also switch the provider off from the Providers page without a redeploy, which
 * costs one indexed lookup. Only asked once the runtime configuration already said "ready".
 */
async function registryEnabledState(ctx: CoreContext, runtimeState: string): Promise<string> {
  if (runtimeState !== "ready") return runtimeState;
  const row = await ctx.db.query.providers.findFirst({
    where: eq(providers.key, PROVIDER_KEYS.DATAFORSEO),
  });
  return row?.enabled === false ? "disabled_in_registry" : runtimeState;
}

/** Records the gate decision as evidence on the run and on the domain. */
async function recordGateDecision(
  ctx: CoreContext,
  sc: StageContext,
  decision: TrafficGateDecision,
): Promise<void> {
  const { run, domain } = sc;
  await ctx.db.transaction(async (tx) => {
    await recordObservations(
      tx,
      { domainId: domain.id, analysisRunId: run.id, providerKey: "internal" },
      [
        measuredObservation("internal.traffic_gate_passed", decision.eligible, {
          licenseClass: "internal",
          ttlHours: null,
          metadata: { blockedBy: decision.blockedBy, reasons: decision.reasons },
        }),
      ],
    );
    await mergeRunSummary(tx, run.id, {
      trafficGatePassed: decision.eligible,
      trafficGateBlockedBy: decision.blockedBy,
      trafficGateReasons: decision.reasons,
    });
  });
}

async function recordDenial(
  ctx: CoreContext,
  sc: StageContext,
  skip: (outcome: string, reason: string, extra?: Record<string, unknown>) => Promise<void>,
  decision: TrafficGateDecision,
): Promise<void> {
  await recordGateDecision(ctx, sc, decision);
  sc.log.info(
    { blockedBy: decision.blockedBy },
    "traffic lookup skipped by the free qualification gate",
  );
  await skip("gate_denied", decision.reasons.join("; "), {
    blockedBy: decision.blockedBy,
    checks: decision.checks,
    errorCode: decision.blockedBy === "monthly_budget" ? "PROVIDER_BUDGET_EXHAUSTED" : undefined,
  });
}

// ---------------------------------------------------------------------------
// Stage F — rules
// ---------------------------------------------------------------------------
async function stageRules(ctx: CoreContext, sc: StageContext): Promise<void> {
  const { run, domain } = sc;
  const step = await startStep(ctx.db, run.id, "rules", null, 1);
  const ruleset = await getActiveCompiledRuleset(ctx.db);
  if (!ruleset) {
    await completeStep(ctx.db, step, {
      status: "skipped",
      metadata: { outcome: "skipped", reason: "no active ruleset" },
    });
    await mergeRunSummary(ctx.db, run.id, { rules: null });
    await advance(ctx, run, "rules");
    return;
  }
  const metrics = toMetricContext(await latestObservations(ctx.db, domain.id));
  const evaluation = evaluateRuleset(ruleset, metrics);
  await ctx.db.transaction(async (tx) => {
    await tx.insert(ruleExecutions).values(
      evaluation.executions.map((e) => ({
        analysisRunId: run.id,
        domainId: domain.id,
        rulesetId: ruleset.id,
        rulesetVersion: ruleset.version,
        ruleId: e.ruleId,
        ruleKey: e.ruleKey,
        matched: e.matched,
        action: e.action?.type ?? null,
        reasonCode: e.reasonCode,
        evidenceJson: e.evidence,
      })),
    );
    for (const tagKey of evaluation.summary.tags) {
      const [tag] = await tx
        .insert(tags)
        .values({ key: tagKey, name: tagKey })
        .onConflictDoUpdate({ target: tags.key, set: { name: tagKey } })
        .returning();
      await tx
        .insert(domainTags)
        .values({ domainId: domain.id, tagId: tag!.id, source: "rule" })
        .onConflictDoNothing();
    }
    await mergeRunSummary(tx, run.id, {
      rules: evaluation.summary,
      rulesetId: ruleset.id,
      rulesetVersion: ruleset.version,
    });
    await completeStep(tx, step, {
      status: "completed",
      metadata: {
        outcome: "measured",
        rulesetVersion: ruleset.version,
        matched: evaluation.executions.filter((e) => e.matched).map((e) => e.ruleKey),
        disposition: evaluation.summary.disposition,
      },
    });
  });
  await advance(ctx, run, "rules");
}

// ---------------------------------------------------------------------------
// Stage G — score
// ---------------------------------------------------------------------------
async function stageScore(ctx: CoreContext, sc: StageContext): Promise<void> {
  const { run, domain } = sc;
  const step = await startStep(ctx.db, run.id, "score", null, 1);
  const modelRow = await ctx.db.query.scoreModels.findFirst({
    where: eq(scoreModels.status, "active"),
  });
  if (!modelRow) throw new UnrecoverableJobError("No active score model (run db:seed)");
  const model = parseScoreModel(modelRow);
  const runRow = await requireRun(ctx.db, run.id);
  const summary = runRow.summaryJson as {
    rules?: RuleSummary | null;
    candidateGatePassed?: boolean;
  };
  const steps = await getRunSteps(ctx.db, run.id);
  const providersOutcomes: ProviderOutcome[] = steps
    .filter((s) => s.providerKey && s.stepKey !== "score" && s.stepKey !== "complete")
    .map((s) => {
      const meta = s.metadataJson as { outcome?: string; reason?: string };
      const outcome: ProviderOutcome["outcome"] =
        s.status === "failed"
          ? "failed"
          : meta.outcome === "reused"
            ? "reused"
            : meta.outcome === "decision_pending"
              ? "decision_pending"
              : meta.outcome === "not_configured"
                ? "not_configured"
                : s.status === "skipped"
                  ? "skipped"
                  : "measured";
      return { providerKey: s.providerKey!, outcome, reason: meta.reason };
    });
  const skippedByGateOrBudget = (stepKey: string): boolean => {
    const step = steps.find((s) => s.stepKey === stepKey);
    if (step?.status !== "skipped") return false;
    const meta = step.metadataJson as { reason?: string; blockedBy?: string };
    return /gate|budget|cap|cooldown/.test(`${meta.reason ?? ""} ${meta.blockedBy ?? ""}`);
  };
  const deepSkipped = skippedByGateOrBudget("seo") || skippedByGateOrBudget("traffic");
  const metrics = toMetricContext(await latestObservations(ctx.db, domain.id));
  const fromReleaseList = await isFromReleaseList(ctx.db, run);
  const result = computeScores(model, {
    metrics,
    ruleSummary: summary.rules ?? null,
    providers: providersOutcomes,
    fromReleaseList,
    deepAnalysisSkipped: deepSkipped,
  });
  await ctx.db.transaction(async (tx) => {
    await tx
      .insert(domainScores)
      .values({
        domainId: domain.id,
        analysisRunId: run.id,
        scoreModelId: modelRow.id,
        scoreModelVersion: modelRow.version,
        nameScore: result.scores.name,
        brandScore: result.scores.brand,
        seoScore: result.scores.seo,
        linkScore: result.scores.link,
        historyScore: result.scores.history,
        commercialScore: result.scores.commercial,
        riskScore: result.scores.risk,
        acquisitionScore: result.scores.acquisition,
        confidenceScore: result.confidenceScore,
        overallScore: result.overallScore,
        explanationJson: result.explanation,
      })
      .onConflictDoNothing();
    await mergeRunSummary(tx, run.id, {
      scores: {
        ...result.scores,
        overall: result.overallScore,
        confidence: result.confidenceScore,
      },
      scoreModelVersion: modelRow.version,
    });
    await completeStep(tx, step, {
      status: "completed",
      metadata: {
        outcome: "measured",
        overall: result.overallScore,
        confidence: result.confidenceScore,
        modelVersion: modelRow.version,
      },
    });
  });
  await ctx.db.execute(
    sql`update analysis_runs set score_model_id = ${modelRow.id} where id = ${run.id}`,
  );
  await advance(ctx, run, "score");
}

async function isFromReleaseList(db: DbOrTx, run: AnalysisRun): Promise<boolean> {
  if (!run.sourceBatchId) return false;
  const row = await db
    .select({ key: sources.key })
    .from(sourceBatches)
    .innerJoin(sources, eq(sources.id, sourceBatches.sourceId))
    .where(eq(sourceBatches.id, run.sourceBatchId))
    .limit(1);
  return row[0]?.key === SOURCE_KEYS.REGISTRO_BR_RELEASE;
}

// ---------------------------------------------------------------------------
// Stage H — complete
// ---------------------------------------------------------------------------
async function stageComplete(ctx: CoreContext, sc: StageContext): Promise<void> {
  const { run, domain, log } = sc;
  const step = await startStep(ctx.db, run.id, "complete", null, 1);
  const steps = await getRunSteps(ctx.db, run.id);
  const preflight = steps.find((s) => s.stepKey === "preflight");
  const score = steps.find((s) => s.stepKey === "score");
  const failedProviders = steps.filter((s) => s.status === "failed" && s.providerKey);
  const status =
    !preflight || preflight.status !== "completed" || !score || score.status !== "completed"
      ? "failed"
      : failedProviders.length > 0
        ? "partial"
        : "completed";
  const runRow = await requireRun(ctx.db, run.id);
  const summary = runRow.summaryJson as {
    rules?: RuleSummary | null;
    scores?: Record<string, number | null>;
    candidateGatePassed?: boolean;
  };
  const metrics = toMetricContext(await latestObservations(ctx.db, domain.id));
  const tagRows = await ctx.db
    .select({ key: tags.key })
    .from(domainTags)
    .innerJoin(tags, eq(tags.id, domainTags.tagId))
    .where(eq(domainTags.domainId, domain.id));

  await ctx.db.transaction(async (tx) => {
    await completeStep(tx, step, {
      status: "completed",
      metadata: { outcome: status, failedProviders: failedProviders.map((s) => s.providerKey) },
    });
    await finishRun(tx, run, status, {
      summary: { ...summary, failedProviders: failedProviders.map((s) => s.providerKey) },
      errorCode: status === "failed" ? "CORE_ANALYSIS_INCOMPLETE" : undefined,
    });
    if (status !== "failed") {
      const s = summary.scores ?? {};
      await tx
        .update(domainSummaries)
        .set({
          disposition: summary.rules?.disposition ?? null,
          overallScore: s.overall ?? null,
          confidenceScore: s.confidence ?? null,
          nameScore: s.name ?? null,
          brandScore: s.brand ?? null,
          seoScore: s.seo ?? null,
          linkScore: s.link ?? null,
          historyScore: s.history ?? null,
          commercialScore: s.commercial ?? null,
          riskScore: s.risk ?? null,
          acquisitionScore: s.acquisition ?? null,
          digitCount: measuredNumeric(metrics, METRICS.LEXICAL_DIGIT_COUNT),
          hyphenCount: measuredNumeric(metrics, METRICS.LEXICAL_HYPHEN_COUNT),
          fqdnLength: measuredNumeric(metrics, METRICS.LEXICAL_FQDN_LENGTH),
          dnsResolves: measuredBoolean(metrics, METRICS.DNS_RESOLVES),
          httpStatus: measuredNumeric(metrics, METRICS.HTTP_STATUS),
          hasSeoData: measuredNumeric(metrics, METRICS.SEO_ORGANIC_KEYWORDS) !== null,
          candidateGatePassed: summary.candidateGatePassed ?? null,
          tagKeys: tagRows.map((t) => t.key),
          latestCompletedRunId: run.id,
          latestRunStatus: status,
          updatedAt: new Date(),
        })
        .where(eq(domainSummaries.domainId, domain.id));
    }
  });
  await maybeCloseBatch(ctx, run);
  log.info(
    { status, overall: summary.scores?.overall, disposition: summary.rules?.disposition },
    "analysis finished",
  );
}

async function maybeCloseBatch(ctx: CoreContext, run: AnalysisRun): Promise<void> {
  if (!run.sourceBatchId) return;
  const [row] = await ctx.db
    .select({ open: sql<number>`count(*) filter (where status in ('queued','running'))::int` })
    .from(sql`analysis_runs`)
    .where(and(sql`source_batch_id = ${run.sourceBatchId}`));
  if ((row?.open ?? 0) === 0) {
    await ctx.db
      .update(sourceBatches)
      .set({ status: "ingested" })
      .where(and(eq(sourceBatches.id, run.sourceBatchId), eq(sourceBatches.status, "analyzing")));
  }
}
