import { and, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  crawlerJobs,
  domainObservations,
  domainSummaries,
  operationalEvents,
  type Db,
} from "@dominio-x/database";
import { deleteExpiredSessions } from "./auth.js";

export interface RetentionReport {
  purgedRestrictedObservations: number;
  /** Domains whose mirrored traffic values were cleared from the summary cache. */
  clearedTrafficSummaries: number;
  /** Domains whose mirrored authority values were cleared from the summary cache. */
  clearedAuthoritySummaries: number;
  deletedSessions: number;
  deletedOperationalEvents: number;
  deletedCrawlerJobs: number;
}

/**
 * Retention routine (safe to run repeatedly):
 * - provider-restricted observation VALUES older than the configured retention are removed,
 *   while the row (provider, metric, timestamp, state) is kept for audit;
 * - the paid values mirrored into `domain_summaries` (a rebuildable cache used by the explorer)
 *   are cleared for the same domains, so no provider value outlives its observation;
 * - expired sessions, old operational events and finished crawler jobs are deleted.
 */
export async function runRetention(
  db: Db,
  options: {
    restrictedRetentionDays: number;
    operationalEventDays?: number;
    crawlerJobDays?: number;
    now?: Date;
  },
): Promise<RetentionReport> {
  const now = options.now ?? new Date();
  const restrictedCutoff = new Date(
    now.getTime() - options.restrictedRetentionDays * 24 * 3600 * 1000,
  );
  const purged = await db
    .update(domainObservations)
    .set({
      valueNumeric: null,
      valueText: null,
      valueBoolean: null,
      valueJson: null,
      rawEvidenceKey: null,
      purgedAt: now,
      metadataJson: sql`${domainObservations.metadataJson} || '{"purged":"retention"}'::jsonb`,
    })
    .where(
      and(
        inArray(domainObservations.licenseClass, ["provider_restricted", "provider_contractual"]),
        lt(domainObservations.observedAt, restrictedCutoff),
        isNull(domainObservations.purgedAt),
      ),
    )
    .returning({
      id: domainObservations.id,
      domainId: domainObservations.domainId,
      metricKey: domainObservations.metricKey,
    });

  // The summary table caches a few paid values so the explorer can sort and filter on them.
  // They are provider data and must disappear with the observation they came from.
  const domainsWith = (prefix: string): string[] => [
    ...new Set(purged.filter((row) => row.metricKey.startsWith(prefix)).map((row) => row.domainId)),
  ];
  const clearInBatches = async (
    domainIds: string[],
    values: Partial<typeof domainSummaries.$inferInsert>,
  ): Promise<number> => {
    let count = 0;
    for (let i = 0; i < domainIds.length; i += 500) {
      const cleared = await db
        .update(domainSummaries)
        .set({ ...values, updatedAt: now })
        .where(inArray(domainSummaries.domainId, domainIds.slice(i, i + 500)))
        .returning({ domainId: domainSummaries.domainId });
      count += cleared.length;
    }
    return count;
  };

  const clearedTrafficSummaries = await clearInBatches(domainsWith("traffic."), {
    trafficVisitsTotal: null,
    trafficVisitsLastMonth: null,
    trafficTrendRatio: null,
    hasTrafficData: null,
  });
  const clearedAuthoritySummaries = await clearInBatches(domainsWith("authority."), {
    domainRating: null,
    referringDomains: null,
    backlinks: null,
    hasAuthorityData: null,
  });

  const deletedSessions = await deleteExpiredSessions(db);
  const eventsCutoff = new Date(
    now.getTime() - (options.operationalEventDays ?? 30) * 24 * 3600 * 1000,
  );
  const events = await db
    .delete(operationalEvents)
    .where(lt(operationalEvents.createdAt, eventsCutoff))
    .returning({ id: operationalEvents.id });
  const jobsCutoff = new Date(now.getTime() - (options.crawlerJobDays ?? 30) * 24 * 3600 * 1000);
  const jobs = await db
    .delete(crawlerJobs)
    .where(
      and(
        inArray(crawlerJobs.status, ["completed", "failed", "expired", "cancelled"]),
        lt(crawlerJobs.createdAt, jobsCutoff),
      ),
    )
    .returning({ id: crawlerJobs.id });
  return {
    purgedRestrictedObservations: purged.length,
    clearedTrafficSummaries,
    clearedAuthoritySummaries,
    deletedSessions,
    deletedOperationalEvents: events.length,
    deletedCrawlerJobs: jobs.length,
  };
}
