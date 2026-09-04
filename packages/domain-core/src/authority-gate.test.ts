import { describe, expect, it } from "vitest";
import { authorityGateSettingsSchema, METRICS } from "@dominio-x/contracts";
import type { MetricContext } from "@dominio-x/rule-engine";
import { evaluateAuthorityGate, type AuthorityGateInput } from "./authority-gate.js";
import { strictestBudget } from "./gate.js";

const measured = (value: number | boolean | string) => ({ state: "measured" as const, value });

/** A domain that qualifies under the seeded defaults: short, clean, resolving, accepted. */
function goodMetrics(overrides: MetricContext = {}): MetricContext {
  return {
    [METRICS.LEXICAL_DIGIT_COUNT]: measured(0),
    [METRICS.LEXICAL_HYPHEN_COUNT]: measured(0),
    [METRICS.LEXICAL_SLD_LENGTH]: measured(4),
    [METRICS.LEXICAL_RANDOMNESS_SCORE]: measured(0.2),
    [METRICS.LEXICAL_IS_PUNYCODE]: measured(false),
    [METRICS.DNS_RESOLVES]: measured(true),
    [METRICS.HTTP_REACHABLE]: measured(true),
    [METRICS.HTTP_STATUS]: measured(200),
    ...overrides,
  };
}

function input(overrides: Partial<AuthorityGateInput> = {}): AuthorityGateInput {
  return {
    settings: authorityGateSettingsSchema.parse({ enabled: true }),
    metrics: goodMetrics(),
    domain: { asciiFqdn: "cafe.com.br", tld: "com.br" },
    candidateGatePassed: true,
    disposition: "accepted",
    overallScore: 80,
    forced: false,
    providerState: "ready",
    counters: {
      lookupsToday: 0,
      lookupsThisMonth: 0,
      lookupsInBatch: 0,
      costThisMonthUsd: 0,
    },
    envMonthlyCostBudgetUsd: null,
    estimatedCallCostUsd: 0.001,
    solverBalanceUsd: null,
    ...overrides,
  };
}

