import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { RULE_CATEGORIES, RULESET_STATUSES } from "@dominio-x/contracts";
import { newId } from "../ids.js";
import { analysisRuns } from "./analysis.js";
import { domains } from "./domains.js";

export const rulesets = pgTable(
  "rulesets",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    status: text("status", { enum: RULESET_STATUSES }).notNull().default("draft"),
    description: text("description").notNull().default(""),
    scope: text("scope").notNull().default("default"),
    createdBy: uuid("created_by"),
    clonedFromId: uuid("cloned_from_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("rulesets_scope_version_uidx").on(t.scope, t.version),
    index("rulesets_status_idx").on(t.status),
  ],
);

export const rules = pgTable(
  "rules",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    rulesetId: uuid("ruleset_id")
      .notNull()
      .references(() => rulesets.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    category: text("category", { enum: RULE_CATEGORIES }).notNull().default("custom"),
    priority: integer("priority").notNull().default(100),
    enabled: boolean("enabled").notNull().default(true),
    conditionJson: jsonb("condition_json").notNull(),
    actionJson: jsonb("action_json").notNull(),
    reasonCode: text("reason_code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rules_ruleset_key_uidx").on(t.rulesetId, t.key)],
);

export const ruleExecutions = pgTable(
  "rule_executions",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    analysisRunId: uuid("analysis_run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    rulesetId: uuid("ruleset_id").notNull(),
    rulesetVersion: integer("ruleset_version").notNull(),
    ruleId: uuid("rule_id").notNull(),
    ruleKey: text("rule_key").notNull(),
    matched: boolean("matched").notNull(),
    action: text("action"),
    reasonCode: text("reason_code").notNull(),
    evidenceJson: jsonb("evidence_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rule_executions_run_idx").on(t.analysisRunId),
    index("rule_executions_domain_idx").on(t.domainId, t.createdAt),
  ],
);

export type Ruleset = typeof rulesets.$inferSelect;
export type Rule = typeof rules.$inferSelect;
export type RuleExecution = typeof ruleExecutions.$inferSelect;
