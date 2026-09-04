import { describe, expect, it } from "vitest";
import { METRICS, trafficGateSettingsSchema } from "@dominio-x/contracts";
import type { MetricContext } from "@dominio-x/rule-engine";
import { evaluateTrafficGate, lowestBudget, type TrafficGateInput } from "./traffic-gate.js";

const measured = (value: number | boolean | string) => ({ state: "measured" as const, value });

/** A domain that qualifies under the seeded defaults: short, clean, resolving. */
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

function input(overrides: Partial<TrafficGateInput> = {}): TrafficGateInput {
  return {
    settings: trafficGateSettingsSchema.parse({ enabled: true }),
    metrics: goodMetrics(),
    domain: { asciiFqdn: "cafe.com.br", tld: "com.br" },
    candidateGatePassed: true,
    forced: false,
    providerState: "ready",
    counters: {
      lookupsToday: 0,
      lookupsThisMonth: 0,
      lookupsInBatch: 0,
      costThisMonthUsd: 0,
    },
    envMonthlyCostBudgetUsd: null,
    estimatedCallCostUsd: 0.02,
    accountBalanceUsd: null,
    ...overrides,
  };
}

describe("evaluateTrafficGate", () => {
  it("qualifies a short clean resolving domain", () => {
    const decision = evaluateTrafficGate(input());
    expect(decision.eligible).toBe(true);
    expect(decision.blockedBy).toBeNull();
  });

  it("refuses a domain with digits, which is the whole point of the gate", () => {
    const decision = evaluateTrafficGate(
      input({ metrics: goodMetrics({ [METRICS.LEXICAL_DIGIT_COUNT]: measured(3) }) }),
    );
    expect(decision.eligible).toBe(false);
    expect(decision.blockedBy).toBe("max_digits");
    expect(decision.reasons[0]).toContain("3 digit(s), limit 0");
  });

  it("honours a raised digit allowance", () => {
    const settings = trafficGateSettingsSchema.parse({ enabled: true, maxDigits: 3 });
    const decision = evaluateTrafficGate(
      input({ settings, metrics: goodMetrics({ [METRICS.LEXICAL_DIGIT_COUNT]: measured(3) }) }),
    );
    expect(decision.eligible).toBe(true);
  });

  it("treats an unmeasured signal as a failure, never as a zero", () => {
    const metrics = goodMetrics();
    delete metrics[METRICS.LEXICAL_DIGIT_COUNT];
    const decision = evaluateTrafficGate(input({ metrics }));
    expect(decision.eligible).toBe(false);
    expect(decision.blockedBy).toBe("max_digits");
    expect(decision.reasons[0]).toContain("not measured");
  });

  it("does not spend while the automatic lookup is switched off", () => {
    const settings = trafficGateSettingsSchema.parse({ enabled: false });
    expect(evaluateTrafficGate(input({ settings })).blockedBy).toBe("gate_enabled");
  });

  it("blocks every check when the provider is not ready", () => {
    expect(evaluateTrafficGate(input({ providerState: "not_configured" })).blockedBy).toBe(
      "provider_state",
    );
    expect(
      evaluateTrafficGate(input({ providerState: "disabled_in_registry", forced: true })).blockedBy,
    ).toBe("provider_state");
  });

  it("requires DNS evidence and the candidate gate by default", () => {
    expect(
      evaluateTrafficGate(
        input({ metrics: goodMetrics({ [METRICS.DNS_RESOLVES]: measured(false) }) }),
      ).blockedBy,
    ).toBe("dns_resolution");
    expect(evaluateTrafficGate(input({ candidateGatePassed: false })).blockedBy).toBe(
      "candidate_gate",
    );
  });

  it("filters by TLD", () => {
    expect(
      evaluateTrafficGate(input({ domain: { asciiFqdn: "cafe.xyz", tld: "xyz" } })).blockedBy,
    ).toBe("allowed_tld");
    const settings = trafficGateSettingsSchema.parse({ enabled: true, allowedTlds: [] });
    expect(
      evaluateTrafficGate(
        input({ settings, domain: { asciiFqdn: "cafe.xyz", tld: "xyz" } }),
      ).eligible,
    ).toBe(true);
  });

  it("stops at the batch, daily and monthly call caps", () => {
    const settings = trafficGateSettingsSchema.parse({
      enabled: true,
      maxLookupsPerBatch: 10,
      maxLookupsPerDay: 20,
      maxLookupsPerMonth: 30,
    });
    const at = (counters: Partial<TrafficGateInput["counters"]>) =>
      evaluateTrafficGate(
        input({ settings, counters: { ...input().counters, ...counters } }),
      ).blockedBy;
    expect(at({ lookupsInBatch: 10 })).toBe("batch_cap");
    expect(at({ lookupsToday: 20 })).toBe("daily_cap");
    expect(at({ lookupsThisMonth: 30 })).toBe("monthly_cap");
    expect(at({ lookupsInBatch: 9, lookupsToday: 19, lookupsThisMonth: 29 })).toBeNull();
  });

  it("stops before the projected spend crosses the monthly budget", () => {
    const settings = trafficGateSettingsSchema.parse({ enabled: true, monthlyCostBudgetUsd: 1 });
    const counters = { ...input().counters, costThisMonthUsd: 0.99 };
    expect(evaluateTrafficGate(input({ settings, counters, estimatedCallCostUsd: 0.02 })).blockedBy)
      .toBe("monthly_budget");
    expect(
      evaluateTrafficGate(input({ settings, counters, estimatedCallCostUsd: 0.01 })).eligible,
    ).toBe(true);
  });

  it("lets the environment ceiling lower the setting, never raise it", () => {
    const settings = trafficGateSettingsSchema.parse({ enabled: true, monthlyCostBudgetUsd: 100 });
    const counters = { ...input().counters, costThisMonthUsd: 5 };
    expect(
      evaluateTrafficGate(input({ settings, counters, envMonthlyCostBudgetUsd: 5 })).blockedBy,
    ).toBe("monthly_budget");
    expect(lowestBudget(100, 5)).toBe(5);
    expect(lowestBudget(null, 5)).toBe(5);
    expect(lowestBudget(5, null)).toBe(5);
    expect(lowestBudget(null, null)).toBeNull();
  });

  it("blocks when the account balance is below the floor", () => {
    const settings = trafficGateSettingsSchema.parse({
      enabled: true,
      minAccountBalanceUsd: 10,
    });
    expect(evaluateTrafficGate(input({ settings, accountBalanceUsd: 4 })).blockedBy).toBe(
      "account_balance",
    );
    expect(evaluateTrafficGate(input({ settings, accountBalanceUsd: null })).blockedBy).toBe(
      "account_balance",
    );
    expect(evaluateTrafficGate(input({ settings, accountBalanceUsd: 40 })).eligible).toBe(true);
  });

  it("lets an analyst override the qualification checks but never the money caps", () => {
    const noisy = goodMetrics({
      [METRICS.LEXICAL_DIGIT_COUNT]: measured(9),
      [METRICS.DNS_RESOLVES]: measured(false),
    });
    const forced = evaluateTrafficGate(
      input({ metrics: noisy, candidateGatePassed: false, forced: true }),
    );
    expect(forced.eligible).toBe(true);
    expect(forced.checks.some((c) => c.key === "max_digits" && !c.passed)).toBe(true);

    const settings = trafficGateSettingsSchema.parse({ enabled: true, maxLookupsPerDay: 1 });
    const broke = evaluateTrafficGate(
      input({
        settings,
        metrics: noisy,
        forced: true,
        counters: { ...input().counters, lookupsToday: 1 },
      }),
    );
    expect(broke.eligible).toBe(false);
    expect(broke.blockedBy).toBe("daily_cap");
  });

  it("always reports every check so the decision can be audited", () => {
    const decision = evaluateTrafficGate(input());
    const keys = decision.checks.map((c) => c.key);
    expect(keys).toContain("max_digits");
    expect(keys).toContain("allowed_tld");
    expect(keys).toContain("dns_resolution");
    expect(keys).toContain("monthly_budget");
  });
});
