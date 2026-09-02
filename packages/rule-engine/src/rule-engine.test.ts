import { describe, expect, it } from "vitest";
import {
  compileRule,
  compileRuleset,
  conditionSchema,
  evaluateRule,
  evaluateRuleset,
  summarize,
  type MetricContext,
} from "./index.js";

const ctx: MetricContext = {
  "lexical.sld_length": { state: "measured", value: 6 },
  "lexical.digit_count": { state: "measured", value: 0 },
  "lexical.hyphen_count": { state: "measured", value: 1 },
  "lexical.tld": { state: "measured", value: "com.br" },
  "lexical.tokens": { state: "measured", value: ["cafe", "bom"] },
  "seo.organic_keywords": { state: "unknown", value: undefined },
  "dns.resolves": { state: "error", value: undefined },
};

function rule(key: string, condition: unknown, action: unknown = { type: "warn" }, priority = 100) {
  return {
    id: `id-${key}`,
    key,
    name: key,
    category: "custom",
    priority,
    enabled: true,
    reasonCode: key.toUpperCase().replace(/\W/g, "_"),
    condition,
    action,
  };
}

describe("rule DSL", () => {
  it("validates operators and value types", () => {
    expect(conditionSchema.safeParse({ metric: "a.b", op: "gt", value: "x" }).success).toBe(false);
    expect(conditionSchema.safeParse({ metric: "a.b", op: "in", value: 1 }).success).toBe(false);
    expect(conditionSchema.safeParse({ metric: "a.b", op: "exists" }).success).toBe(true);
    expect(conditionSchema.safeParse({ metric: "a.b", op: "eq" }).success).toBe(false);
    expect(conditionSchema.safeParse({ metric: "Bad Key", op: "eq", value: 1 }).success).toBe(
      false,
    );
  });

  it("rejects invalid / unsafe regexes", () => {
    expect(
      conditionSchema.safeParse({ metric: "a", op: "matches_safe_regex", value: "(" }).success,
    ).toBe(false);
    expect(
      conditionSchema.safeParse({ metric: "a", op: "matches_safe_regex", value: "(?<=x)y" })
        .success,
    ).toBe(false);
    expect(
      conditionSchema.safeParse({ metric: "a", op: "matches_safe_regex", value: "^(a+)+$" })
        .success,
    ).toBe(true);
  });

  it("rejects unknown action types and unknown keys", () => {
    expect(
      compileRule(rule("x", { metric: "a", op: "exists" }, { type: "explode" })).rule,
    ).toBeNull();
    expect(
      compileRule(rule("x", { metric: "a", op: "exists" }, { type: "reject", extra: 1 })).rule,
    ).toBeNull();
  });

  it("limits nesting depth", () => {
    let cond: unknown = { metric: "a", op: "exists" };
    for (let i = 0; i < 12; i++) cond = { not: cond };
    const r = compileRule(rule("deep", cond));
    expect(r.rule).toBeNull();
    expect(r.issues[0]?.message).toMatch(/depth/);
  });

  it("rejects duplicate keys in a ruleset", () => {
    const r = compileRuleset({
      id: "rs",
      version: 1,
      rules: [rule("a", { metric: "a", op: "exists" }), rule("a", { metric: "a", op: "exists" })],
    });
    expect(r.ruleset).toBeNull();
  });
});

