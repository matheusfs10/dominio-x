import { and, inArray, isNull, lt, sql } from "drizzle-orm";
import { crawlerJobs, domainObservations, operationalEvents, type Db } from "@dominio-x/database";
import { deleteExpiredSessions } from "./auth.js";

export interface RetentionReport {
  purgedRestrictedObservations: number;
  deletedSessions: number;
  deletedOperationalEvents: number;
  deletedCrawlerJobs: number;
}

/**
 * Retention routine (safe to run repeatedly):
 * - provider-restricted observation VALUES older than the configured retention are removed,
 *   while the row (provider, metric, timestamp, state) is kept for audit;
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
    .returning({ id: domainObservations.id });
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
    deletedSessions,
    deletedOperationalEvents: events.length,
    deletedCrawlerJobs: jobs.length,
  };
}
