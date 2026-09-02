import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ANALYSIS_RUN_STATUSES,
  ANALYSIS_STEP_STATUSES,
  ANALYSIS_TRIGGER_TYPES,
  LICENSE_CLASSES,
  OBSERVATION_STATES,
  OBSERVATION_VALUE_TYPES,
} from "@dominio-x/contracts";
import { newId } from "../ids.js";
import { domains } from "./domains.js";

export const analysisRuns = pgTable(
  "analysis_runs",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    triggerType: text("trigger_type", { enum: ANALYSIS_TRIGGER_TYPES }).notNull(),
    triggerReference: text("trigger_reference"),
    pipelineVersion: text("pipeline_version").notNull(),
    status: text("status", { enum: ANALYSIS_RUN_STATUSES }).notNull().default("queued"),
    priority: integer("priority").notNull().default(100),
    forceDeep: boolean("force_deep").notNull().default(false),
    forceRefresh: boolean("force_refresh").notNull().default(false),
    requestedBy: uuid("requested_by"),
    sourceBatchId: uuid("source_batch_id"),
    rulesetId: uuid("ruleset_id"),
    scoreModelId: uuid("score_model_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessageSanitized: text("error_message_sanitized"),
    summaryJson: jsonb("summary_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("analysis_runs_domain_idx").on(t.domainId, t.createdAt),
    index("analysis_runs_status_idx").on(t.status, t.createdAt),
    index("analysis_runs_batch_idx").on(t.sourceBatchId),
  ],
);

export const analysisSteps = pgTable(
  "analysis_steps",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    analysisRunId: uuid("analysis_run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    providerKey: text("provider_key"),
    status: text("status", { enum: ANALYSIS_STEP_STATUSES }).notNull().default("pending"),
    attempt: integer("attempt").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    errorCode: text("error_code"),
    metadataJson: jsonb("metadata_json").notNull().default({}),
  },
  (t) => [index("analysis_steps_run_idx").on(t.analysisRunId, t.stepKey)],
);

export const domainObservations = pgTable(
  "domain_observations",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    analysisRunId: uuid("analysis_run_id").references(() => analysisRuns.id, {
      onDelete: "set null",
    }),
    providerKey: text("provider_key").notNull(),
    metricKey: text("metric_key").notNull(),
    valueType: text("value_type", { enum: OBSERVATION_VALUE_TYPES }).notNull(),
    valueNumeric: doublePrecision("value_numeric"),
    valueText: text("value_text"),
    valueBoolean: boolean("value_boolean"),
    valueJson: jsonb("value_json"),
    state: text("state", { enum: OBSERVATION_STATES }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    confidenceNumeric: doublePrecision("confidence_numeric"),
    rawEvidenceKey: text("raw_evidence_key"),
    licenseClass: text("license_class", { enum: LICENSE_CLASSES }).notNull().default("internal"),
    /** Set when the value was purged by the retention routine; metadata retained for audit. */
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    metadataJson: jsonb("metadata_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("domain_observations_domain_metric_idx").on(t.domainId, t.metricKey, t.observedAt),
    index("domain_observations_provider_metric_idx").on(t.providerKey, t.metricKey),
    index("domain_observations_expires_idx").on(t.expiresAt),
    index("domain_observations_run_idx").on(t.analysisRunId),
  ],
);

export type AnalysisRun = typeof analysisRuns.$inferSelect;
export type NewAnalysisRun = typeof analysisRuns.$inferInsert;
export type AnalysisStep = typeof analysisSteps.$inferSelect;
export type DomainObservation = typeof domainObservations.$inferSelect;
export type NewDomainObservation = typeof domainObservations.$inferInsert;
