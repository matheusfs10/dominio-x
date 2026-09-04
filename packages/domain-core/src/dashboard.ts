import { desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { SOURCE_KEYS } from "@dominio-x/contracts";
import { domainSummaries, domains, operationalEvents, type Db } from "@dominio-x/database";
import { getQueueCounts } from "@dominio-x/queue";
import { runStatusCounts } from "./analysis.js";
import type { CoreContext } from "./context.js";
import { crawlerQueueCounts } from "./crawler-jobs.js";
import { getBatchDetail, latestBatchForSource } from "./sources.js";
import { usageReport } from "./usage.js";

export async function dashboard(ctx: CoreContext) {
  const db: Db = ctx.db;
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const [counts] = await db
    .select({
      known: sql<number>`count(*)::int`,
      analyzed: sql<number>`count(*) filter (where ${domainSummaries.latestCompletedRunId} is not null)::int`,
      highScore: sql<number>`count(*) filter (where ${domainSummaries.overallScore} >= 70)::int`,
      shortlisted: sql<number>`count(*) filter (where ${domainSummaries.shortlistCount} > 0)::int`,
    })
    .from(domainSummaries);
  const [runsAll, runs24h, queueCounts, crawler, latestBatch, usage, errors] = await Promise.all([
    runStatusCounts(db),
    runStatusCounts(db, dayAgo),
    getQueueCounts(ctx.queues).catch(() => []),
    crawlerQueueCounts(db),
    latestBatchForSource(db, SOURCE_KEYS.REGISTRO_BR_RELEASE),
    usageReport(
      db,
      {
        semrush: ctx.semrush,
        dataforseo: ctx.dataforseo,
        ahrefs: ctx.ahrefs,
        trafficState: ctx.providers.dataforseo.describeStatus().state,
        authorityState: ctx.providers.ahrefs.describeStatus().state,
        solverState: ctx.providers.capsolver.describeStatus().state,
      },
      { days: 7 },
    ),
    db.select().from(operationalEvents).orderBy(desc(operationalEvents.createdAt)).limit(20),
  ]);
  const batchDetail = latestBatch ? await getBatchDetail(db, latestBatch.id) : null;
  const top = await db
    .select({
      id: domains.id,
      asciiFqdn: domains.asciiFqdn,
      overallScore: domainSummaries.overallScore,
      confidenceScore: domainSummaries.confidenceScore,
      disposition: domainSummaries.disposition,
      riskScore: domainSummaries.riskScore,
    })
    .from(domainSummaries)
    .innerJoin(domains, eq(domains.id, domainSummaries.domainId))
    .where(isNotNull(domainSummaries.overallScore))
    .orderBy(desc(domainSummaries.overallScore), desc(domainSummaries.confidenceScore))
    .limit(10);
  const [recentDomains] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(domains)
    .where(gte(domains.firstSeenAt, dayAgo));
  return {
    domains: {
      known: counts?.known ?? 0,
      analyzed: counts?.analyzed ?? 0,
      highScore: counts?.highScore ?? 0,
      shortlisted: counts?.shortlisted ?? 0,
      newLast24h: recentDomains?.n ?? 0,
    },
    runs: { all: runsAll, last24h: runs24h },
    queue: {
      stages: queueCounts,
      depth: queueCounts.reduce((n, q) => n + q.waiting + q.delayed + q.prioritized, 0),
      active: queueCounts.reduce((n, q) => n + q.active, 0),
      crawler,
    },
    latestBatch: batchDetail,
    topCandidates: top,
    usage: {
      totals: usage.totals,
      semrush: usage.semrush,
      cache: usage.cache,
      paidSkipped: usage.paidSkipped,
      dataforseo: usage.dataforseo,
      trafficSkipped: usage.trafficSkipped,
      ahrefs: usage.ahrefs,
      authoritySkipped: usage.authoritySkipped,
    },
    recentErrors: errors,
  };
}
