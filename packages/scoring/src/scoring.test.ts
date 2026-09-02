import { describe, expect, it } from "vitest";
import type { MetricContext } from "@dominio-x/rule-engine";
import { computeScores, parseScoreModel, type ScoreModelDefinition } from "./index.js";

const model: ScoreModelDefinition = parseScoreModel({
  id: "m1",
  version: 1,
  weightsJson: { name: 0.25, brand: 0.2, seo: 0.25, link: 0.1, history: 0.1, commercial: 0.1 },
  configJson: {},
});

const lexicalOnly: MetricContext = {
  "lexical.sld_length": { state: "measured", value: 4 },
  "lexical.digit_count": { state: "measured", value: 0 },
  "lexical.hyphen_count": { state: "measured", value: 0 },
  "lexical.vowel_ratio": { state: "measured", value: 0.5 },
  "lexical.randomness_score": { state: "measured", value: 0.2 },
  "lexical.repeated_char_max_run": { state: "measured", value: 1 },
  "lexical.is_punycode": { state: "measured", value: false },
  "lexical.is_com_br": { state: "measured", value: true },
  "lexical.has_dictionary_token": { state: "measured", value: true },
  "lexical.tokens": { state: "measured", value: ["cafe"] },
  "seo.organic_keywords": { state: "unknown", value: undefined },
};

describe("scoring v1", () => {
  it("scores a clean short name highly and explains it", () => {
    const r = computeScores(model, {
      metrics: lexicalOnly,
      ruleSummary: null,
      providers: [{ providerKey: "semrush", outcome: "decision_pending" }],
    });
    expect(r.scores.name).toBeGreaterThan(80);
    expect(r.scores.seo).toBeNull();
    expect(r.scores.link).toBeNull();
    expect(r.overallScore).toBeGreaterThan(50);
    expect(r.explanation.positive.some((p) => p.signal === "Very short SLD")).toBe(true);
    expect(
      r.explanation.missing.some((m) => m.dimension === "seo" && /standby/.test(m.reason)),
    ).toBe(true);
    expect(r.explanation.weightsApplied.seo).toBeUndefined();
  });

  it("renormalizes weights among measured dimensions", () => {
    const r = computeScores(model, { metrics: lexicalOnly, ruleSummary: null, providers: [] });
    const sum = Object.values(r.explanation.weightsApplied).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 1);
  });

  it("reduces confidence for missing dimensions, failures and skipped deep analysis", () => {
    const full = computeScores(model, { metrics: lexicalOnly, ruleSummary: null, providers: [] });
    const degraded = computeScores(model, {
      metrics: lexicalOnly,
      ruleSummary: null,
      providers: [{ providerKey: "dns", outcome: "failed", reason: "timeout" }],
      deepAnalysisSkipped: true,
    });
    expect(degraded.confidenceScore).toBeLessThan(full.confidenceScore);
    expect(degraded.explanation.confidenceFactors.map((f) => f.factor)).toContain(
      "deep_analysis_skipped",
    );
    expect(full.confidenceScore).toBeLessThan(100);
  });

  it("does not reward absence of risk data", () => {
    const r = computeScores(model, { metrics: lexicalOnly, ruleSummary: null, providers: [] });
    expect(r.scores.risk).toBe(10);
    expect(r.explanation.missing.some((m) => m.dimension === "risk")).toBe(true);
  });

  it("penalizes digits, hyphens and randomness", () => {
    const noisy: MetricContext = {
      ...lexicalOnly,
      "lexical.sld_length": { state: "measured", value: 18 },
      "lexical.digit_count": { state: "measured", value: 6 },
      "lexical.hyphen_count": { state: "measured", value: 3 },
      "lexical.randomness_score": { state: "measured", value: 0.9 },
      "lexical.has_dictionary_token": { state: "measured", value: false },
    };
    const r = computeScores(model, { metrics: noisy, ruleSummary: null, providers: [] });
    expect(r.scores.name).toBeLessThan(30);
    expect(r.scores.risk).toBeGreaterThan(30);
    expect(r.overallScore).toBeLessThan(40);
  });

  it("applies rule adjustments and zeroes acquisition for rejected domains", () => {
    const r = computeScores(model, {
      metrics: lexicalOnly,
      ruleSummary: {
        disposition: "rejected",
        dispositionReasons: ["BLACKLISTED"],
        scoreAdjustments: { name: -15 },
        scoreAdjustmentDetails: [{ dimension: "name", delta: -15, ruleKey: "x", reasonCode: "X" }],
        tags: [],
        candidateDecision: "deny",
        candidateReasons: [],
        warnings: [],
      },
      providers: [],
    });
    expect(r.scores.acquisition).toBe(0);
    expect(r.explanation.negative.some((n) => n.signal === "Rule x")).toBe(true);
  });

  it("uses seo evidence when measured", () => {
    const withSeo: MetricContext = {
      ...lexicalOnly,
      "seo.organic_keywords": { state: "measured", value: 1000 },
      "seo.estimated_organic_traffic": { state: "measured", value: 5000 },
      "links.referring_domains": { state: "measured", value: 100 },
    };
    const r = computeScores(model, {
      metrics: withSeo,
      ruleSummary: null,
      providers: [{ providerKey: "semrush", outcome: "measured" }],
    });
    expect(r.scores.seo).toBeGreaterThan(70);
    expect(r.scores.link).toBeGreaterThan(50);
    expect(r.explanation.weightsApplied.seo).toBeDefined();
  });

  it("returns nulls when nothing is measured", () => {
    const r = computeScores(model, { metrics: {}, ruleSummary: null, providers: [] });
    expect(r.scores.name).toBeNull();
    expect(r.overallScore).toBe(0);
    expect(r.confidenceScore).toBe(0);
  });
});