describe("evaluation", () => {
  const compiled = (key: string, condition: unknown, action?: unknown) =>
    compileRule(rule(key, condition, action)).rule!;

  it("evaluates comparison operators", () => {
    expect(
      evaluateRule(compiled("a", { metric: "lexical.sld_length", op: "lte", value: 6 }), ctx)
        .matched,
    ).toBe(true);
    expect(
      evaluateRule(compiled("a", { metric: "lexical.sld_length", op: "lt", value: 6 }), ctx)
        .matched,
    ).toBe(false);
    expect(
      evaluateRule(compiled("a", { metric: "lexical.digit_count", op: "eq", value: 0 }), ctx)
        .matched,
    ).toBe(true);
    expect(
      evaluateRule(
        compiled("a", { metric: "lexical.tld", op: "in", value: ["com", "com.br"] }),
        ctx,
      ).matched,
    ).toBe(true);
    expect(
      evaluateRule(compiled("a", { metric: "lexical.tld", op: "ends_with", value: ".br" }), ctx)
        .matched,
    ).toBe(true);
    expect(
      evaluateRule(
        compiled("a", { metric: "lexical.tld", op: "matches_safe_regex", value: "^com\\." }),
        ctx,
      ).matched,
    ).toBe(true);
    expect(
      evaluateRule(compiled("a", { metric: "lexical.tokens", op: "contains", value: "cafe" }), ctx)
        .matched,
    ).toBe(true);
  });

  it("treats unknown/error metrics as non-matching, never as zero", () => {
    expect(
      evaluateRule(compiled("a", { metric: "seo.organic_keywords", op: "eq", value: 0 }), ctx)
        .matched,
    ).toBe(false);
    expect(
      evaluateRule(compiled("a", { metric: "seo.organic_keywords", op: "lte", value: 0 }), ctx)
        .matched,
    ).toBe(false);
    expect(
      evaluateRule(compiled("a", { metric: "seo.organic_keywords", op: "not_exists" }), ctx)
        .matched,
    ).toBe(true);
    expect(evaluateRule(compiled("a", { metric: "dns.resolves", op: "exists" }), ctx).matched).toBe(
      false,
    );
    expect(
      evaluateRule(compiled("a", { metric: "missing.metric", op: "neq", value: 1 }), ctx).matched,
    ).toBe(false);
  });

  it("supports boolean composition and records evidence", () => {
    const r = evaluateRule(
      compiled("c", {
        all: [
          { metric: "lexical.sld_length", op: "lte", value: 8 },
          {
            any: [
              { metric: "lexical.digit_count", op: "gt", value: 0 },
              { not: { metric: "lexical.hyphen_count", op: "eq", value: 0 } },
            ],
          },
        ],
      }),
      ctx,
    );
    expect(r.matched).toBe(true);
    expect(r.evidence.leaves.length).toBe(3);
    expect(r.evidence.leaves[0]).toMatchObject({
      metric: "lexical.sld_length",
      actual: 6,
      matched: true,
    });
  });

  it("summarizes actions into disposition, adjustments, tags and candidate decision", () => {
    const rs = compileRuleset({
      id: "rs",
      version: 3,
      rules: [
        rule(
          "penalty",
          { metric: "lexical.hyphen_count", op: "gte", value: 1 },
          { type: "score_adjustment", dimension: "name", delta: -10 },
          100,
        ),
        rule(
          "tag",
          { metric: "lexical.tld", op: "eq", value: "com.br" },
          { type: "tag", tag: "br" },
          100,
        ),
        rule(
          "review",
          { metric: "lexical.tokens", op: "exists" },
          { type: "warn", disposition: "needs_review" },
          100,
        ),
        rule(
          "allow",
          { metric: "lexical.sld_length", op: "lte", value: 8 },
          { type: "candidate_allow" },
          200,
        ),
        rule(
          "disabled",
          { metric: "lexical.sld_length", op: "lte", value: 8 },
          { type: "reject" },
          1,
        ),
      ],
    }).ruleset!;
    rs.rules.find((r) => r.key === "disabled")!.enabled = false;
    const evaluation = evaluateRuleset(rs, ctx);
    expect(evaluation.rulesetVersion).toBe(3);
    expect(evaluation.summary.disposition).toBe("needs_review");
    expect(evaluation.summary.scoreAdjustments.name).toBe(-10);
    expect(evaluation.summary.tags).toEqual(["br"]);
    expect(evaluation.summary.candidateDecision).toBe("allow");
    expect(evaluation.executions.find((e) => e.ruleKey === "disabled")?.matched).toBe(false);
  });

  it("reject wins and forces candidate deny", () => {
    const s = summarize([
      {
        ruleId: "1",
        ruleKey: "a",
        ruleName: "a",
        priority: 1,
        matched: true,
        action: { type: "candidate_allow" },
        reasonCode: "A",
        evidence: { leaves: [] },
      },
      {
        ruleId: "2",
        ruleKey: "b",
        ruleName: "b",
        priority: 1,
        matched: true,
        action: { type: "reject" },
        reasonCode: "B",
        evidence: { leaves: [] },
      },
    ]);
    expect(s.disposition).toBe("rejected");
    expect(s.candidateDecision).toBe("deny");
  });
});
