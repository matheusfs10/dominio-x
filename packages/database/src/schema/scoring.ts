import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { SCORE_MODEL_STATUSES } from "@dominio-x/contracts";
import { newId } from "../ids.js";
import { analysisRuns } from "./analysis.js";
import { domains } from "./domains.js";

export const scoreModels = pgTable(
  "score_models",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    status: text("status", { enum: SCORE_MODEL_STATUSES }).notNull().default("draft"),
    weightsJson: jsonb("weights_json").notNull(),
    configJson: jsonb("config_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("score_models_version_uidx").on(t.version)],
);

export const domainScores = pgTable(
  "domain_scores",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    analysisRunId: uuid("analysis_run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "cascade" }),
    scoreModelId: uuid("score_model_id")
      .notNull()
      .references(() => scoreModels.id),
    scoreModelVersion: integer("score_model_version").notNull(),
    nameScore: real("name_score"),
    brandScore: real("brand_score"),
    seoScore: real("seo_score"),
    linkScore: real("link_score"),
    historyScore: real("history_score"),
    commercialScore: real("commercial_score"),
    riskScore: real("risk_score"),
    acquisitionScore: real("acquisition_score"),
    confidenceScore: real("confidence_score").notNull(),
    overallScore: real("overall_score").notNull(),
    explanationJson: jsonb("explanation_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("domain_scores_run_uidx").on(t.analysisRunId),
    index("domain_scores_domain_idx").on(t.domainId, t.createdAt),
    index("domain_scores_overall_idx").on(t.overallScore),
  ],
);

export type ScoreModel = typeof scoreModels.$inferSelect;
export type DomainScore = typeof domainScores.$inferSelect;
export type NewDomainScore = typeof domainScores.$inferInsert;
