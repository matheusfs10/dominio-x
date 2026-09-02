import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../ids.js";

/** Provider registry: operational configuration (never secrets). */
export const providers = pgTable("providers", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  paid: boolean("paid").notNull().default(false),
  capabilities: text("capabilities").array().notNull(),
  rateLimitRps: real("rate_limit_rps").notNull().default(10),
  concurrencyLimit: integer("concurrency_limit").notNull().default(10),
  timeoutMs: integer("timeout_ms").notNull().default(10_000),
  defaultTtlHours: real("default_ttl_hours").notNull().default(24),
  retentionPolicy: text("retention_policy").notNull().default("internal"),
  monthlyUnitBudget: integer("monthly_unit_budget"),
  configJson: jsonb("config_json").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Ledger of every outbound provider request (cost/usage tracking). No request bodies. */
export const providerRequests = pgTable(
  "provider_requests",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    providerKey: text("provider_key").notNull(),
    analysisRunId: uuid("analysis_run_id"),
    domainId: uuid("domain_id"),
    endpointKey: text("endpoint_key").notNull(),
    requestCount: integer("request_count").notNull().default(1),
    unitsUsed: doublePrecision("units_used"),
    estimatedCostUsd: doublePrecision("estimated_cost_usd"),
    statusCode: integer("status_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    durationMs: integer("duration_ms"),
    cached: boolean("cached").notNull().default(false),
    errorCode: text("error_code"),
    metadataJson: jsonb("metadata_json").notNull().default({}),
  },
  (t) => [
    index("provider_requests_provider_started_idx").on(t.providerKey, t.startedAt),
    index("provider_requests_run_idx").on(t.analysisRunId),
    index("provider_requests_domain_idx").on(t.domainId),
  ],
);

export type ProviderRecord = typeof providers.$inferSelect;
export type ProviderRequest = typeof providerRequests.$inferSelect;
export type NewProviderRequest = typeof providerRequests.$inferInsert;
