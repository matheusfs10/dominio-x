import { METRICS, type TrafficGateSettings } from "@dominio-x/contracts";
import type { MetricContext } from "@dominio-x/rule-engine";
import { measuredBoolean, measuredNumeric } from "./observations.js";

/**
 * Free qualification gate for the paid traffic provider.
 *
 * Everything decided here uses evidence the platform already paid nothing for: lexical analysis,
 * DNS, the isolated crawler, the candidate gate, and our own request ledger. A domain that fails
 * any active check never reaches the provider, so it costs exactly zero.
 *
 * The checks are split in two phases so the caller can bail out early: `qualification` needs only
 * observations the pipeline already loaded, while `budget` needs ledger aggregates and possibly a
 * balance lookup. On a 150k-domain batch almost every domain is rejected in the first phase, and
 * the second phase's queries are never issued for it.
 *
 * Both phases are pure functions: the caller gathers the data, which keeps the whole policy
 * unit-testable and the money rules readable in one list.
 */

export interface TrafficGateCounters {
  /** Paid lookups already billed in the current UTC day. */
  lookupsToday: number;
  /** Paid lookups already billed in the current UTC month. */
  lookupsThisMonth: number;
  /** Paid lookups already billed for the source batch of this run (null when not a batch run). */
  lookupsInBatch: number | null;
  /** USD already spent with the provider in the current UTC month. */
  costThisMonthUsd: number;
}

export interface TrafficQualificationInput {
  settings: TrafficGateSettings;
  /** Latest observations for the domain (lexical, dns, http, internal). */
  metrics: MetricContext;
  domain: { asciiFqdn: string; tld: string };
  candidateGatePassed: boolean | null;
  /** `describeStatus().state` of the provider: only "ready" may spend. */
  providerState: string;
}

export interface TrafficBudgetInput {
  settings: TrafficGateSettings;
  counters: TrafficGateCounters;
  /** Ceiling from the environment / provider registry, in USD. null = none. */
  envMonthlyCostBudgetUsd: number | null;
  /** Conservative price of the call we are about to make. */
  estimatedCallCostUsd: number;
  /** Provider account balance in USD, when it was looked up (the check is opt-in). */
  accountBalanceUsd?: number | null;
}

export interface TrafficGateInput extends TrafficQualificationInput, TrafficBudgetInput {
  /**
   * Analyst asked for this lookup explicitly (force deep analysis).
   * Skips the qualification checks — never the money checks.
   */
  forced: boolean;
}

export interface TrafficGateCheck {
  key: string;
  passed: boolean;
  detail: string;
}

export interface TrafficGateDecision {
  eligible: boolean;
  /** Stable code of the first failing check, for metrics and the usage dashboard. */
  blockedBy: string | null;
  reasons: string[];
  checks: TrafficGateCheck[];
}

/** Checks that only protect money. They apply even to analyst-forced lookups. */
const MONEY_CHECKS = new Set([
  "provider_state",
  "batch_cap",
  "daily_cap",
  "monthly_cap",
  "monthly_budget",
  "account_balance",
]);

/** Phase 1 — name shape and network evidence. Uses only already-loaded observations. */
export function evaluateTrafficQualification(
  input: TrafficQualificationInput,
): TrafficGateCheck[] {
  const { settings, metrics, domain } = input;
  const checks: TrafficGateCheck[] = [];
  const add = (key: string, passed: boolean, detail: string): void => {
    checks.push({ key, passed, detail });
  };

  add("provider_state", input.providerState === "ready", `provider state: ${input.providerState}`);
  add(
    "gate_enabled",
    settings.enabled,
    settings.enabled
      ? "automatic lookups enabled"
      : "automatic lookups disabled (only forced lookups run)",
  );

  // --- Name shape (lexical provider, free) --------------------------------------------------
  const digits = measuredNumeric(metrics, METRICS.LEXICAL_DIGIT_COUNT);
  add(
    "max_digits",
    digits !== null && digits <= settings.maxDigits,
    digits === null
      ? "digit count not measured"
      : `${digits} digit(s), limit ${settings.maxDigits}`,
  );

  const hyphens = measuredNumeric(metrics, METRICS.LEXICAL_HYPHEN_COUNT);
  add(
    "max_hyphens",
    hyphens !== null && hyphens <= settings.maxHyphens,
    hyphens === null
      ? "hyphen count not measured"
      : `${hyphens} hyphen(s), limit ${settings.maxHyphens}`,
  );

  const sldLength = measuredNumeric(metrics, METRICS.LEXICAL_SLD_LENGTH);
  add(
    "sld_length",
    sldLength !== null && sldLength >= settings.minSldLength && sldLength <= settings.maxSldLength,
    sldLength === null
      ? "SLD length not measured"
      : `${sldLength} chars, allowed ${settings.minSldLength}..${settings.maxSldLength}`,
  );

  const randomness = measuredNumeric(metrics, METRICS.LEXICAL_RANDOMNESS_SCORE);
  add(
    "randomness",
    randomness !== null && randomness <= settings.maxRandomness,
    randomness === null
      ? "randomness not measured"
      : `${randomness}, limit ${settings.maxRandomness}`,
  );

  const punycode = measuredBoolean(metrics, METRICS.LEXICAL_IS_PUNYCODE) ?? false;
  add(
    "punycode",
    settings.allowPunycode || !punycode,
    punycode ? "IDN / punycode name" : "ASCII name",
  );

  if (settings.requireDictionaryToken) {
    const hasToken = measuredBoolean(metrics, METRICS.LEXICAL_HAS_DICTIONARY_TOKEN);
    add(
      "dictionary_token",
      hasToken === true,
      hasToken === null ? "dictionary match not measured" : `dictionary token: ${hasToken}`,
    );
  }

  if (settings.allowedTlds.length > 0) {
    const tld = domain.tld.toLowerCase();
    const allowed = settings.allowedTlds.map((t) => t.toLowerCase().replace(/^\./, ""));
    add("allowed_tld", allowed.includes(tld), `.${tld} against [${allowed.join(", ")}]`);
  }

  // --- Network evidence (DNS + isolated crawler, free) --------------------------------------
  if (settings.requireDnsResolution) {
    const resolves = measuredBoolean(metrics, METRICS.DNS_RESOLVES);
    add(
      "dns_resolution",
      resolves === true,
      resolves === null ? "DNS not measured" : `resolves: ${resolves}`,
    );
  }
  if (settings.requireHttpReachable) {
    const reachable = measuredBoolean(metrics, METRICS.HTTP_REACHABLE);
    add(
      "http_reachable",
      reachable === true,
      reachable === null ? "HTTP not measured" : `reachable: ${reachable}`,
    );
  }
  if (settings.allowedHttpStatuses.length > 0) {
    const status = measuredNumeric(metrics, METRICS.HTTP_STATUS);
    add(
      "http_status",
      status !== null && settings.allowedHttpStatuses.includes(status),
      status === null
        ? "HTTP status not measured"
        : `${status} against [${settings.allowedHttpStatuses.join(", ")}]`,
    );
  }
  if (settings.requireCandidateGate) {
    add(
      "candidate_gate",
      input.candidateGatePassed === true,
      `candidate gate: ${input.candidateGatePassed ?? "not evaluated"}`,
    );
  }
  return checks;
}

