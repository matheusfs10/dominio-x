import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import {
  domainObservations,
  providerRequests,
  type DbOrTx,
  type DomainObservation,
  type NewDomainObservation,
} from "@dominio-x/database";
import type { ObservationInput, ProviderRequestLog } from "@dominio-x/providers";
import type { MetricContext, MetricValue } from "@dominio-x/rule-engine";

export function toObservationRow(
  input: ObservationInput,
  ctx: { domainId: string; analysisRunId: string | null; providerKey: string; observedAt: Date },
): NewDomainObservation {
  const expiresAt =
    input.ttlHours && input.ttlHours > 0
      ? new Date(ctx.observedAt.getTime() + input.ttlHours * 3600 * 1000)
      : null;
  const row: NewDomainObservation = {
    domainId: ctx.domainId,
    analysisRunId: ctx.analysisRunId,
    providerKey: ctx.providerKey,
    metricKey: input.metricKey,
    valueType: input.valueType,
    state: input.state,
    observedAt: ctx.observedAt,
    expiresAt,
    confidenceNumeric: input.confidence ?? null,
    rawEvidenceKey: input.rawEvidenceKey ?? null,
    licenseClass: input.licenseClass,
    metadataJson: input.metadata ?? {},
  };
  if (input.state === "measured" && input.value !== undefined) {
    switch (input.valueType) {
      case "numeric":
        row.valueNumeric = typeof input.value === "number" ? input.value : Number(input.value);
        break;
      case "boolean":
        row.valueBoolean = Boolean(input.value);
        break;
      case "text":
        row.valueText = typeof input.value === "string" ? input.value : JSON.stringify(input.value);
        break;
      case "json":
        row.valueJson = input.value;
        break;
    }
  }
  return row;
}

export async function recordObservations(
  db: DbOrTx,
  ctx: { domainId: string; analysisRunId: string | null; providerKey: string; observedAt?: Date },
  inputs: ObservationInput[],
): Promise<number> {
  if (inputs.length === 0) return 0;
  const observedAt = ctx.observedAt ?? new Date();
  const rows = inputs.map((i) => toObservationRow(i, { ...ctx, observedAt }));
  await db.insert(domainObservations).values(rows);
  return rows.length;
}

export async function recordProviderRequests(
  db: DbOrTx,
  ctx: { providerKey: string; analysisRunId: string | null; domainId: string | null },
  requests: ProviderRequestLog[],
): Promise<void> {
  if (requests.length === 0) return;
  await db.insert(providerRequests).values(
    requests.map((r) => ({
      providerKey: ctx.providerKey,
      analysisRunId: ctx.analysisRunId,
      domainId: ctx.domainId,
      endpointKey: r.endpointKey,
      requestCount: r.requestCount ?? 1,
      unitsUsed: r.unitsUsed ?? null,
      estimatedCostUsd: r.estimatedCostUsd ?? null,
      statusCode: r.statusCode ?? null,
      durationMs: r.durationMs,
      cached: r.cached ?? false,
      errorCode: r.errorCode ?? null,
      metadataJson: r.metadata ?? {},
    })),
  );
}

export function observationValue(row: DomainObservation): MetricValue["value"] {
  if (row.state !== "measured") return undefined;
  switch (row.valueType) {
    case "numeric":
      return row.valueNumeric ?? undefined;
    case "boolean":
      return row.valueBoolean ?? undefined;
    case "text":
      return row.valueText ?? undefined;
    case "json":
      return (row.valueJson as MetricValue["value"]) ?? undefined;
  }
}

/**
 * Latest observation per metric for a domain. When `runId` is given, observations from that run
 * take precedence (so reanalysis sees its own measurements first) but fresh observations from
 * earlier runs are still visible, which is how TTL reuse works.
 */
export async function latestObservations(
  db: DbOrTx,
  domainId: string,
  options: { includeExpired?: boolean; now?: Date } = {},
): Promise<DomainObservation[]> {
  const now = options.now ?? new Date();
  const freshness = options.includeExpired
    ? undefined
    : or(isNull(domainObservations.expiresAt), gt(domainObservations.expiresAt, now));
  const rows = await db
    .selectDistinctOn([domainObservations.metricKey])
    .from(domainObservations)
    .where(
      and(
        eq(domainObservations.domainId, domainId),
        isNull(domainObservations.purgedAt),
        freshness,
      ),
    )
    .orderBy(domainObservations.metricKey, desc(domainObservations.observedAt));
  return rows;
}

export function toMetricContext(rows: DomainObservation[]): MetricContext {
  const ctx: MetricContext = {};
  for (const row of rows) {
    ctx[row.metricKey] = {
      state: row.state,
      value: observationValue(row),
      providerKey: row.providerKey,
      observedAt: row.observedAt.toISOString(),
    };
  }
  return ctx;
}

/** Returns fresh (unexpired, measured-or-not) observations of one provider, or null when stale/absent. */
export async function freshProviderObservations(
  db: DbOrTx,
  domainId: string,
  providerKey: string,
  now = new Date(),
): Promise<DomainObservation[] | null> {
  const rows = await db
    .selectDistinctOn([domainObservations.metricKey])
    .from(domainObservations)
    .where(
      and(
        eq(domainObservations.domainId, domainId),
        eq(domainObservations.providerKey, providerKey),
        isNull(domainObservations.purgedAt),
      ),
    )
    .orderBy(domainObservations.metricKey, desc(domainObservations.observedAt));
  if (rows.length === 0) return null;
  const fresh = rows.every(
    (r) => r.state !== "error" && (r.expiresAt === null || r.expiresAt > now),
  );
  return fresh ? rows : null;
}

export async function listObservationsForDomain(
  db: DbOrTx,
  domainId: string,
  limit = 500,
): Promise<DomainObservation[]> {
  return db
    .select()
    .from(domainObservations)
    .where(eq(domainObservations.domainId, domainId))
    .orderBy(desc(domainObservations.observedAt))
    .limit(limit);
}

export async function listObservationsForRun(
  db: DbOrTx,
  runId: string,
): Promise<DomainObservation[]> {
  return db
    .select()
    .from(domainObservations)
    .where(eq(domainObservations.analysisRunId, runId))
    .orderBy(domainObservations.metricKey);
}

export const measuredNumeric = (ctx: MetricContext, key: string): number | null => {
  const m = ctx[key];
  return m && m.state === "measured" && typeof m.value === "number" ? m.value : null;
};
export const measuredBoolean = (ctx: MetricContext, key: string): boolean | null => {
  const m = ctx[key];
  return m && m.state === "measured" && typeof m.value === "boolean" ? m.value : null;
};

export const rawSql = sql;
