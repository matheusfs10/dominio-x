import { eq, gte, sql } from "drizzle-orm";
import { AppError } from "@dominio-x/contracts";
import { providerRequests, providers, type Db, type ProviderRecord } from "@dominio-x/database";
import { recordAudit, type AuditActor } from "./audit.js";
import type { CoreContext } from "./context.js";

export interface ProviderView extends ProviderRecord {
  runtime: { configured: boolean; state: string; detail?: string };
  stats: {
    requests24h: number;
    errors24h: number;
    failureRate24h: number;
    lastSuccessAt: string | null;
    units30d: number;
    costUsd30d: number;
  };
}

/** Provider registry rows merged with runtime status. Never returns credentials. */
export async function listProviders(ctx: CoreContext): Promise<ProviderView[]> {
  const rows = await ctx.db.select().from(providers).orderBy(providers.paid, providers.key);
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const stats24 = await ctx.db
    .select({
      providerKey: providerRequests.providerKey,
      requests: sql<number>`coalesce(sum(${providerRequests.requestCount}), 0)::int`,
      errors: sql<number>`count(*) filter (where ${providerRequests.errorCode} is not null)::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(providerRequests)
    .where(gte(providerRequests.startedAt, dayAgo))
    .groupBy(providerRequests.providerKey);
  const stats30 = await ctx.db
    .select({
      providerKey: providerRequests.providerKey,
      units: sql<number>`coalesce(sum(${providerRequests.unitsUsed}), 0)::float`,
      cost: sql<number>`coalesce(sum(${providerRequests.estimatedCostUsd}), 0)::float`,
      lastSuccessAt: sql<
        string | null
      >`max(${providerRequests.startedAt}) filter (where ${providerRequests.errorCode} is null)`,
    })
    .from(providerRequests)
    .where(gte(providerRequests.startedAt, monthAgo))
    .groupBy(providerRequests.providerKey);
  const s24 = new Map(stats24.map((s) => [s.providerKey, s]));
  const s30 = new Map(stats30.map((s) => [s.providerKey, s]));
  return rows.map((row) => {
    const runtime =
      ctx.providers.get(row.key)?.describeStatus() ??
      (row.key === "crawler"
        ? {
            configured: ctx.pipeline.CRAWLER_ENABLED,
            state: ctx.pipeline.CRAWLER_ENABLED ? "ready" : "disabled",
            detail: "isolated crawler project",
          }
        : { configured: false, state: "unknown" });
    const a = s24.get(row.key);
    const b = s30.get(row.key);
    const { configJson, ...rest } = row;
    return {
      ...rest,
      configJson: sanitizeConfig(configJson),
      runtime,
      stats: {
        requests24h: a?.requests ?? 0,
        errors24h: a?.errors ?? 0,
        failureRate24h: a && a.total > 0 ? a.errors / a.total : 0,
        lastSuccessAt: b?.lastSuccessAt ? new Date(b.lastSuccessAt).toISOString() : null,
        units30d: b?.units ?? 0,
        costUsd30d: b?.cost ?? 0,
      },
    };
  });
}

function sanitizeConfig(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
    if (/key|secret|token|password/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function getProvider(ctx: CoreContext, key: string): Promise<ProviderView> {
  const all = await listProviders(ctx);
  const found = all.find((p) => p.key === key);
  if (!found) throw new AppError("NOT_FOUND", "Provider not found.");
  return found;
}

export async function updateProvider(
  db: Db,
  key: string,
  patch: {
    enabled?: boolean;
    rateLimitRps?: number;
    concurrencyLimit?: number;
    timeoutMs?: number;
    defaultTtlHours?: number;
    monthlyUnitBudget?: number | null;
  },
  actor: AuditActor,
): Promise<ProviderRecord> {
  const existing = await db.query.providers.findFirst({ where: eq(providers.key, key) });
  if (!existing) throw new AppError("NOT_FOUND", "Provider not found.");
  const [updated] = await db
    .update(providers)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(providers.key, key))
    .returning();
  await recordAudit(db, {
    action: "provider.updated",
    actor,
    targetType: "provider",
    targetId: key,
    details: patch,
  });
  return updated!;
}
