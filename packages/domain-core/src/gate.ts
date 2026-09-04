import { METRICS } from "@dominio-x/contracts";
import type { MetricContext } from "@dominio-x/rule-engine";
import { measuredBoolean, measuredNumeric } from "./observations.js";

/**
 * Building blocks shared by the free qualification gates that sit in front of paid providers.
 *
 * Every check here is decided from evidence the platform already owns for nothing: lexical
 * analysis, DNS, the isolated crawler, the rule engine and our own request ledger. A domain
 * that fails an active check never reaches the provider, so it costs exactly zero.
 *
 * The functions are pure: the caller gathers the data, which keeps each gate's policy readable
 * as one list and unit-testable without a database.
 *
 * `traffic-gate.ts` is the earlier, provider-specific version of the same idea and still
 * carries its own copy of these checks; it should be migrated onto this module once the
 * DataForSEO work settles.
 */

export interface GateCheck {
  key: string;
  passed: boolean;
  detail: string;
}

export interface GateDecision {
  eligible: boolean;
  /** Stable code of the first failing check, for metrics and the usage dashboard. */
  blockedBy: string | null;
  reasons: string[];
  checks: GateCheck[];
}

/** Billed-lookup counters read from our own ledger. */
export interface GateCounters {
  /** Paid lookups already billed in the current UTC day. */
  lookupsToday: number;
  /** Paid lookups already billed in the current UTC month. */
  lookupsThisMonth: number;
  /** Paid lookups already billed for the source batch of this run (null when not a batch run). */
  lookupsInBatch: number | null;
  /** USD already spent with the provider in the current UTC month. */
  costThisMonthUsd: number;
}

/** Accumulator that keeps the check list readable at the call site. */
export class CheckList {
  readonly checks: GateCheck[] = [];
  add(key: string, passed: boolean, detail: string): void {
    this.checks.push({ key, passed, detail });
  }
}

export interface NameShapePolicy {
  maxDigits: number;
  maxHyphens: number;
  minSldLength: number;
  maxSldLength: number;
  maxRandomness: number;
  allowPunycode: boolean;
  requireDictionaryToken: boolean;
  /** Empty list = any TLD. */
  allowedTlds: string[];
}

/**
 * Name shape, from the free lexical provider. A metric that was never measured fails its
 * check: "unknown" is not "within the limit".
 */
export function nameShapeChecks(
  policy: NameShapePolicy,
  metrics: MetricContext,
  domain: { tld: string },
): GateCheck[] {
  const list = new CheckList();

  const digits = measuredNumeric(metrics, METRICS.LEXICAL_DIGIT_COUNT);
  list.add(
    "max_digits",
    digits !== null && digits <= policy.maxDigits,
    digits === null ? "digit count not measured" : `${digits} digit(s), limit ${policy.maxDigits}`,
  );

  const hyphens = measuredNumeric(metrics, METRICS.LEXICAL_HYPHEN_COUNT);
  list.add(
    "max_hyphens",
    hyphens !== null && hyphens <= policy.maxHyphens,
    hyphens === null
      ? "hyphen count not measured"
      : `${hyphens} hyphen(s), limit ${policy.maxHyphens}`,
  );

  const sldLength = measuredNumeric(metrics, METRICS.LEXICAL_SLD_LENGTH);
  list.add(
    "sld_length",
    sldLength !== null && sldLength >= policy.minSldLength && sldLength <= policy.maxSldLength,
    sldLength === null
      ? "SLD length not measured"
      : `${sldLength} chars, allowed ${policy.minSldLength}..${policy.maxSldLength}`,
  );

  const randomness = measuredNumeric(metrics, METRICS.LEXICAL_RANDOMNESS_SCORE);
  list.add(
    "randomness",
    randomness !== null && randomness <= policy.maxRandomness,
    randomness === null
      ? "randomness not measured"
      : `${randomness}, limit ${policy.maxRandomness}`,
  );

  const punycode = measuredBoolean(metrics, METRICS.LEXICAL_IS_PUNYCODE) ?? false;
  list.add(
    "punycode",
    policy.allowPunycode || !punycode,
    punycode ? "IDN / punycode name" : "ASCII name",
  );

  if (policy.requireDictionaryToken) {
    const hasToken = measuredBoolean(metrics, METRICS.LEXICAL_HAS_DICTIONARY_TOKEN);
    list.add(
      "dictionary_token",
      hasToken === true,
      hasToken === null ? "dictionary match not measured" : `dictionary token: ${hasToken}`,
    );
  }

  if (policy.allowedTlds.length > 0) {
    const tld = domain.tld.toLowerCase();
    const allowed = policy.allowedTlds.map((t) => t.toLowerCase().replace(/^\./, ""));
    list.add("allowed_tld", allowed.includes(tld), `.${tld} against [${allowed.join(", ")}]`);
  }
  return list.checks;
}

