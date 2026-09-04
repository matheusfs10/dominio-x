import type { AuthorityGateSettings, Disposition } from "@dominio-x/contracts";
import type { MetricContext } from "@dominio-x/rule-engine";
import {
  CheckList,
  decideGate,
  nameShapeChecks,
  networkEvidenceChecks,
  roundUsd,
  strictestBudget,
  volumeChecks,
  type GateCheck,
  type GateCounters,
  type GateDecision,
} from "./gate.js";

/**
 * Free qualification gate for the paid authority provider (Ahrefs Domain Rating).
 *
 * The stage runs *after* the rule engine, which is the whole point of the gate: by the time a
 * domain gets here the platform already knows its automatic disposition and its score, so the
 * cheapest and strongest filter available is "did the rules accept it?". Everything else —
 * name shape, network evidence, volume and money caps — is the same cheap-first policy the
 * traffic gate applies, evaluated from evidence that cost nothing.
 *
 * The checks are split in two phases so the caller can bail out early: `qualification` needs
 * only observations the pipeline already loaded, while `budget` needs ledger aggregates and
 * possibly a balance lookup. On a large batch almost every domain is rejected in the first
 * phase, and the second phase's queries are never issued for it.
 */

export type AuthorityGateCounters = GateCounters;
export type AuthorityGateCheck = GateCheck;
export type AuthorityGateDecision = GateDecision;

export interface AuthorityQualificationInput {
  settings: AuthorityGateSettings;
  /** Latest observations for the domain (lexical, dns, http, internal). */
  metrics: MetricContext;
  domain: { asciiFqdn: string; tld: string };
  candidateGatePassed: boolean | null;
  /** Automatic disposition produced by the `rules` stage of this run. */
  disposition: Disposition | null;
  /** Overall score of this run, when the score stage has already produced one. */
  overallScore: number | null;
  /** `describeStatus().state` of the provider: only "ready" may spend. */
  providerState: string;
}

export interface AuthorityBudgetInput {
  settings: AuthorityGateSettings;
  counters: AuthorityGateCounters;
  /** Ceiling from the environment / provider registry, in USD. null = none. */
  envMonthlyCostBudgetUsd: number | null;
  /** Conservative price of the lookup we are about to make (one captcha solve). */
  estimatedCallCostUsd: number;
  /** Captcha-solver balance in USD, when it was looked up (the check is opt-in). */
  solverBalanceUsd?: number | null;
}

export interface AuthorityGateInput extends AuthorityQualificationInput, AuthorityBudgetInput {
  /**
   * Analyst asked for this lookup explicitly (force deep analysis).
   * Skips the qualification checks — never the money checks.
   */
  forced: boolean;
}

/** Checks that only protect money. They apply even to analyst-forced lookups. */
const MONEY_CHECKS: ReadonlySet<string> = new Set([
  "provider_state",
  "batch_cap",
  "daily_cap",
  "monthly_cap",
  "monthly_budget",
  "solver_balance",
]);

/** Phase 1 — rule outcome, name shape and network evidence. All from loaded observations. */
export function evaluateAuthorityQualification(
  input: AuthorityQualificationInput,
): AuthorityGateCheck[] {
  const { settings } = input;
  const list = new CheckList();

  list.add(
    "provider_state",
    input.providerState === "ready",
    `provider state: ${input.providerState}`,
  );
  list.add(
    "gate_enabled",
    settings.enabled,
    settings.enabled
      ? "automatic lookups enabled"
      : "automatic lookups disabled (only forced lookups run)",
  );

  // --- Rule engine outcome (free: the `rules` stage of this run already produced it) --------
  if (settings.allowedDispositions.length > 0) {
    list.add(
      "disposition",
      input.disposition !== null && settings.allowedDispositions.includes(input.disposition),
      input.disposition === null
        ? "no automatic disposition on this run"
        : `${input.disposition} against [${settings.allowedDispositions.join(", ")}]`,
    );
  }
  if (settings.requireCandidateGate) {
    list.add(
      "candidate_gate",
      input.candidateGatePassed === true,
      `candidate gate: ${input.candidateGatePassed ?? "not evaluated"}`,
    );
  }
  if (settings.minOverallScore !== null) {
    list.add(
      "min_overall_score",
      input.overallScore !== null && input.overallScore >= settings.minOverallScore,
      input.overallScore === null
        ? "no overall score yet"
        : `${input.overallScore}, minimum ${settings.minOverallScore}`,
    );
  }

  return [
    ...list.checks,
    ...nameShapeChecks(settings, input.metrics, input.domain),
    ...networkEvidenceChecks(settings, input.metrics),
  ];
}

/** Phase 2 — volume and money caps, from our own ledger and the solver's free balance call. */
export function evaluateAuthorityBudget(input: AuthorityBudgetInput): AuthorityGateCheck[] {
  const { settings, counters } = input;
  const list = new CheckList();

  const budget = strictestBudget(settings.monthlyCostBudgetUsd, input.envMonthlyCostBudgetUsd);
  if (budget !== null) {
    const projected = counters.costThisMonthUsd + input.estimatedCallCostUsd;
    list.add(
      "monthly_budget",
      projected <= budget,
      `US$ ${roundUsd(counters.costThisMonthUsd)} spent + US$ ${roundUsd(input.estimatedCallCostUsd)} ` +
        `estimated, budget US$ ${roundUsd(budget)}`,
    );
  }
  if (settings.minSolverBalanceUsd > 0) {
    const balance = input.solverBalanceUsd;
    list.add(
      "solver_balance",
      typeof balance === "number" && balance >= settings.minSolverBalanceUsd,
      typeof balance === "number"
        ? `US$ ${roundUsd(balance)} available, minimum US$ ${roundUsd(settings.minSolverBalanceUsd)}`
        : "captcha solver balance unavailable",
    );
  }
  return [...volumeChecks(settings, counters), ...list.checks];
}

/**
 * Turns a list of checks into a decision. A forced lookup only has to satisfy the money checks;
 * the qualification checks are still reported so the skip reason stays auditable.
 */
export function decideAuthorityGate(
  checks: AuthorityGateCheck[],
  options: { forced: boolean },
): AuthorityGateDecision {
  return decideGate(checks, { forced: options.forced, moneyChecks: MONEY_CHECKS });
}

/** Both phases at once. Convenient for tests and for any caller that already has the counters. */
export function evaluateAuthorityGate(input: AuthorityGateInput): AuthorityGateDecision {
  return decideAuthorityGate(
    [...evaluateAuthorityQualification(input), ...evaluateAuthorityBudget(input)],
    { forced: input.forced },
  );
}