/** Phase 2 — volume and money caps, from our own ledger and the free balance endpoint. */
export function evaluateTrafficBudget(input: TrafficBudgetInput): TrafficGateCheck[] {
  const { settings, counters } = input;
  const checks: TrafficGateCheck[] = [];
  const add = (key: string, passed: boolean, detail: string): void => {
    checks.push({ key, passed, detail });
  };

  if (settings.maxLookupsPerBatch !== null && counters.lookupsInBatch !== null) {
    add(
      "batch_cap",
      counters.lookupsInBatch < settings.maxLookupsPerBatch,
      `${counters.lookupsInBatch}/${settings.maxLookupsPerBatch} lookups in this batch`,
    );
  }
  if (settings.maxLookupsPerDay !== null) {
    add(
      "daily_cap",
      counters.lookupsToday < settings.maxLookupsPerDay,
      `${counters.lookupsToday}/${settings.maxLookupsPerDay} lookups today`,
    );
  }
  if (settings.maxLookupsPerMonth !== null) {
    add(
      "monthly_cap",
      counters.lookupsThisMonth < settings.maxLookupsPerMonth,
      `${counters.lookupsThisMonth}/${settings.maxLookupsPerMonth} lookups this month`,
    );
  }

  const budget = lowestBudget(settings.monthlyCostBudgetUsd, input.envMonthlyCostBudgetUsd);
  if (budget !== null) {
    const projected = counters.costThisMonthUsd + input.estimatedCallCostUsd;
    add(
      "monthly_budget",
      projected <= budget,
      `US$ ${round(counters.costThisMonthUsd)} spent + US$ ${round(input.estimatedCallCostUsd)} ` +
        `estimated, budget US$ ${round(budget)}`,
    );
  }
  if (settings.minAccountBalanceUsd > 0) {
    const balance = input.accountBalanceUsd;
    add(
      "account_balance",
      typeof balance === "number" && balance >= settings.minAccountBalanceUsd,
      typeof balance === "number"
        ? `US$ ${round(balance)} available, minimum US$ ${round(settings.minAccountBalanceUsd)}`
        : "account balance unavailable",
    );
  }
  return checks;
}

/**
 * Turns a list of checks into a decision. A forced lookup only has to satisfy the money checks;
 * the qualification checks are still reported so the skip reason stays auditable.
 */
export function decideTrafficGate(
  checks: TrafficGateCheck[],
  options: { forced: boolean },
): TrafficGateDecision {
  const applicable = options.forced ? checks.filter((c) => MONEY_CHECKS.has(c.key)) : checks;
  const failed = applicable.filter((c) => !c.passed);
  return {
    eligible: failed.length === 0,
    blockedBy: failed[0]?.key ?? null,
    reasons: failed.length
      ? failed.map((c) => `${c.key}: ${c.detail}`)
      : [
          options.forced
            ? "forced by analyst; money caps passed"
            : `${applicable.length} qualification checks passed`,
        ],
    checks,
  };
}

/** Both phases at once. Convenient for tests and for any caller that already has the counters. */
export function evaluateTrafficGate(input: TrafficGateInput): TrafficGateDecision {
  return decideTrafficGate(
    [...evaluateTrafficQualification(input), ...evaluateTrafficBudget(input)],
    { forced: input.forced },
  );
}

/** The strictest of the DB setting and the environment/provider ceiling wins. */
export function lowestBudget(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

const round = (v: number): number => Math.round(v * 100) / 100;
