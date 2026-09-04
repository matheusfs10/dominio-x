import { z } from "zod";

/**
 * Runtime-validated configuration. Each process loads only the slice it needs so that
 * optional providers never block boot and the crawler never sees core secrets.
 */

const nodeEnv = z.enum(["development", "test", "production"]).default("development");
const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase()),
  );
const intFrom = (def: number) => z.coerce.number().int().min(0).default(def);
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

export const baseSchema = z.object({
  NODE_ENV: nodeEnv,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SENTRY_DSN: optionalString,
  SERVICE_NAME: z.string().default("dominio-x"),
});

export const databaseSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith("postgres"), "DATABASE_URL must be a postgres URL"),
  DATABASE_POOL_MAX: intFrom(10),
});

export const redisSchema = z.object({
  REDIS_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith("redis"), "REDIS_URL must be a redis URL"),
});

export const storageSchema = z
  .object({
    STORAGE_DRIVER: z.enum(["s3", "fs", "memory"]).default("s3"),
    STORAGE_FS_ROOT: z.string().default(".data/storage"),
    S3_ENDPOINT: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_BUCKET: optionalString,
    S3_REGION: z.string().default("auto"),
    S3_URL_STYLE: z.enum(["virtual", "path"]).default("virtual"),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.STORAGE_DRIVER === "s3") {
      for (const key of [
        "S3_ENDPOINT",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
        "S3_BUCKET",
      ] as const) {
        if (!cfg[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3`,
          });
        }
      }
    }
  });

export const securitySchema = z.object({
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .min(1)
    .max(24 * 30)
    .default(12),
  CRAWLER_MACHINE_TOKEN: z.string().min(32, "CRAWLER_MACHINE_TOKEN must be at least 32 characters"),
  APP_URL: z.string().url(),
  API_URL: z.string().url(),
  CORS_ALLOWED_ORIGINS: optionalString,
  TRUST_PROXY: bool.default(true),
});

export const registroBrSchema = z.object({
  REGISTRO_BR_RELEASE_URL: z
    .string()
    .url()
    .default("https://registro.br/dominio/lista-processo-liberacao.txt"),
  REGISTRO_BR_USER_AGENT: z.string().default("Dominio-X/1.0 (+internal-domain-intelligence)"),
  REGISTRO_BR_TIMEOUT_MS: intFrom(30_000),
});

export const semrushSchema = z.object({
  SEMRUSH_ENABLED: bool.default(false),
  SEMRUSH_API_KEY: optionalString,
  SEMRUSH_MAX_RPS: z.coerce.number().min(0.1).max(10).default(8),
  SEMRUSH_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(8),
  SEMRUSH_DATA_TTL_DAYS: z.coerce.number().min(1).default(30),
  SEMRUSH_MONTHLY_UNIT_BUDGET: z.coerce.number().int().min(0).optional(),
  SEMRUSH_TIMEOUT_MS: intFrom(15_000),
});

/**
 * DataForSEO — paid estimated-search-traffic provider.
 *
 * Credentials are the API login/password pair from the DataForSEO dashboard (Basic auth),
 * never the account password. Nothing here is required to boot: with the provider disabled or
 * unconfigured the traffic stage is skipped and the run stays valid.
 */
export const dataForSeoSchema = z.object({
  DATAFORSEO_ENABLED: bool.default(false),
  DATAFORSEO_LOGIN: optionalString,
  DATAFORSEO_PASSWORD: optionalString,
  DATAFORSEO_BASE_URL: z.string().url().default("https://api.dataforseo.com"),
  /** Google geo target id of the audience to measure. 2076 = Brazil. */
  DATAFORSEO_LOCATION_CODE: z.coerce.number().int().min(1).default(2076),
  DATAFORSEO_LOCATION_NAME: z.string().default("Brazil"),
  DATAFORSEO_LANGUAGE_CODE: z.string().min(2).max(10).default("pt"),
  /** Size of the rolling history window, in whole months. */
  DATAFORSEO_WINDOW_MONTHS: z.coerce.number().int().min(1).max(24).default(6),
  DATAFORSEO_MAX_RPS: z.coerce.number().min(0.1).max(30).default(2),
  DATAFORSEO_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(30).default(2),
  DATAFORSEO_DATA_TTL_DAYS: z.coerce.number().min(1).default(30),
  /** Upper bound in USD for a calendar month (UTC); the DB setting may lower it further. */
  DATAFORSEO_MONTHLY_COST_BUDGET_USD: z.coerce.number().min(0).optional(),
  /** Assumed price of one lookup before the response reports the real cost. */
  DATAFORSEO_ESTIMATED_COST_PER_CALL_USD: z.coerce.number().min(0).default(0.02),
  /** Seconds to cache the free account-balance lookup. */
  DATAFORSEO_BALANCE_CACHE_SECONDS: z.coerce.number().int().min(0).default(300),
  DATAFORSEO_TIMEOUT_MS: intFrom(20_000),
});

/**
 * CapSolver — captcha solving service used to obtain the Cloudflare Turnstile token the
 * Ahrefs free tools require. Priced per solved token, so it is treated as a paid provider:
 * the cost of one Ahrefs lookup *is* the cost of one solve.
 */
export const capSolverSchema = z.object({
  CAPSOLVER_ENABLED: bool.default(false),
  CAPSOLVER_API_KEY: optionalString,
  CAPSOLVER_BASE_URL: z.string().url().default("https://api.capsolver.com"),
  /** Optional developer/app id from the CapSolver dashboard. */
  CAPSOLVER_APP_ID: optionalString,
  /** Timeout of a single call to the solver's own API. */
  CAPSOLVER_TIMEOUT_MS: intFrom(20_000),
  /** Gap between `getTaskResult` polls. The vendor documents 3s as the recommended value. */
  CAPSOLVER_POLL_INTERVAL_MS: z.coerce.number().int().min(500).max(30_000).default(3_000),
  /** Give up on a task after this long. The vendor times a task out at 120s. */
  CAPSOLVER_MAX_WAIT_MS: z.coerce.number().int().min(5_000).max(300_000).default(120_000),
  /** Seconds to cache the free balance lookup. */
  CAPSOLVER_BALANCE_CACHE_SECONDS: z.coerce.number().int().min(0).default(300),
  /**
   * Price of one solved token in USD, from the vendor's price list. The API does not report a
   * per-task price, so this is what the request ledger records as the cost of a lookup.
   */
  CAPSOLVER_COST_PER_SOLVE_USD: z.coerce.number().min(0).default(0.001),
});

/**
 * Ahrefs — Domain Rating from the public backlink checker.
 *
 * There is no API key: the free tool is protected by Cloudflare Turnstile, and every lookup
 * needs a freshly solved token (see `capSolverSchema`). The provider is therefore "paid" in
 * captcha credits rather than in vendor credits, and it stays disabled until an operator
 * turns it on. Nothing here is required to boot: with the provider off the authority stage is
 * skipped and the run stays valid.
 */
const DEFAULT_AHREFS_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const ahrefsSchema = z.object({
  AHREFS_ENABLED: bool.default(false),
  AHREFS_BASE_URL: z.string().url().default("https://ahrefs.com"),
  /** URL matching mode of the lookup. `subdomains` matches the tool's own default. */
  AHREFS_MODE: z.enum(["exact", "prefix", "domain", "subdomains"]).default("subdomains"),
  /** Scheme used to build the submitted URL from a domain name. */
  AHREFS_TARGET_SCHEME: z.enum(["https", "http"]).default("https"),
  /** Turnstile site key of the free tools, needed by the solver. */
  AHREFS_TURNSTILE_SITEKEY: z.string().min(8).default("0x4AAAAAAAAzi9ITzSN9xKMi"),
  /** Empty falls back to the default: an unset browser agent is refused by the tool. */
  AHREFS_USER_AGENT: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : DEFAULT_AHREFS_USER_AGENT)),
  /** Sent as `X-Client-Version` when set; the tool sends its own build id. */
  AHREFS_CLIENT_VERSION: optionalString,
  /**
   * Escape hatch for a `cf_clearance` cookie obtained out of band. Only needed when the
   * upstream WAF starts challenging the egress IP; leave empty otherwise.
   */
  AHREFS_COOKIE: optionalString,
  /** Deliberately slow: this is a public free tool, not a metered API. */
  AHREFS_MAX_RPS: z.coerce.number().min(0.01).max(5).default(0.2),
  AHREFS_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(1),
  AHREFS_DATA_TTL_DAYS: z.coerce.number().min(1).default(30),
  /** Upper bound in USD for a calendar month (UTC); the DB setting may lower it further. */
  AHREFS_MONTHLY_COST_BUDGET_USD: z.coerce.number().min(0).optional(),
  AHREFS_TIMEOUT_MS: intFrom(30_000),
});

export const pipelineSchema = z.object({
  PIPELINE_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  DNS_TTL_HOURS: z.coerce.number().min(0).default(24),
  HTTP_TTL_HOURS: z.coerce.number().min(0).default(72),
  RDAP_ENABLED: bool.default(false),
  RDAP_TTL_HOURS: z.coerce
    .number()
    .min(0)
    .default(24 * 7),
  CRAWLER_ENABLED: bool.default(true),
  CRAWLER_JOB_LEASE_SECONDS: z.coerce.number().int().min(10).default(120),
  CRAWLER_STAGE_WAIT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(600_000),
  PROVIDER_RESTRICTED_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
});

export const crawlerServiceSchema = z.object({
  CRAWLER_CORE_API_URL: z.string().url(),
  CRAWLER_MACHINE_TOKEN: z.string().min(32),
  CRAWLER_WORKER_ID: optionalString,
  CRAWLER_CONNECT_TIMEOUT_MS: intFrom(5_000),
  CRAWLER_TOTAL_TIMEOUT_MS: intFrom(12_000),
  CRAWLER_MAX_REDIRECTS: intFrom(5),
  CRAWLER_MAX_BODY_BYTES: intFrom(2 * 1024 * 1024),
  CRAWLER_MAX_DECOMPRESSED_BYTES: intFrom(4 * 1024 * 1024),
  CRAWLER_POLL_INTERVAL_MS: intFrom(5_000),
  CRAWLER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  CRAWLER_USER_AGENT: z.string().default("Dominio-X-Crawler/1.0 (+internal-domain-intelligence)"),
});

export const bootstrapSchema = z.object({
  BOOTSTRAP_ADMIN_EMAIL: optionalString,
  BOOTSTRAP_ADMIN_PASSWORD: optionalString,
});

export const apiConfigSchema = baseSchema
  .extend(databaseSchema.shape)
  .extend(redisSchema.shape)
  .extend(securitySchema.shape)
  .extend(semrushSchema.shape)
  .extend(dataForSeoSchema.shape)
  .extend(capSolverSchema.shape)
  .extend(ahrefsSchema.shape)
  .extend(pipelineSchema.shape)
  .extend(registroBrSchema.shape)
  .extend({
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default("::"),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .default(15 * 60 * 1000),
    BODY_LIMIT_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .default(5 * 1024 * 1024),
    CSV_IMPORT_MAX_ROWS: z.coerce.number().int().min(1).default(50_000),
  })
  .and(storageSchema);

export const workerConfigSchema = baseSchema
  .extend(databaseSchema.shape)
  .extend(redisSchema.shape)
  .extend(semrushSchema.shape)
  .extend(dataForSeoSchema.shape)
  .extend(capSolverSchema.shape)
  .extend(ahrefsSchema.shape)
  .extend(pipelineSchema.shape)
  .and(storageSchema);

export const schedulerConfigSchema = baseSchema
  .extend(databaseSchema.shape)
  .extend(redisSchema.shape)
  .extend(registroBrSchema.shape)
  .extend(pipelineSchema.shape)
  .and(storageSchema);

export const crawlerConfigSchema = baseSchema.extend(crawlerServiceSchema.shape);

export type ApiConfig = z.infer<typeof apiConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export type SchedulerConfig = z.infer<typeof schedulerConfigSchema>;
export type CrawlerConfig = z.infer<typeof crawlerConfigSchema>;
export type SemrushConfig = z.infer<typeof semrushSchema>;
export type DataForSeoConfig = z.infer<typeof dataForSeoSchema>;
export type CapSolverConfig = z.infer<typeof capSolverSchema>;
export type AhrefsConfig = z.infer<typeof ahrefsSchema>;
export type PipelineConfig = z.infer<typeof pipelineSchema>;
export type StorageConfig = z.infer<typeof storageSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function formatIssues(issues: z.ZodIssue[]): string {
  return issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
}

function load<T>(schema: z.ZodType<T>, env: NodeJS.ProcessEnv, label: string): T {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(`Invalid ${label} configuration:\n${formatIssues(result.error.issues)}`);
  }
  return result.data;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return load(apiConfigSchema, env, "api");
}
export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return load(workerConfigSchema, env, "worker");
}
export function loadSchedulerConfig(env: NodeJS.ProcessEnv = process.env): SchedulerConfig {
  return load(schedulerConfigSchema, env, "scheduler");
}
export function loadCrawlerConfig(env: NodeJS.ProcessEnv = process.env): CrawlerConfig {
  return load(crawlerConfigSchema, env, "crawler");
}
export function loadBootstrapConfig(env: NodeJS.ProcessEnv = process.env) {
  return load(bootstrapSchema, env, "bootstrap");
}
export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env) {
  return load(baseSchema.extend(databaseSchema.shape), env, "database");
}

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}
