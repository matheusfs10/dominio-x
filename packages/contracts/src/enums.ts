/**
 * Shared enumerations for the Dominio-X core domain.
 * These are the vocabulary of the platform and are deliberately provider-agnostic.
 */

export const USER_ROLES = ["admin", "analyst", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const SOURCE_TYPES = ["registry_release", "manual", "csv_import"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_KEYS = {
  REGISTRO_BR_RELEASE: "registro_br_release",
  MANUAL: "manual",
  CSV_IMPORT: "csv_import",
} as const;
export type SourceKey = (typeof SOURCE_KEYS)[keyof typeof SOURCE_KEYS];

export const SOURCE_BATCH_STATUSES = ["ingesting", "ingested", "analyzing", "failed"] as const;
export type SourceBatchStatus = (typeof SOURCE_BATCH_STATUSES)[number];

export const ANALYSIS_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;
export type AnalysisRunStatus = (typeof ANALYSIS_RUN_STATUSES)[number];

export const ANALYSIS_TRIGGER_TYPES = [
  "manual",
  "batch",
  "csv_import",
  "reanalysis",
  "retry",
  "smoke",
] as const;
export type AnalysisTriggerType = (typeof ANALYSIS_TRIGGER_TYPES)[number];

export const ANALYSIS_STEP_STATUSES = [
  "pending",
  "running",
  "completed",
  "skipped",
  "failed",
] as const;
export type AnalysisStepStatus = (typeof ANALYSIS_STEP_STATUSES)[number];

/** Pipeline stage keys. Queue names are derived from these (see @dominio-x/queue). */
export const PIPELINE_STAGES = [
  "preflight",
  "dns",
  "crawl",
  "candidate_gate",
  "seo",
  "rules",
  "score",
  "complete",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const OBSERVATION_STATES = ["measured", "unknown", "not_available", "error"] as const;
export type ObservationState = (typeof OBSERVATION_STATES)[number];

export const OBSERVATION_VALUE_TYPES = ["numeric", "text", "boolean", "json"] as const;
export type ObservationValueType = (typeof OBSERVATION_VALUE_TYPES)[number];

export const LICENSE_CLASSES = [
  "internal",
  "public_source",
  "provider_restricted",
  "provider_contractual",
] as const;
export type LicenseClass = (typeof LICENSE_CLASSES)[number];

export const PROVIDER_KEYS = {
  LEXICAL: "lexical",
  DNS: "dns",
  RDAP: "rdap",
  CRAWLER: "crawler",
  SEMRUSH: "semrush",
} as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[keyof typeof PROVIDER_KEYS];

export const PROVIDER_CAPABILITIES = [
  "lexical",
  "dns",
  "http",
  "seo",
  "backlinks",
  "traffic",
  "keywords",
  "rdap",
  "reputation",
  "history",
] as const;
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export const PROVIDER_ERROR_CODES = [
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_DISABLED",
  "PROVIDER_DECISION_PENDING",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_AUTH_FAILED",
  "PROVIDER_QUOTA_EXHAUSTED",
  "PROVIDER_BUDGET_EXHAUSTED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UPSTREAM_ERROR",
  "PROVIDER_CIRCUIT_OPEN",
  "PROVIDER_INVALID_INPUT",
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export const RULESET_STATUSES = ["draft", "active", "archived"] as const;
export type RulesetStatus = (typeof RULESET_STATUSES)[number];

export const RULE_CATEGORIES = [
  "validation",
  "blacklist",
  "lexical",
  "network",
  "security",
  "reputation",
  "custom",
] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const RULE_ACTIONS = [
  "reject",
  "quarantine",
  "warn",
  "tag",
  "score_adjustment",
  "candidate_allow",
  "candidate_deny",
] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

export const SCORE_MODEL_STATUSES = ["draft", "active", "archived"] as const;
export type ScoreModelStatus = (typeof SCORE_MODEL_STATUSES)[number];

export const SCORE_DIMENSIONS = [
  "name",
  "brand",
  "seo",
  "link",
  "history",
  "commercial",
  "risk",
  "acquisition",
] as const;
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

/** Automatic disposition produced by the rule engine. */
export const DISPOSITIONS = ["accepted", "rejected", "quarantined", "needs_review"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/** Manual disposition set by analysts (additive, never overwrites rule history). */
export const MANUAL_DISPOSITIONS = [
  "interesting",
  "rejected",
  "monitoring",
  "acquisition_target",
  "acquired",
] as const;
export type ManualDisposition = (typeof MANUAL_DISPOSITIONS)[number];

export const SHORTLIST_STATUSES = ["open", "closed", "archived"] as const;
export type ShortlistStatus = (typeof SHORTLIST_STATUSES)[number];

export const CRAWLER_JOB_STATUSES = [
  "pending",
  "claimed",
  "completed",
  "failed",
  "expired",
  "cancelled",
] as const;
export type CrawlerJobStatus = (typeof CRAWLER_JOB_STATUSES)[number];

export const AUDIT_ACTIONS = [
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  "user.created",
  "user.updated",
  "domain.created",
  "domain.reanalysis_requested",
  "domain.deep_analysis_forced",
  "domain.manual_disposition",
  "domain.tag_added",
  "domain.tag_removed",
  "domain.note_added",
  "batch.imported",
  "batch.analysis_requested",
  "analysis_run.retry",
  "ruleset.created",
  "ruleset.updated",
  "ruleset.cloned",
  "ruleset.activated",
  "score_model.activated",
  "shortlist.created",
  "shortlist.updated",
  "shortlist.domain_added",
  "shortlist.domain_removed",
  "provider.updated",
  "settings.updated",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const NORMALIZATION_VERSION = 1;
export const PIPELINE_VERSION = "1.0.0";
