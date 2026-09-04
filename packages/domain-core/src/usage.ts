import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { PROVIDER_KEYS } from "@dominio-x/contracts";
import {
  analysisRuns,
  analysisSteps,
  providerRequests,
  providers,
  type Db,
  type DbOrTx,
} from "@dominio-x/database";
import type { DataForSeoConfig, SemrushConfig } from "@dominio-x/config";
import { getTrafficGateSettings } from "./settings.js";
import { lowestBudget, type TrafficGateCounters } from "./traffic-gate.js";

export function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function startOfDayUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** USD billed by a provider since the start of the current UTC month. */
export async function monthlyCostUsd(
  db: DbOrTx,
  providerKey: string,
  now = new Date(),
): Promise<number> {
  const [row] = await db
    .select({ cost: sql<number>`coalesce(sum(${providerRequests.estimatedCostUsd}), 0)::float` })
    .from(providerRequests)
    .where(
      and(
        eq(providerRequests.providerKey, providerKey),
        gte(providerRequests.startedAt, startOfMonthUtc(now)),
      ),
    );
  return row?.cost ?? 0;
}

/**
 * Billed-call counters used by the traffic gate. Only requests that did not fail are counted:
 * the provider does not charge for a failed task, so a failure must not eat the budget.
 */
export async function providerCallCounters(
  db: DbOrTx,
  providerKey: string,
  options: { sourceBatchId?: string | null; now?: Date } = {},
): Promise<TrafficGateCounters> {
  const now = options.now ?? new Date();
  const billed = and(
    eq(providerRequests.providerKey, providerKey),
    isNull(providerRequests.errorCode),
  );
  const [totals] = await db
    .select({
      today: sql<number>`count(*) filter (where ${providerRequests.startedAt} >= ${startOfDayUtc(now)})::int`,
      month: sql<number>`count(*) filter (where ${providerRequests.startedAt} >= ${startOfMonthUtc(now)})::int`,
      costMonth: sql<number>`coalesce(sum(${providerRequests.estimatedCostUsd}) filter (where ${providerRequests.startedAt} >= ${startOfMonthUtc(now)}), 0)::float`,
    })
    .from(providerRequests)
    .where(billed);

  let lookupsInBatch: number | null = null;
  if (options.sourceBatchId) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(providerRequests)
      .innerJoin(analysisRuns, eq(analysisRuns.id, providerRequests.analysisRunId))
      .where(and(billed, eq(analysisRuns.sourceBatchId, options.sourceBatchId)));
    lookupsInBatch = row?.n ?? 0;
  }
  return {
    lookupsToday: totals?.today ?? 0,
    lookupsThisMonth: totals?.month ?? 0,
    lookupsInBatch,
    costThisMonthUsd: totals?.costMonth ?? 0,
  };
}

export async function monthlyUnitsUsed(
  db: DbOrTx,
  providerKey: string,
  now = new Date(),
): Promise<number> {
  const [row] = await db
    .select({ units: sql<number>`coalesce(sum(${providerRequests.unitsUsed}), 0)::float` })
    .from(providerRequests)
    .where(
      and(
        eq(providerRequests.providerKey, providerKey),
        gte(providerRequests.startedAt, startOfMonthUtc(now)),
      ),
    );
  return row?.units ?? 0;
}

export interface UsageReport {
  days: number;
  byProviderDay: {
    providerKey: string;
    day: string;
    requests: number;
    units: number;
    costUsd: number;
    errors: number;
    cached: number;
  }[];
  totals: {
    providerKey: string;
    requests: number;
    units: number;
    costUsd: number;
    errors: number;
    cached: number;
    lastSuccessAt: string | null;
    failureRate: number;
  }[];
  semrush: {
    unitsThisMonth: number;
    monthlyBudget: number | null;
    utilization: number | null;
    costThisMonthUsd: number;
  };
  dataforseo: {
    state: string;
    lookupsToday: number;
    lookupsThisMonth: number;
    costThisMonthUsd: number;
    monthlyCostBudgetUsd: number | null;
    utilization: number | null;
    /** Size of the traffic window in whole months, and the audience location it describes. */
    windowMonths: number;
    locationName: string;
  };
  cache: { reusedObservations: number; providerCalls: number; hitRate: number | null };
  paidSkipped: {
    byCandidateGate: number;
    byBudget: number;
    decisionPending: number;
    notConfigured: number;
  };
  /** Traffic lookups the free gate refused, grouped by the check that blocked them. */
  trafficSkipped: { blockedBy: string; count: number }[];
}

