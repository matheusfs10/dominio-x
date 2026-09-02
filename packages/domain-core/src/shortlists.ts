import { and, desc, eq, sql } from "drizzle-orm";
import { AppError, type ShortlistStatus } from "@dominio-x/contracts";
import {
  domainSummaries,
  domains,
  shortlistDomains,
  shortlists,
  type Db,
  type Shortlist,
} from "@dominio-x/database";
import { recordAudit, type AuditActor } from "./audit.js";

export async function listShortlists(db: Db): Promise<(Shortlist & { domainCount: number })[]> {
  const rows = await db
    .select({
      shortlist: shortlists,
      domainCount: sql<number>`(select count(*) from ${shortlistDomains} sd where sd.shortlist_id = ${shortlists.id})::int`,
    })
    .from(shortlists)
    .orderBy(desc(shortlists.updatedAt));
  return rows.map((r) => ({ ...r.shortlist, domainCount: r.domainCount }));
}

export async function createShortlist(
  db: Db,
  input: { name: string; description?: string },
  actor: AuditActor,
): Promise<Shortlist> {
  const [row] = await db
    .insert(shortlists)
    .values({ name: input.name, description: input.description ?? null, createdBy: actor.id })
    .returning();
  await recordAudit(db, {
    action: "shortlist.created",
    actor,
    targetType: "shortlist",
    targetId: row!.id,
  });
  return row!;
}

export async function getShortlist(db: Db, id: string) {
  const shortlist = await db.query.shortlists.findFirst({ where: eq(shortlists.id, id) });
  if (!shortlist) throw new AppError("NOT_FOUND", "Shortlist not found.");
  const rows = await db
    .select({ entry: shortlistDomains, domain: domains, summary: domainSummaries })
    .from(shortlistDomains)
    .innerJoin(domains, eq(domains.id, shortlistDomains.domainId))
    .leftJoin(domainSummaries, eq(domainSummaries.domainId, domains.id))
    .where(eq(shortlistDomains.shortlistId, id))
    .orderBy(sql`${shortlistDomains.rank} asc nulls last`, desc(shortlistDomains.createdAt));
  return {
    shortlist,
    domains: rows.map((r) => ({ ...r.entry, domain: r.domain, summary: r.summary })),
  };
}

export async function updateShortlist(
  db: Db,
  id: string,
  patch: { name?: string; description?: string | null; status?: ShortlistStatus },
  actor: AuditActor,
): Promise<Shortlist> {
  const [row] = await db
    .update(shortlists)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(shortlists.id, id))
    .returning();
  if (!row) throw new AppError("NOT_FOUND", "Shortlist not found.");
  await recordAudit(db, {
    action: "shortlist.updated",
    actor,
    targetType: "shortlist",
    targetId: id,
    details: patch,
  });
  return row;
}

async function refreshShortlistCount(db: Db, domainId: string): Promise<void> {
  await db
    .update(domainSummaries)
    .set({
      shortlistCount: sql`(select count(*) from ${shortlistDomains} sd where sd.domain_id = ${domainId})::int`,
      updatedAt: new Date(),
    })
    .where(eq(domainSummaries.domainId, domainId));
}

export async function addDomainToShortlist(
  db: Db,
  shortlistId: string,
  input: { domainId: string; note?: string; rank?: number },
  actor: AuditActor,
): Promise<void> {
  const shortlist = await db.query.shortlists.findFirst({ where: eq(shortlists.id, shortlistId) });
  if (!shortlist) throw new AppError("NOT_FOUND", "Shortlist not found.");
  if (shortlist.status !== "open") throw new AppError("CONFLICT", "Shortlist is not open.");
  const summary = await db.query.domainSummaries.findFirst({
    where: eq(domainSummaries.domainId, input.domainId),
  });
  await db
    .insert(shortlistDomains)
    .values({
      shortlistId,
      domainId: input.domainId,
      analysisRunId: summary?.latestCompletedRunId ?? null,
      note: input.note ?? null,
      rank: input.rank ?? null,
      addedBy: actor.id,
    })
    .onConflictDoUpdate({
      target: [shortlistDomains.shortlistId, shortlistDomains.domainId],
      set: { note: input.note ?? null, rank: input.rank ?? null },
    });
  await db.update(shortlists).set({ updatedAt: new Date() }).where(eq(shortlists.id, shortlistId));
  await refreshShortlistCount(db, input.domainId);
  await recordAudit(db, {
    action: "shortlist.domain_added",
    actor,
    targetType: "shortlist",
    targetId: shortlistId,
    details: { domainId: input.domainId },
  });
}

export async function removeDomainFromShortlist(
  db: Db,
  shortlistId: string,
  domainId: string,
  actor: AuditActor,
): Promise<void> {
  await db
    .delete(shortlistDomains)
    .where(
      and(eq(shortlistDomains.shortlistId, shortlistId), eq(shortlistDomains.domainId, domainId)),
    );
  await refreshShortlistCount(db, domainId);
  await recordAudit(db, {
    action: "shortlist.domain_removed",
    actor,
    targetType: "shortlist",
    targetId: shortlistId,
    details: { domainId },
  });
}

/** CSV cell escaping with formula-injection protection. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const SHORTLIST_CSV_HEADERS = [
  "domain",
  "unicode_domain",
  "tld",
  "overall_score",
  "confidence_score",
  "name_score",
  "brand_score",
  "seo_score",
  "link_score",
  "history_score",
  "commercial_score",
  "risk_score",
  "acquisition_score",
  "disposition",
  "manual_disposition",
  "dns_resolves",
  "http_status",
  "rank",
  "note",
  "added_at",
] as const;

export async function exportShortlistCsv(db: Db, id: string): Promise<string> {
  const { domains: rows } = await getShortlist(db, id);
  const lines = [SHORTLIST_CSV_HEADERS.join(",")];
  for (const r of rows) {
    const s = r.summary;
    lines.push(
      [
        r.domain.asciiFqdn,
        r.domain.unicodeFqdn,
        r.domain.tld,
        s?.overallScore,
        s?.confidenceScore,
        s?.nameScore,
        s?.brandScore,
        s?.seoScore,
        s?.linkScore,
        s?.historyScore,
        s?.commercialScore,
        s?.riskScore,
        s?.acquisitionScore,
        s?.disposition,
        s?.manualDisposition,
        s?.dnsResolves,
        s?.httpStatus,
        r.rank,
        r.note,
        r.createdAt.toISOString(),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return "FEFF" + lines.join("\r\n") + "\r\n";
}