describe("evaluateAuthorityGate", () => {
  it("qualifies a short clean resolving domain the rules accepted", () => {
    const decision = evaluateAuthorityGate(input());
    expect(decision.eligible).toBe(true);
    expect(decision.blockedBy).toBeNull();
  });

  it("refuses a domain the rules did not accept", () => {
    const decision = evaluateAuthorityGate(input({ disposition: "rejected" }));
    expect(decision.eligible).toBe(false);
    expect(decision.blockedBy).toBe("disposition");
    expect(decision.reasons[0]).toContain("rejected");
  });

  it("refuses a run that produced no disposition at all", () => {
    const decision = evaluateAuthorityGate(input({ disposition: null }));
    expect(decision.eligible).toBe(false);
    expect(decision.blockedBy).toBe("disposition");
  });

  it("accepts any disposition once the list is emptied", () => {
    const settings = authorityGateSettingsSchema.parse({
      enabled: true,
      allowedDispositions: [],
    });
    expect(evaluateAuthorityGate(input({ settings, disposition: "quarantined" })).eligible).toBe(
      true,
    );
  });

  it("stays off until an operator enables it", () => {
    const settings = authorityGateSettingsSchema.parse({});
    const decision = evaluateAuthorityGate(input({ settings }));
    expect(settings.enabled).toBe(false);
    expect(decision.blockedBy).toBe("gate_enabled");
  });

  it("never spends while the provider is not ready", () => {
    const decision = evaluateAuthorityGate(input({ providerState: "solver_disabled" }));
    expect(decision.eligible).toBe(false);
    expect(decision.blockedBy).toBe("provider_state");
  });

  it("treats an unmeasured lexical value as a failure, not as a pass", () => {
    const metrics = goodMetrics();
    delete metrics[METRICS.LEXICAL_DIGIT_COUNT];
    const decision = evaluateAuthorityGate(input({ metrics }));
    expect(decision.eligible).toBe(false);
    expect(decision.blockedBy).toBe("max_digits");
    expect(decision.reasons[0]).toContain("not measured");
  });

  it("refuses a name outside the allowed TLDs", () => {
    const decision = evaluateAuthorityGate(
      input({ domain: { asciiFqdn: "cafe.xyz", tld: "xyz" } }),
    );
    expect(decision.blockedBy).toBe("allowed_tld");
  });

  it("refuses a domain that does not resolve", () => {
    const decision = evaluateAuthorityGate(
      input({ metrics: goodMetrics({ [METRICS.DNS_RESOLVES]: measured(false) }) }),
    );
    expect(decision.blockedBy).toBe("dns_resolution");
  });

  it("applies the minimum overall score only when one is configured", () => {
    const settings = authorityGateSettingsSchema.parse({ enabled: true, minOverallScore: 70 });
    expect(evaluateAuthorityGate(input({ settings, overallScore: 65 })).blockedBy).toBe(
      "min_overall_score",
    );
    expect(evaluateAuthorityGate(input({ settings, overallScore: 70 })).eligible).toBe(true);
    // No score yet is not "good enough".
    expect(evaluateAuthorityGate(input({ settings, overallScore: null })).blockedBy).toBe(
      "min_overall_score",
    );
  });

  it("stops at the daily cap", () => {
    const settings = authorityGateSettingsSchema.parse({ enabled: true, maxLookupsPerDay: 5 });
    const decision = evaluateAuthorityGate(
      input({
        settings,
        counters: {
          lookupsToday: 5,
          lookupsThisMonth: 5,
          lookupsInBatch: 0,
          costThisMonthUsd: 0,
        },
      }),
    );
    expect(decision.blockedBy).toBe("daily_cap");
  });

  it("stops before the projected spend exceeds the monthly budget", () => {
    const settings = authorityGateSettingsSchema.parse({
      enabled: true,
      monthlyCostBudgetUsd: 1,
    });
    const decision = evaluateAuthorityGate(
      input({
        settings,
        counters: {
          lookupsToday: 0,
          lookupsThisMonth: 0,
          lookupsInBatch: 0,
          costThisMonthUsd: 0.9995,
        },
        estimatedCallCostUsd: 0.001,
      }),
    );
    expect(decision.blockedBy).toBe("monthly_budget");
  });

  it("checks the solver balance only when a minimum is configured", () => {
    const off = authorityGateSettingsSchema.parse({ enabled: true });
    expect(evaluateAuthorityGate(input({ settings: off, solverBalanceUsd: 0 })).eligible).toBe(
      true,
    );
    const on = authorityGateSettingsSchema.parse({ enabled: true, minSolverBalanceUsd: 5 });
    expect(evaluateAuthorityGate(input({ settings: on, solverBalanceUsd: 1 })).blockedBy).toBe(
      "solver_balance",
    );
    // An unavailable balance is not treated as "enough credit".
    expect(evaluateAuthorityGate(input({ settings: on, solverBalanceUsd: null })).blockedBy).toBe(
      "solver_balance",
    );
  });

  it("lets an analyst force a lookup past the qualification checks", () => {
    const decision = evaluateAuthorityGate(
      input({ forced: true, disposition: "rejected", metrics: {} }),
    );
    expect(decision.eligible).toBe(true);
    // The failing checks are still reported so the decision stays auditable.
    expect(decision.checks.some((c) => c.key === "disposition" && !c.passed)).toBe(true);
  });

  it("never lets a forced lookup past the money caps", () => {
    const settings = authorityGateSettingsSchema.parse({
      enabled: true,
      monthlyCostBudgetUsd: 0,
    });
    const decision = evaluateAuthorityGate(input({ settings, forced: true }));
    expect(decision.eligible).toBe(false);
    expect(decision.blockedBy).toBe("monthly_budget");
  });
});

describe("strictestBudget", () => {
  it("takes the lower of the two ceilings and ignores the absent one", () => {
    expect(strictestBudget(10, 5)).toBe(5);
    expect(strictestBudget(null, 5)).toBe(5);
    expect(strictestBudget(10, null)).toBe(10);
    expect(strictestBudget(null, null)).toBeNull();
  });
});
