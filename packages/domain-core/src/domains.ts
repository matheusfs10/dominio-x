import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import {
  AppError,
  decodeCursor,
  encodeCursor,
  type ListDomainsQuery,
  type Page,
} from "@dominio-x/contracts";
import {
  analysisRuns,
  domainDispositions,
  domainNotes,
  domainScores,
  domainSummaries,
  domainTags,
  domains,
  shortlistDomains,
  shortlists,
  sourceBatchDomains,
  sourceBatches,
  sources,
  tags,
  type Db,
  type DbOrTx,
  type Domain,
  type DomainSummary,
} from "@dominio-x/database";
import { normalizeDomain, type NormalizedDomain } from "@dominio-x/normalization";

export interface UpsertedDomain {
  id: string;
  asciiFqdn: string;
  isNew: boolean;
}

function toRow(n: NormalizedDomain) {
  return {
    fqdn: n.asciiFqdn,
    asciiFqdn: n.asciiFqdn,
    unicodeFqdn: n.unicodeFqdn,
    sld: n.sld,
    tld: n.tld,
    registrableDomain: n.registrableDomain,
    normalizationVersion: n.normalizationVersion,
  };
}

/**
 * Bulk upsert of normalized domains. Uses the `xmax = 0` trick to tell inserts from updates
 * in a single statement. Also guarantees a domain_summaries row and records the source key.
 */
export async function upsertDomains(
  db: DbOrTx,
  list: NormalizedDomain[],
  sourceKey: string,
): Promise<UpsertedDomain[]> {
  if (list.length === 0) return [];
  const out: UpsertedDomain[] = [];
  const CHUNK = 500;
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const rows = await db
      .insert(domains)
      .values(chunk.map(toRow))
      .onConflictDoUpdate({
        target: domains.asciiFqdn,
        set: { lastSeenAt: sql`now()`, updatedAt: sql`now()` },
      })
      .returning({ id: domains.id, asciiFqdn: domains.asciiFqdn, isNew: sql<boolean>`(xmax = 0)` });
    await db
      .insert(domainSummaries)
      .values(rows.map((r) => ({ domainId: r.id, sourceKeys: [sourceKey] })))
      .onConflictDoUpdate({
        target: domainSummaries.domainId,
        set: {
          sourceKeys: sql`(select array_agg(distinct k) from unnest(array_append(${domainSummaries.sourceKeys}, ${sourceKey})) as k)`,
          updatedAt: sql`now()`,
        },
      });
    out.push(...rows);
  }
  return out;
}

export async function upsertDomain(
  db: DbOrTx,
  normalized: NormalizedDomain,
  sourceKey: string,
): Promise<UpsertedDomain> {
  const [row] = await upsertDomains(db, [normalized], sourceKey);
  return row!;
}

export async function findDomainById(db: DbOrTx, id: string): Promise<Domain | undefined> {
  return db.query.domains.findFirst({ where: eq(domains.id, id) });
}

export async function findDomainByInput(db: DbOrTx, input: string): Promise<Domain | undefined> {
  const n = normalizeDomain(input);
  if (!n.ok) return undefined;
  return db.query.domains.findFirst({ where: eq(domains.asciiFqdn, n.asciiFqdn) });
}

export function requireNormalized(input: string): NormalizedDomain {
  const n = normalizeDomain(input);
  if (!n.ok) throw new AppError("DOMAIN_INVALID", n.message, { details: { code: n.code } });
  return n;
}

// ---------------------------------------------------------------------------
// Domain explorer (server-side filtering, sorting and keyset pagination)
// ---------------------------------------------------------------------------
export interface DomainListItem {
  id: string;
  asciiFqdn: string;
  unicodeFqdn: string;
  tld: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  summary: DomainSummary | null;
}

const cursorSchema = z.object({ v: z.union([z.string(), z.number(), z.null()]), id: z.string() });

const SORT_COLUMNS = {
  first_seen_at: domains.firstSeenAt,
  last_seen_at: domains.lastSeenAt,
  ascii_fqdn: domains.asciiFqdn,
  overall_score: domainSummaries.overallScore,
  confidence_score: domainSummaries.confidenceScore,
  name_score: domainSummaries.nameScore,
  seo_score: domainSummaries.seoScore,
  risk_score: domainSummaries.riskScore,
} as const;

