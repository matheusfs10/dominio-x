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
  "traffic_visits",
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
  hasTraffic: optionalBool,
  /** Minimum estimated visits over the whole traffic window, for the configured location. */
  minVisits: z.coerce.number().min(0).optional(),
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

/**
 * Free qualification policy for the paid traffic provider (DataForSEO).
 *
 * Every field below is evaluated against evidence the platform already owns for free
 * (lexical, DNS, crawler, candidate gate) plus counters kept in our own ledger. A domain that
 * fails any active check is never sent to the provider, so it costs nothing. This is the
 * cheap-first funnel: the gate exists to protect the account balance, not to be permissive.
 */
export const trafficGateSettingsSchema = z.object({
  /** Master switch for the automatic pipeline lookup. When false, only forced lookups run. */
  enabled: z.boolean().default(false),

  // --- Name shape (free: lexical provider) ---
  /** Domains with more digits than this never qualify. 0 = no digits allowed at all. */
  maxDigits: z.number().int().min(0).max(63).default(0),
  maxHyphens: z.number().int().min(0).max(63).default(1),
  minSldLength: z.number().int().min(1).max(63).default(3),
  maxSldLength: z.number().int().min(1).max(63).default(20),
  maxRandomness: z.number().min(0).max(1).default(0.6),
  allowPunycode: z.boolean().default(false),
  requireDictionaryToken: z.boolean().default(false),
  /** Empty list = any TLD. Values are compared against the normalized public suffix. */
  allowedTlds: z.array(z.string().min(1).max(63)).max(50).default(["com.br", "br"]),

  // --- Network evidence (free: DNS + isolated crawler) ---
  requireDnsResolution: z.boolean().default(true),
  requireHttpReachable: z.boolean().default(false),
  /** Only ask the provider about hosts that answered with one of these statuses. Empty = any. */
  allowedHttpStatuses: z.array(z.number().int().min(100).max(599)).max(20).default([]),
  /** Reuse the existing candidate gate decision as a precondition. */
  requireCandidateGate: z.boolean().default(true),

  // --- Volume caps (free: our own ledger) ---
  /** Skip the call when a measurement younger than this exists. 0 = always re-query. */
  reuseWithinDays: z.number().int().min(0).max(365).default(30),
  maxLookupsPerBatch: z.number().int().min(0).nullable().default(50),
  maxLookupsPerDay: z.number().int().min(0).nullable().default(200),
  maxLookupsPerMonth: z.number().int().min(0).nullable().default(2000),

  // --- Money caps (free: our own ledger + the provider's free balance endpoint) ---
  /** Hard stop in USD for a calendar month (UTC). null = only the env/provider budget applies. */
  monthlyCostBudgetUsd: z.number().min(0).nullable().default(20),
  /** Refuse to call when the account balance is below this. 0 = do not check the balance. */
  minAccountBalanceUsd: z.number().min(0).default(0),
});
export type TrafficGateSettings = z.infer<typeof trafficGateSettingsSchema>;

export const updateSettingsBodySchema = z.object({
  candidateGate: candidateGateSettingsSchema.partial().optional(),
  trafficGate: trafficGateSettingsSchema.partial().optional(),
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
