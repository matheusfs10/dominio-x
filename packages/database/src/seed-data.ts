import { METRICS, PROVIDER_KEYS, SOURCE_KEYS } from "@dominio-x/contracts";

/**
 * Canonical seed definitions. These are data, not behavior: the rule DSL and score weights
 * are interpreted by @dominio-x/rule-engine and @dominio-x/scoring.
 */

export const SEED_SOURCES = [
  {
    key: SOURCE_KEYS.REGISTRO_BR_RELEASE,
    name: "Registro.br — lista do processo de liberação",
    type: "registry_release" as const,
    configJson: {
      url: "https://registro.br/dominio/lista-processo-liberacao.txt",
      infoUrl: "https://registro.br/dominio/processo-de-liberacao",
    },
  },
  { key: SOURCE_KEYS.MANUAL, name: "Manual submission", type: "manual" as const, configJson: {} },
  { key: SOURCE_KEYS.CSV_IMPORT, name: "CSV import", type: "csv_import" as const, configJson: {} },
];

export const SEED_PROVIDERS = [
  {
    key: PROVIDER_KEYS.LEXICAL,
    name: "Local lexical analysis",
    enabled: true,
    paid: false,
    capabilities: ["lexical"],
    rateLimitRps: 1000,
    concurrencyLimit: 100,
    timeoutMs: 1000,
    defaultTtlHours: 0,
    retentionPolicy: "internal",
  },
  {
    key: PROVIDER_KEYS.DNS,
    name: "DNS resolver",
    enabled: true,
    paid: false,
    capabilities: ["dns"],
    rateLimitRps: 50,
    concurrencyLimit: 20,
    timeoutMs: 5000,
    defaultTtlHours: 24,
    retentionPolicy: "public_source",
  },
  {
    key: PROVIDER_KEYS.RDAP,
    name: "RDAP (registration data)",
    enabled: false,
    paid: false,
    capabilities: ["rdap"],
    rateLimitRps: 2,
    concurrencyLimit: 2,
    timeoutMs: 8000,
    defaultTtlHours: 24 * 7,
    retentionPolicy: "public_source",
  },
  {
    key: PROVIDER_KEYS.CRAWLER,
    name: "Isolated HTTP crawler",
    enabled: true,
    paid: false,
    capabilities: ["http"],
    rateLimitRps: 20,
    concurrencyLimit: 10,
    timeoutMs: 12_000,
    defaultTtlHours: 72,
    retentionPolicy: "public_source",
  },
  {
    key: PROVIDER_KEYS.SEMRUSH,
    name: "Semrush",
    enabled: false,
    paid: true,
    capabilities: ["seo", "backlinks", "traffic", "keywords"],
    rateLimitRps: 8,
    concurrencyLimit: 8,
    timeoutMs: 15_000,
    defaultTtlHours: 24 * 30,
    retentionPolicy: "provider_restricted",
    configJson: {
      integrationMode: "standby",
      note: "Integration mode (official API vs alternative) not yet decided.",
    },
  },
];

export const SEED_SCORE_MODEL_V1 = {
  name: "Transparent weighted v1",
  version: 1,
  weightsJson: {
    name: 0.25,
    brand: 0.2,
    seo: 0.25,
    link: 0.1,
    history: 0.1,
    commercial: 0.1,
  },
  configJson: {
    riskPenaltyFactor: 0.35,
    expectedDimensions: ["name", "brand", "seo", "link", "history", "commercial", "risk"],
  },
};