export interface NetworkEvidencePolicy {
  requireDnsResolution: boolean;
  requireHttpReachable: boolean;
  /** Empty list = any status. */
  allowedHttpStatuses: number[];
}

/** Network evidence, from DNS and the isolated crawler. Both are free. */
export function networkEvidenceChecks(
  policy: NetworkEvidencePolicy,
  metrics: MetricContext,
): GateCheck[] {
  const list = new CheckList();
  if (policy.requireDnsResolution) {
    const resolves = measuredBoolean(metrics, METRICS.DNS_RESOLVES);
    list.add(
      "dns_resolution",
      resolves === true,
      resolves === null ? "DNS not measured" : `resolves: ${resolves}`,
    );
  }
  if (policy.requireHttpReachable) {
    const reachable = measuredBoolean(metrics, METRICS.HTTP_REACHABLE);
    list.add(
      "http_reachable",
      reachable === true,
      reachable === null ? "HTTP not measured" : `reachable: ${reachable}`,
    );
  }
  if (policy.allowedHttpStatuses.length > 0) {
    const status = measuredNumeric(metrics, METRICS.HTTP_STATUS);
    list.add(
      "http_status",
      status !== null && policy.allowedHttpStatuses.includes(status),
      status === null
        ? "HTTP status not measured"
        : `${status} against [${policy.allowedHttpStatuses.join(", ")}]`,
    );
  }
  return list.checks;
}

export interface VolumePolicy {
  maxLookupsPerBatch: number | null;
  maxLookupsPerDay: number | null;
  maxLookupsPerMonth: number | null;
}

/** Volume caps, from our own ledger. */
export function volumeChecks(policy: VolumePolicy, counters: GateCounters): GateCheck[] {
  const list = new CheckList();
  if (policy.maxLookupsPerBatch !== null && counters.lookupsInBatch !== null) {
    list.add(
      "batch_cap",
      counters.lookupsInBatch < policy.maxLookupsPerBatch,
      `${counters.lookupsInBatch}/${policy.maxLookupsPerBatch} lookups in this batch`,
    );
  }
  if (policy.maxLookupsPerDay !== null) {
    list.add(
      "daily_cap",
      counters.lookupsToday < policy.maxLookupsPerDay,
      `${counters.lookupsToday}/${policy.maxLookupsPerDay} lookups today`,
    );
  }
  if (policy.maxLookupsPerMonth !== null) {
    list.add(
      "monthly_cap",
      counters.lookupsThisMonth < policy.maxLookupsPerMonth,
      `${counters.lookupsThisMonth}/${policy.maxLookupsPerMonth} lookups this month`,
    );
  }
  return list.checks;
}

/**
 * Turns a list of checks into a decision. `moneyChecks` names the checks that protect spending:
 * an analyst-forced lookup skips everything else, but never those.
 */
export function decideGate(
  checks: GateCheck[],
  options: { forced: boolean; moneyChecks: ReadonlySet<string> },
): GateDecision {
  const applicable = options.forced ? checks.filter((c) => options.moneyChecks.has(c.key)) : checks;
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

/** The strictest of the DB setting and the environment/provider ceiling wins. */
export function strictestBudget(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

export const roundUsd = (v: number): number => Math.round(v * 10000) / 10000;
