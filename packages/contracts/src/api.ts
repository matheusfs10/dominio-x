import { z } from "zod";
import {
  ANALYSIS_RUN_STATUSES,
  DISPOSITIONS,
  MANUAL_DISPOSITIONS,
  RULE_CATEGORIES,
  SHORTLIST_STATUSES,
  USER_ROLES,
} from "./enums.js";
import { paginationQuerySchema } from "./pagination.js";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const loginBodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1024),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const userSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  role: z.enum(USER_ROLES),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const createUserBodySchema = z.object({
  email: z.string().email().max(320),
  name: z.string().min(1).max(120),
  password: z.string().min(12).max(1024),
  role: z.enum(USER_ROLES),
});
export type CreateUserBody = z.infer<typeof createUserBodySchema>;

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------
export const createDomainBodySchema = z.object({
  domain: z.string().min(1).max(512),
  analyze: z.boolean().default(true),
  forceDeep: z.boolean().default(false),
});
export type CreateDomainBody = z.infer<typeof createDomainBodySchema>;

export const analyzeDomainBodySchema = z.object({
  forceDeep: z.boolean().default(false),
  forceRefresh: z.boolean().default(false),
  reason: z.string().max(500).optional(),
});
export type AnalyzeDomainBody = z.infer<typeof analyzeDomainBodySchema>;

export const domainSortFields = [
  "first_seen_at",
  "last_seen_at",
  "ascii_fqdn",
  "overall_score",
  "confidence_score",
  "name_score",
  "seo_score",
  "risk_score",
] as const;

const optionalBool = z
  .union([z.literal("true"), z.literal("false"), z.boolean()])
  .transform((v) => v === true || v === "true")
  .optional();

export const listDomainsQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(255).optional(),
  sourceKey: z.string().max(64).optional(),
  batchId: z.string().uuid().optional(),
  tld: z.string().max(64).optional(),
  minOverall: z.coerce.number().min(0).max(100).optional(),
  maxOverall: z.coerce.number().min(0).max(100).optional(),
  minConfidence: z.coerce.number().min(0).max(100).optional(),
  minName: z.coerce.number().min(0).max(100).optional(),
  minSeo: z.coerce.number().min(0).max(100).optional(),
  maxRisk: z.coerce.number().min(0).max(100).optional(),
  analysisStatus: z.enum(ANALYSIS_RUN_STATUSES).optional(),
  disposition: z.enum(DISPOSITIONS).optional(),
  manualDisposition: z.enum(MANUAL_DISPOSITIONS).optional(),
  tag: z.string().max(64).optional(),
  maxDigits: z.coerce.number().int().min(0).optional(),
  maxHyphens: z.coerce.number().int().min(0).optional(),
  maxLength: z.coerce.number().int().min(1).optional(),
  hasSeo: optionalBool,
  hasDns: optionalBool,
  httpStatus: z.coerce.number().int().optional(),
  shortlisted: optionalBool,
  sort: z.enum(domainSortFields).default("first_seen_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListDomainsQuery = z.infer<typeof listDomainsQuerySchema>;

export const manualDispositionBodySchema = z.object({
  disposition: z.enum(MANUAL_DISPOSITIONS).nullable(),
  note: z.string().max(2000).optional(),
});

export const addTagBodySchema = z.object({ tag: z.string().min(1).max(64) });
export const addNoteBodySchema = z.object({ body: z.string().min(1).max(5000) });

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------
export const listBatchesQuerySchema = paginationQuerySchema.extend({
  sourceKey: z.string().max(64).optional(),
});

export const importBatchBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  /** Raw CSV / text content. One domain per row. Header row optional. */
  content: z.string().min(1),
  analyze: z.boolean().default(true),
});
export type ImportBatchBody = z.infer<typeof importBatchBodySchema>;