export const SEED_RULESET_V1 = {
  name: "Conservative defaults v1",
  version: 1,
  description:
    "Minimal system rules: reject malformed/blacklisted, penalize noisy names, flag punycode and crawler security failures for review.",
  rules: [
    {
      key: "blacklist.match",
      name: "Analyst blacklist match",
      description: "Domain matches an entry in the internal blacklist.",
      category: "blacklist",
      priority: 10,
      reasonCode: "BLACKLISTED",
      condition: { metric: "internal.blacklisted", op: "eq", value: true },
      action: { type: "reject" },
    },
    {
      key: "lexical.excessive_digits",
      name: "Excessive digits",
      description: "More than 4 digits in the name is usually low value (penalty, not reject).",
      category: "lexical",
      priority: 100,
      reasonCode: "EXCESSIVE_DIGITS",
      condition: { metric: METRICS.LEXICAL_DIGIT_COUNT, op: "gt", value: 4 },
      action: { type: "score_adjustment", dimension: "name", delta: -15 },
    },
    {
      key: "lexical.excessive_hyphens",
      name: "Excessive hyphens",
      description: "More than 2 hyphens is a penalty.",
      category: "lexical",
      priority: 100,
      reasonCode: "EXCESSIVE_HYPHENS",
      condition: { metric: METRICS.LEXICAL_HYPHEN_COUNT, op: "gt", value: 2 },
      action: { type: "score_adjustment", dimension: "name", delta: -10 },
    },
    {
      key: "lexical.very_long_sld",
      name: "Very long SLD",
      description: "SLD longer than 24 characters is a penalty.",
      category: "lexical",
      priority: 100,
      reasonCode: "VERY_LONG_SLD",
      condition: { metric: METRICS.LEXICAL_SLD_LENGTH, op: "gt", value: 24 },
      action: { type: "score_adjustment", dimension: "name", delta: -10 },
    },
    {
      key: "lexical.random_looking",
      name: "Random-looking name",
      description:
        "High randomness heuristic → warn and penalize; hard reject only at extreme values.",
      category: "lexical",
      priority: 110,
      reasonCode: "RANDOM_LOOKING",
      condition: { metric: METRICS.LEXICAL_RANDOMNESS_SCORE, op: "gte", value: 0.75 },
      action: { type: "score_adjustment", dimension: "name", delta: -20 },
    },
    {
      key: "lexical.punycode_review",
      name: "Punycode / IDN review",
      description: "IDN domains are flagged for analyst review, never auto-rejected.",
      category: "lexical",
      priority: 120,
      reasonCode: "PUNYCODE_REVIEW",
      condition: { metric: METRICS.LEXICAL_IS_PUNYCODE, op: "eq", value: true },
      action: { type: "warn", disposition: "needs_review" },
    },
    {
      key: "security.crawler_blocked",
      name: "Crawler security block",
      description:
        "The crawler refused the target (SSRF / unsafe destination). Quarantine for review.",
      category: "security",
      priority: 50,
      reasonCode: "CRAWLER_SECURITY_BLOCK",
      condition: { metric: METRICS.HTTP_SECURITY_BLOCKED, op: "eq", value: true },
      action: { type: "quarantine" },
    },
    {
      key: "gate.short_clean_name",
      name: "Short clean name → paid candidate",
      description: "Short names with no digits are always worth deep analysis.",
      category: "lexical",
      priority: 200,
      reasonCode: "SHORT_CLEAN_NAME",
      condition: {
        all: [
          { metric: METRICS.LEXICAL_SLD_LENGTH, op: "lte", value: 8 },
          { metric: METRICS.LEXICAL_DIGIT_COUNT, op: "eq", value: 0 },
          { metric: METRICS.LEXICAL_HYPHEN_COUNT, op: "eq", value: 0 },
        ],
      },
      action: { type: "candidate_allow" },
    },
  ],
};

export const SEED_SETTINGS = {
  candidate_gate: {
    enabled: true,
    maxSldLength: 20,
    maxDigits: 3,
    maxHyphens: 2,
    maxRandomness: 0.75,
    requireEvidence: false,
    maxDeepAnalysesPerBatch: 200,
  },
};

export const DEV_SAMPLE_DOMAINS = [
  "exemplo.com.br",
  "loja-virtual.com.br",
  "bancoxyz.com.br",
  "abc123456.com.br",
  "são-paulo-turismo.com.br",
  "cafe.com.br",
  "minha-super-loja-online-2024.com.br",
  "example.com",
];
