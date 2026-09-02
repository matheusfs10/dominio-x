import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ANALYSIS_RUN_STATUSES, DISPOSITIONS, MANUAL_DISPOSITIONS } from "@dominio-x/contracts";
import { newId } from "../ids.js";
import { users } from "./users.js";

export const domains = pgTable(
  "domains",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    fqdn: text("fqdn").notNull(),
    asciiFqdn: text("ascii_fqdn").notNull(),
    unicodeFqdn: text("unicode_fqdn").notNull(),
    sld: text("sld").notNull(),
    tld: text("tld").notNull(),
    registrableDomain: text("registrable_domain").notNull(),
    normalizationVersion: integer("normalization_version").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("domains_ascii_fqdn_uidx").on(t.asciiFqdn),
    index("domains_tld_idx").on(t.tld),
    index("domains_sld_idx").on(t.sld),
    index("domains_first_seen_idx").on(t.firstSeenAt),
    index("domains_registrable_idx").on(t.registrableDomain),
    index("domains_ascii_fqdn_trgm_idx").using("gin", sql`${t.asciiFqdn} gin_trgm_ops`),
  ],
);

/**
 * Denormalized "latest state" per domain, maintained by the pipeline and analyst actions.
 * This is what the Domain Explorer filters and sorts on. Historical truth lives in the
 * analysis tables; this table may always be rebuilt from them.
 */
export const domainSummaries = pgTable(
  "domain_summaries",
  {
    domainId: uuid("domain_id")
      .primaryKey()
      .references(() => domains.id, { onDelete: "cascade" }),
    latestRunId: uuid("latest_run_id"),
    latestRunStatus: text("latest_run_status", { enum: ANALYSIS_RUN_STATUSES }),
    latestRunAt: timestamp("latest_run_at", { withTimezone: true }),
    latestCompletedRunId: uuid("latest_completed_run_id"),
    disposition: text("disposition", { enum: DISPOSITIONS }),
    manualDisposition: text("manual_disposition", { enum: MANUAL_DISPOSITIONS }),
    overallScore: real("overall_score"),
    confidenceScore: real("confidence_score"),
    nameScore: real("name_score"),
    brandScore: real("brand_score"),
    seoScore: real("seo_score"),
    linkScore: real("link_score"),
    historyScore: real("history_score"),
    commercialScore: real("commercial_score"),
    riskScore: real("risk_score"),
    acquisitionScore: real("acquisition_score"),
    digitCount: integer("digit_count"),
    hyphenCount: integer("hyphen_count"),
    fqdnLength: integer("fqdn_length"),
    dnsResolves: boolean("dns_resolves"),
    httpStatus: integer("http_status"),
    hasSeoData: boolean("has_seo_data"),
    candidateGatePassed: boolean("candidate_gate_passed"),
    shortlistCount: integer("shortlist_count").notNull().default(0),
    sourceKeys: text("source_keys")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tagKeys: text("tag_keys")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("domain_summaries_overall_idx").on(t.overallScore),
    index("domain_summaries_confidence_idx").on(t.confidenceScore),
    index("domain_summaries_status_idx").on(t.latestRunStatus),
    index("domain_summaries_disposition_idx").on(t.disposition),
    index("domain_summaries_manual_idx").on(t.manualDisposition),
    index("domain_summaries_updated_idx").on(t.updatedAt),
  ],
);

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  color: text("color"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const domainTags = pgTable(
  "domain_tags",
  {
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    addedBy: uuid("added_by").references(() => users.id),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.domainId, t.tagId] }), index("domain_tags_tag_idx").on(t.tagId)],
);

export const domainNotes = pgTable(
  "domain_notes",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorId: uuid("author_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("domain_notes_domain_idx").on(t.domainId)],
);

/** Additive manual disposition history. Latest value is mirrored into domain_summaries. */
export const domainDispositions = pgTable(
  "domain_dispositions",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    disposition: text("disposition", { enum: MANUAL_DISPOSITIONS }),
    note: text("note"),
    setBy: uuid("set_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("domain_dispositions_domain_idx").on(t.domainId, t.createdAt)],
);

/** Analyst-managed blacklist evaluated during preflight. */
export const domainBlacklist = pgTable("domain_blacklist", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  /** Exact ascii FQDN, or a suffix pattern starting with "." (e.g. ".gov.br"), or "*substring*". */
  pattern: text("pattern").notNull().unique(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Domain = typeof domains.$inferSelect;
export type NewDomain = typeof domains.$inferInsert;
export type DomainSummary = typeof domainSummaries.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type DomainNote = typeof domainNotes.$inferSelect;
