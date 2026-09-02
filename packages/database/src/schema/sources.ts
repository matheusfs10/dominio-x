import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { SOURCE_BATCH_STATUSES, SOURCE_TYPES } from "@dominio-x/contracts";
import { newId } from "../ids.js";
import { domains } from "./domains.js";

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  type: text("type", { enum: SOURCE_TYPES }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  configJson: jsonb("config_json").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sourceBatches = pgTable(
  "source_batches",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    externalReference: text("external_reference"),
    name: text("name"),
    status: text("status", { enum: SOURCE_BATCH_STATUSES }).notNull().default("ingesting"),
    contentSha256: text("content_sha256").notNull(),
    artifactKey: text("artifact_key"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    domainCount: integer("domain_count").notNull().default(0),
    newDomainCount: integer("new_domain_count").notNull().default(0),
    invalidLineCount: integer("invalid_line_count").notNull().default(0),
    metadataJson: jsonb("metadata_json").notNull().default({}),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("source_batches_source_sha_uidx").on(t.sourceId, t.contentSha256),
    index("source_batches_detected_idx").on(t.detectedAt),
  ],
);

export const sourceBatchDomains = pgTable(
  "source_batch_domains",
  {
    sourceBatchId: uuid("source_batch_id")
      .notNull()
      .references(() => sourceBatches.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id),
    rawValue: text("raw_value").notNull(),
    position: integer("position").notNull(),
    isNew: boolean("is_new").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceBatchId, t.domainId] }),
    index("source_batch_domains_domain_idx").on(t.domainId),
  ],
);

export type Source = typeof sources.$inferSelect;
export type SourceBatch = typeof sourceBatches.$inferSelect;
export type SourceBatchDomain = typeof sourceBatchDomains.$inferSelect;