export const analyzeBatchBodySchema = z.object({
  onlyNew: z.boolean().default(false),
  forceRefresh: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Analysis runs
// ---------------------------------------------------------------------------
export const listAnalysisRunsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ANALYSIS_RUN_STATUSES).optional(),
  domainId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Shortlists
// ---------------------------------------------------------------------------
export const createShortlistBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});
export const updateShortlistBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(SHORTLIST_STATUSES).optional(),
});
export const addShortlistDomainBodySchema = z.object({
  domainId: z.string().uuid(),
  note: z.string().max(2000).optional(),
  rank: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Rulesets
// ---------------------------------------------------------------------------
export const ruleInputSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_.-]+$/i),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  category: z.enum(RULE_CATEGORIES).default("custom"),
  priority: z.number().int().min(0).max(10_000).default(100),
  enabled: z.boolean().default(true),
  condition: z.unknown(),
  action: z.unknown(),
  reasonCode: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Z0-9_]+$/),
});
export type RuleInput = z.infer<typeof ruleInputSchema>;

export const createRulesetBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  rules: z.array(ruleInputSchema).max(500).default([]),
});
export const updateRulesetBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  rules: z.array(ruleInputSchema).max(500).optional(),
});
export const testRulesetBodySchema = z.object({
  domainIds: z.array(z.string().uuid()).min(1).max(100),
});

// ---------------------------------------------------------------------------
// Providers / settings
// ---------------------------------------------------------------------------
export const updateProviderBodySchema = z.object({
  enabled: z.boolean().optional(),
  rateLimitRps: z.number().min(0.1).max(1000).optional(),
  concurrencyLimit: z.number().int().min(1).max(1000).optional(),
  timeoutMs: z.number().int().min(100).max(120_000).optional(),
  defaultTtlHours: z
    .number()
    .min(0)
    .max(24 * 365)
    .optional(),
  monthlyUnitBudget: z.number().int().min(0).nullable().optional(),
});

export const candidateGateSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  maxSldLength: z.number().int().min(1).max(63).default(20),
  maxDigits: z.number().int().min(0).default(3),
  maxHyphens: z.number().int().min(0).default(2),
  maxRandomness: z.number().min(0).max(1).default(0.75),
  requireEvidence: z.boolean().default(false),
  maxDeepAnalysesPerBatch: z.number().int().min(0).nullable().default(200),
});
export type CandidateGateSettings = z.infer<typeof candidateGateSettingsSchema>;

export const updateSettingsBodySchema = z.object({
  candidateGate: candidateGateSettingsSchema.partial().optional(),
});

// ---------------------------------------------------------------------------
// Usage / audit
// ---------------------------------------------------------------------------
export const usageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export const auditQuerySchema = paginationQuerySchema.extend({
  action: z.string().max(64).optional(),
  userId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Internal crawler API
// ---------------------------------------------------------------------------
export const crawlerClaimBodySchema = z.object({
  workerId: z.string().min(1).max(128),
  max: z.number().int().min(1).max(10).default(1),
});

export const crawlerHeartbeatBodySchema = z.object({
  workerId: z.string().min(1).max(128),
});

export const crawlerResultSchema = z.object({
  reachable: z.boolean(),
  httpsAvailable: z.boolean().nullable(),
  status: z.number().int().nullable(),
  redirectCount: z.number().int().min(0),
  redirectChain: z.array(z.string().max(2048)).max(20),
  finalUrl: z.string().max(2048).nullable(),
  finalHostname: z.string().max(255).nullable(),
  title: z.string().max(500).nullable(),
  metaDescription: z.string().max(1000).nullable(),
  contentType: z.string().max(255).nullable(),
  contentLength: z.number().int().min(0).nullable(),
  server: z.string().max(255).nullable(),
  securityBlocked: z.boolean(),
  error: z.string().max(500).nullable(),
  durationMs: z.number().int().min(0),
});
export type CrawlerResult = z.infer<typeof crawlerResultSchema>;

export const crawlerCompleteBodySchema = z.object({
  workerId: z.string().min(1).max(128),
  result: crawlerResultSchema,
});

export const crawlerFailBodySchema = z.object({
  workerId: z.string().min(1).max(128),
  errorCode: z.string().max(64),
  message: z.string().max(500).optional(),
  retryable: z.boolean().default(false),
});

export const crawlerJobSchema = z.object({
  id: z.string().uuid(),
  analysisRunId: z.string().uuid(),
  domainId: z.string().uuid(),
  fqdn: z.string(),
  leaseExpiresAt: z.string(),
  attempt: z.number().int(),
});
export type CrawlerJob = z.infer<typeof crawlerJobSchema>;