export async function usageReport(
  db: Db,
  config: { semrush: SemrushConfig; dataforseo: DataForSeoConfig; trafficState?: string },
  options: { days: number; now?: Date },
): Promise<UsageReport> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - options.days * 24 * 3600 * 1000);

  const byProviderDay = await db
    .select({
      providerKey: providerRequests.providerKey,
      day: sql<string>`to_char(date_trunc('day', ${providerRequests.startedAt}), 'YYYY-MM-DD')`,
      requests: sql<number>`coalesce(sum(${providerRequests.requestCount}), 0)::int`,
      units: sql<number>`coalesce(sum(${providerRequests.unitsUsed}), 0)::float`,
      costUsd: sql<number>`coalesce(sum(${providerRequests.estimatedCostUsd}), 0)::float`,
      errors: sql<number>`count(*) filter (where ${providerRequests.errorCode} is not null)::int`,
      cached: sql<number>`count(*) filter (where ${providerRequests.cached})::int`,
    })
    .from(providerRequests)
    .where(gte(providerRequests.startedAt, since))
    .groupBy(providerRequests.providerKey, sql`date_trunc('day', ${providerRequests.startedAt})`)
    .orderBy(sql`date_trunc('day', ${providerRequests.startedAt})`);

  const totalsRows = await db
    .select({
      providerKey: providerRequests.providerKey,
      requests: sql<number>`coalesce(sum(${providerRequests.requestCount}), 0)::int`,
      units: sql<number>`coalesce(sum(${providerRequests.unitsUsed}), 0)::float`,
      costUsd: sql<number>`coalesce(sum(${providerRequests.estimatedCostUsd}), 0)::float`,
      errors: sql<number>`count(*) filter (where ${providerRequests.errorCode} is not null)::int`,
      cached: sql<number>`count(*) filter (where ${providerRequests.cached})::int`,
      total: sql<number>`count(*)::int`,
      lastSuccessAt: sql<
        string | null
      >`max(${providerRequests.startedAt}) filter (where ${providerRequests.errorCode} is null)`,
    })
    .from(providerRequests)
    .where(gte(providerRequests.startedAt, since))
    .groupBy(providerRequests.providerKey);

  const semrushRow = await db.query.providers.findFirst({ where: eq(providers.key, "semrush") });
  const unitsThisMonth = await monthlyUnitsUsed(db, "semrush", now);
  const [costRow] = await db
    .select({ cost: sql<number>`coalesce(sum(${providerRequests.estimatedCostUsd}), 0)::float` })
    .from(providerRequests)
    .where(
      and(
        eq(providerRequests.providerKey, "semrush"),
        gte(providerRequests.startedAt, startOfMonthUtc(now)),
      ),
    );
  const monthlyBudget =
    semrushRow?.monthlyUnitBudget ?? config.semrush.SEMRUSH_MONTHLY_UNIT_BUDGET ?? null;

  const trafficGate = await getTrafficGateSettings(db);
  const counters = await providerCallCounters(db, PROVIDER_KEYS.DATAFORSEO, { now });
  const trafficBudget = lowestBudget(
    trafficGate.monthlyCostBudgetUsd,
    config.dataforseo.DATAFORSEO_MONTHLY_COST_BUDGET_USD ?? null,
  );
  const trafficSkipped = await db
    .select({
      blockedBy: sql<string>`coalesce(${analysisSteps.metadataJson}->>'blockedBy', 'unknown')`,
      count: sql<number>`count(*)::int`,
    })
    .from(analysisSteps)
    .where(
      and(
        eq(analysisSteps.stepKey, "traffic"),
        eq(analysisSteps.status, "skipped"),
        gte(analysisSteps.startedAt, since),
      ),
    )
    .groupBy(sql`coalesce(${analysisSteps.metadataJson}->>'blockedBy', 'unknown')`)
    .orderBy(sql`count(*) desc`);

  const [stepStats] = await db
    .select({
      reused: sql<number>`count(*) filter (where ${analysisSteps.metadataJson}->>'outcome' = 'reused')::int`,
      measured: sql<number>`count(*) filter (where ${analysisSteps.metadataJson}->>'outcome' = 'measured' and ${analysisSteps.providerKey} is not null)::int`,
      gate: sql<number>`count(*) filter (where ${analysisSteps.stepKey} = 'seo' and ${analysisSteps.status} = 'skipped' and ${analysisSteps.metadataJson}->>'reason' like '%gate%')::int`,
      budget: sql<number>`count(*) filter (where ${analysisSteps.stepKey} = 'seo' and ${analysisSteps.metadataJson}->>'outcome' = 'budget_exhausted')::int`,
      pending: sql<number>`count(*) filter (where ${analysisSteps.stepKey} = 'seo' and ${analysisSteps.metadataJson}->>'outcome' = 'decision_pending')::int`,
      notConfigured: sql<number>`count(*) filter (where ${analysisSteps.stepKey} = 'seo' and ${analysisSteps.metadataJson}->>'outcome' = 'not_configured')::int`,
    })
    .from(analysisSteps)
    .where(gte(analysisSteps.startedAt, since));

  const reused = stepStats?.reused ?? 0;
  const measured = stepStats?.measured ?? 0;
  return {
    days: options.days,
    byProviderDay,
    totals: totalsRows.map((r) => ({
      providerKey: r.providerKey,
      requests: r.requests,
      units: r.units,
      costUsd: r.costUsd,
      errors: r.errors,
      cached: r.cached,
      lastSuccessAt: r.lastSuccessAt ? new Date(r.lastSuccessAt).toISOString() : null,
      failureRate: r.total > 0 ? r.errors / r.total : 0,
    })),
    semrush: {
      unitsThisMonth,
      monthlyBudget,
      utilization: monthlyBudget ? unitsThisMonth / monthlyBudget : null,
      costThisMonthUsd: costRow?.cost ?? 0,
    },
    dataforseo: {
      state: config.trafficState ?? "unknown",
      lookupsToday: counters.lookupsToday,
      lookupsThisMonth: counters.lookupsThisMonth,
      costThisMonthUsd: counters.costThisMonthUsd,
      monthlyCostBudgetUsd: trafficBudget,
      utilization: trafficBudget ? counters.costThisMonthUsd / trafficBudget : null,
      windowMonths: config.dataforseo.DATAFORSEO_WINDOW_MONTHS,
      locationName: config.dataforseo.DATAFORSEO_LOCATION_NAME,
    },
    cache: {
      reusedObservations: reused,
      providerCalls: measured,
      hitRate: reused + measured > 0 ? reused / (reused + measured) : null,
    },
    paidSkipped: {
      byCandidateGate: stepStats?.gate ?? 0,
      byBudget: stepStats?.budget ?? 0,
      decisionPending: stepStats?.pending ?? 0,
      notConfigured: stepStats?.notConfigured ?? 0,
    },
    trafficSkipped,
  };
}

export async function recentProviderRequestsForDomain(db: Db, domainId: string, limit = 50) {
  return db
    .select()
    .from(providerRequests)
    .where(eq(providerRequests.domainId, domainId))
    .orderBy(desc(providerRequests.startedAt))
    .limit(limit);
}
