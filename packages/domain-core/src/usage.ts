import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  analysisSteps,
  providerRequests,
  providers,
  type Db,
  type DbOrTx,
} from "@dominio-x/database";
import type { SemrushConfig } from "@dominio-x/config";

export function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
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
  cache: { reusedObservations: number; providerCalls: number; hitRate: number | null };
  paidSkipped: {
    byCandidateGate: number;
    byBudget: number;
    decisionPending: number;
    notConfigured: number;
  };
}

export async function usageReport(
  db: Db,
  config: SemrushConfig,
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
  const monthlyBudget = semrushRow?.monthlyUnitBudget ?? config.SEMRUSH_MONTHLY_UNIT_BUDGET ?? null;

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