export async function listDomains(db: Db, query: ListDomainsQuery): Promise<Page<DomainListItem>> {
  const conditions: SQL[] = [];
  if (query.q) {
    const q = query.q.toLowerCase().trim();
    conditions.push(
      or(
        ilike(domains.asciiFqdn, `%${q.replace(/[%_]/g, "\\$&")}%`),
        ilike(domains.unicodeFqdn, `%${q.replace(/[%_]/g, "\\$&")}%`),
      )!,
    );
  }
  if (query.tld) conditions.push(eq(domains.tld, query.tld.toLowerCase()));
  if (query.sourceKey)
    conditions.push(sql`${query.sourceKey} = any(${domainSummaries.sourceKeys})`);
  if (query.batchId)
    conditions.push(
      sql`exists (select 1 from ${sourceBatchDomains} sbd where sbd.domain_id = ${domains.id} and sbd.source_batch_id = ${query.batchId})`,
    );
  if (query.minOverall !== undefined)
    conditions.push(gte(domainSummaries.overallScore, query.minOverall));
  if (query.maxOverall !== undefined)
    conditions.push(lte(domainSummaries.overallScore, query.maxOverall));
  if (query.minConfidence !== undefined)
    conditions.push(gte(domainSummaries.confidenceScore, query.minConfidence));
  if (query.minName !== undefined) conditions.push(gte(domainSummaries.nameScore, query.minName));
  if (query.minSeo !== undefined) conditions.push(gte(domainSummaries.seoScore, query.minSeo));
  if (query.maxRisk !== undefined) conditions.push(lte(domainSummaries.riskScore, query.maxRisk));
  if (query.analysisStatus)
    conditions.push(eq(domainSummaries.latestRunStatus, query.analysisStatus));
  if (query.disposition) conditions.push(eq(domainSummaries.disposition, query.disposition));
  if (query.manualDisposition)
    conditions.push(eq(domainSummaries.manualDisposition, query.manualDisposition));
  if (query.tag) conditions.push(sql`${query.tag} = any(${domainSummaries.tagKeys})`);
  if (query.maxDigits !== undefined)
    conditions.push(lte(domainSummaries.digitCount, query.maxDigits));
  if (query.maxHyphens !== undefined)
    conditions.push(lte(domainSummaries.hyphenCount, query.maxHyphens));
  if (query.maxLength !== undefined)
    conditions.push(lte(domainSummaries.fqdnLength, query.maxLength));
  if (query.hasSeo !== undefined) conditions.push(eq(domainSummaries.hasSeoData, query.hasSeo));
  if (query.hasDns !== undefined) conditions.push(eq(domainSummaries.dnsResolves, query.hasDns));
  if (query.httpStatus !== undefined)
    conditions.push(eq(domainSummaries.httpStatus, query.httpStatus));
  if (query.shortlisted !== undefined)
    conditions.push(
      query.shortlisted
        ? sql`${domainSummaries.shortlistCount} > 0`
        : sql`${domainSummaries.shortlistCount} = 0`,
    );

  const sortColumn = SORT_COLUMNS[query.sort];
  const isDesc = query.order === "desc";
  const cursor = decodeCursor(query.cursor, cursorSchema);
  if (cursor) {
    // Keyset: (sortColumn, id) tuple comparison with NULLS LAST semantics for nullable score columns.
    const cmp = isDesc ? "<" : ">";
    if (cursor.v === null) {
      conditions.push(sql`(${sortColumn} is null and ${domains.id} ${sql.raw(cmp)} ${cursor.id})`);
    } else {
      const v =
        typeof cursor.v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(cursor.v)
          ? new Date(cursor.v)
          : cursor.v;
      conditions.push(
        isDesc
          ? sql`((${sortColumn} < ${v}) or (${sortColumn} = ${v} and ${domains.id} < ${cursor.id}) or ${sortColumn} is null)`
          : sql`((${sortColumn} > ${v}) or (${sortColumn} = ${v} and ${domains.id} > ${cursor.id}))`,
      );
    }
  }

  const orderBy = isDesc
    ? [sql`${sortColumn} desc nulls last`, desc(domains.id)]
    : [sql`${sortColumn} asc nulls last`, asc(domains.id)];

  const rows = await db
    .select({ domain: domains, summary: domainSummaries })
    .from(domains)
    .leftJoin(domainSummaries, eq(domainSummaries.domainId, domains.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...orderBy)
    .limit(query.limit + 1);

  const items = rows.slice(0, query.limit).map((r) => ({
    id: r.domain.id,
    asciiFqdn: r.domain.asciiFqdn,
    unicodeFqdn: r.domain.unicodeFqdn,
    tld: r.domain.tld,
    firstSeenAt: r.domain.firstSeenAt,
    lastSeenAt: r.domain.lastSeenAt,
    summary: r.summary,
  }));
  let nextCursor: string | null = null;
  if (rows.length > query.limit) {
    const last = rows[query.limit - 1]!;
    const raw = (() => {
      switch (query.sort) {
        case "first_seen_at":
          return last.domain.firstSeenAt.toISOString();
        case "last_seen_at":
          return last.domain.lastSeenAt.toISOString();
        case "ascii_fqdn":
          return last.domain.asciiFqdn;
        case "overall_score":
          return last.summary?.overallScore ?? null;
        case "confidence_score":
          return last.summary?.confidenceScore ?? null;
        case "name_score":
          return last.summary?.nameScore ?? null;
        case "seo_score":
          return last.summary?.seoScore ?? null;
        case "risk_score":
          return last.summary?.riskScore ?? null;
      }
    })();
    nextCursor = encodeCursor({ v: raw, id: last.domain.id });
  }
  return { items, nextCursor };
}

export async function countDomains(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(domains);
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Domain detail
// ---------------------------------------------------------------------------
export async function getDomainDetail(db: Db, id: string) {
  const domain = await db.query.domains.findFirst({ where: eq(domains.id, id) });
  if (!domain) throw new AppError("NOT_FOUND", "Domain not found.");
  const [summary, latestRuns, tagRows, notes, dispositions, lists, batches] = await Promise.all([
    db.query.domainSummaries.findFirst({ where: eq(domainSummaries.domainId, id) }),
    db
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.domainId, id))
      .orderBy(desc(analysisRuns.createdAt))
      .limit(20),
    db
      .select({
        key: tags.key,
        name: tags.name,
        color: tags.color,
        source: domainTags.source,
        createdAt: domainTags.createdAt,
      })
      .from(domainTags)
      .innerJoin(tags, eq(tags.id, domainTags.tagId))
      .where(eq(domainTags.domainId, id)),
    db
      .select()
      .from(domainNotes)
      .where(eq(domainNotes.domainId, id))
      .orderBy(desc(domainNotes.createdAt))
      .limit(50),
    db
      .select()
      .from(domainDispositions)
      .where(eq(domainDispositions.domainId, id))
      .orderBy(desc(domainDispositions.createdAt))
      .limit(20),
    db
      .select({
        id: shortlists.id,
        name: shortlists.name,
        status: shortlists.status,
        note: shortlistDomains.note,
        rank: shortlistDomains.rank,
        addedAt: shortlistDomains.createdAt,
      })
      .from(shortlistDomains)
      .innerJoin(shortlists, eq(shortlists.id, shortlistDomains.shortlistId))
      .where(eq(shortlistDomains.domainId, id)),
    db
      .select({
        batchId: sourceBatches.id,
        batchName: sourceBatches.name,
        sourceKey: sources.key,
        detectedAt: sourceBatches.detectedAt,
        rawValue: sourceBatchDomains.rawValue,
        position: sourceBatchDomains.position,
        isNew: sourceBatchDomains.isNew,
      })
      .from(sourceBatchDomains)
      .innerJoin(sourceBatches, eq(sourceBatches.id, sourceBatchDomains.sourceBatchId))
      .innerJoin(sources, eq(sources.id, sourceBatches.sourceId))
      .where(eq(sourceBatchDomains.domainId, id))
      .orderBy(desc(sourceBatches.detectedAt)),
  ]);
  const latestScore = summary?.latestCompletedRunId
    ? await db.query.domainScores.findFirst({
        where: eq(domainScores.analysisRunId, summary.latestCompletedRunId),
      })
    : (
        await db
          .select()
          .from(domainScores)
          .where(eq(domainScores.domainId, id))
          .orderBy(desc(domainScores.createdAt))
          .limit(1)
      )[0];
  return {
    domain,
    summary: summary ?? null,
    latestScore: latestScore ?? null,
    runs: latestRuns,
    tags: tagRows,
    notes,
    dispositions,
    shortlists: lists,
    sourceHistory: batches,
  };
}

export async function listScoresForDomain(db: Db, domainId: string) {
  return db
    .select()
    .from(domainScores)
    .where(eq(domainScores.domainId, domainId))
    .orderBy(desc(domainScores.createdAt))
    .limit(50);
}

export async function findDomainsByIds(db: Db, ids: string[]): Promise<Domain[]> {
  if (ids.length === 0) return [];
  return db.select().from(domains).where(inArray(domains.id, ids));
}

export async function tldStats(db: Db): Promise<{ tld: string; count: number }[]> {
  return db
    .select({ tld: domains.tld, count: sql<number>`count(*)::int` })
    .from(domains)
    .groupBy(domains.tld)
    .orderBy(desc(sql`count(*)`))
    .limit(30);
}

export const hasSummaryScore = isNotNull(domainSummaries.overallScore);
