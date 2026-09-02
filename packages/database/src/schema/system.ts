import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../ids.js";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    action: text("action").notNull(),
    actorId: uuid("actor_id"),
    actorEmail: text("actor_email"),
    targetType: text("target_type"),
    targetId: text("target_id"),
    ipAddress: text("ip_address"),
    requestId: text("request_id"),
    detailsJson: jsonb("details_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_action_idx").on(t.action, t.createdAt),
    index("audit_logs_actor_idx").on(t.actorId),
    index("audit_logs_target_idx").on(t.targetType, t.targetId),
  ],
);

/** Key/value application settings (candidate gate, budgets, ...). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: jsonb("value_json").notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Operational error/event log surfaced in the Overview (bounded by retention). */
export const operationalEvents = pgTable(
  "operational_events",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    level: text("level").notNull().default("error"),
    component: text("component").notNull(),
    code: text("code").notNull(),
    message: text("message").notNull(),
    contextJson: jsonb("context_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("operational_events_created_idx").on(t.createdAt)],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type AppSetting = typeof appSettings.$inferSelect;
export type OperationalEvent = typeof operationalEvents.$inferSelect;
