import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { CRAWLER_JOB_STATUSES, SHORTLIST_STATUSES } from "@dominio-x/contracts";
import { newId } from "../ids.js";
import { analysisRuns } from "./analysis.js";
import { domains } from "./domains.js";
import { users } from "./users.js";

export const shortlists = pgTable("shortlists", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status", { enum: SHORTLIST_STATUSES }).notNull().default("open"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shortlistDomains = pgTable(
  "shortlist_domains",
  {
    shortlistId: uuid("shortlist_id")
      .notNull()
      .references(() => shortlists.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    analysisRunId: uuid("analysis_run_id").references(() => analysisRuns.id, {
      onDelete: "set null",
    }),
    rank: integer("rank"),
    note: text("note"),
    addedBy: uuid("added_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.shortlistId, t.domainId] }),
    index("shortlist_domains_domain_idx").on(t.domainId),
  ],
);

/** Lease-based work queue for the isolated crawler project. */
export const crawlerJobs = pgTable(
  "crawler_jobs",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    analysisRunId: uuid("analysis_run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    fqdn: text("fqdn").notNull(),
    status: text("status", { enum: CRAWLER_JOB_STATUSES }).notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(2),
    claimedBy: text("claimed_by"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    resultJson: jsonb("result_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("crawler_jobs_status_idx").on(t.status, t.createdAt),
    index("crawler_jobs_run_idx").on(t.analysisRunId),
    index("crawler_jobs_lease_idx").on(t.leaseExpiresAt),
  ],
);

export type Shortlist = typeof shortlists.$inferSelect;
export type ShortlistDomain = typeof shortlistDomains.$inferSelect;
export type CrawlerJobRecord = typeof crawlerJobs.$inferSelect;
