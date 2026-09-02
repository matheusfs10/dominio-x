import { z } from "zod";
import { METRICS, SCORE_DIMENSIONS, type ScoreDimension } from "@dominio-x/contracts";
import type { MetricContext, RuleSummary } from "@dominio-x/rule-engine";

/**
 * Transparent weighted scoring (model v1).
 *
 * Every dimension is either a number in 0..100 or `null` (not measurable with the available
 * evidence). Missing dimensions are never assumed to be zero: the overall score is
 * renormalized among the measured value dimensions and the confidence score is reduced.
 */

export const scoreWeightsSchema = z.object({
  name: z.number().min(0),
  brand: z.number().min(0),
  seo: z.number().min(0),
  link: z.number().min(0),
  history: z.number().min(0),
  commercial: z.number().min(0),
});
export type ScoreWeights = z.infer<typeof scoreWeightsSchema>;

export const scoreModelConfigSchema = z.object({
  riskPenaltyFactor: z.number().min(0).max(1).default(0.35),
  expectedDimensions: z
    .array(z.enum(SCORE_DIMENSIONS))
    .default(["name", "brand", "seo", "link", "history", "commercial", "risk"]),
});
export type ScoreModelConfig = z.infer<typeof scoreModelConfigSchema>;

export interface ScoreModelDefinition {
  id: string;
  version: number;
  weights: ScoreWeights;
  config: ScoreModelConfig;
}

export interface ProviderOutcome {
  providerKey: string;
  outcome: "measured" | "reused" | "skipped" | "failed" | "not_configured" | "decision_pending";
  reason?: string;
}

export interface ScoringInput {
  metrics: MetricContext;
  ruleSummary: RuleSummary | null;
  providers: ProviderOutcome[];
  /** True when the domain came from a registry release list (near-term acquirable). */
  fromReleaseList?: boolean;
  /** True when paid/deep analysis was intentionally skipped by the candidate gate. */
  deepAnalysisSkipped?: boolean;
}

export interface ExplanationItem {
  signal: string;
  impact: number;
  evidence: string;
  dimension?: ScoreDimension;
}
export interface MissingItem {
  signal: string;
  reason: string;
  dimension?: ScoreDimension;
}
export interface ScoreExplanation {
  positive: ExplanationItem[];
  negative: ExplanationItem[];
  missing: MissingItem[];
  confidenceFactors: { factor: string; impact: number; detail: string }[];
  weightsApplied: Partial<Record<keyof ScoreWeights, number>>;
  modelVersion: number;
}

export interface ScoreResult {
  scores: Record<ScoreDimension, number | null>;
  confidenceScore: number;
  overallScore: number;
  explanation: ScoreExplanation;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

function num(ctx: MetricContext, key: string): number | null {
  const m = ctx[key];
  return m && m.state === "measured" && typeof m.value === "number" ? m.value : null;
}
function bool(ctx: MetricContext, key: string): boolean | null {
  const m = ctx[key];
  return m && m.state === "measured" && typeof m.value === "boolean" ? m.value : null;
}
function measured(ctx: MetricContext, key: string): boolean {
  return ctx[key]?.state === "measured";
}

interface DimensionResult {
  score: number | null;
  positive: ExplanationItem[];
  negative: ExplanationItem[];
  missing: MissingItem[];
}

function nameDimension(ctx: MetricContext): DimensionResult {
  const positive: ExplanationItem[] = [];
  const negative: ExplanationItem[] = [];
  const sldLength = num(ctx, METRICS.LEXICAL_SLD_LENGTH);
  if (sldLength === null)
    return {
      score: null,
      positive,
      negative,
      missing: [
        { signal: "Lexical metrics", reason: "Lexical analysis not available", dimension: "name" },
      ],
    };

  let score = 50;
  if (sldLength <= 4) {
    positive.push({
      signal: "Very short SLD",
      impact: 30,
      evidence: `${sldLength} characters`,
      dimension: "name",
    });
    score += 30;
  } else if (sldLength <= 7) {
    positive.push({
      signal: "Short SLD",
      impact: 20,
      evidence: `${sldLength} characters`,
      dimension: "name",
    });
    score += 20;
  } else if (sldLength <= 10) {
    positive.push({
      signal: "Compact SLD",
      impact: 8,
      evidence: `${sldLength} characters`,
      dimension: "name",
    });
    score += 8;
  } else if (sldLength <= 15) {
    negative.push({
      signal: "Long SLD",
      impact: -8,
      evidence: `${sldLength} characters`,
      dimension: "name",
    });
    score -= 8;
  } else {
    negative.push({
      signal: "Very long SLD",
      impact: -20,
      evidence: `${sldLength} characters`,
      dimension: "name",
    });
    score -= 20;
  }

  const digits = num(ctx, METRICS.LEXICAL_DIGIT_COUNT) ?? 0;
  if (digits > 0) {
    const impact = -Math.min(25, 5 + digits * 4);
    negative.push({
      signal: "Digits in name",
      impact,
      evidence: `${digits} digit(s)`,
      dimension: "name",
    });
    score += impact;
  }
  const hyphens = num(ctx, METRICS.LEXICAL_HYPHEN_COUNT) ?? 0;
  if (hyphens > 0) {
    const impact = -Math.min(20, 6 * hyphens);
    negative.push({
      signal: "Hyphens in name",
      impact,
      evidence: `${hyphens} hyphen(s)`,
      dimension: "name",
    });
    score += impact;
  }
  const randomness = num(ctx, METRICS.LEXICAL_RANDOMNESS_SCORE);
  if (randomness !== null) {
    if (randomness >= 0.6) {
      const impact = -Math.round(30 * (randomness - 0.5));
      negative.push({
        signal: "Random-looking name",
        impact,
        evidence: `randomness ${randomness.toFixed(2)}`,
        dimension: "name",
      });
      score += impact;
    } else if (randomness <= 0.25) {
      positive.push({
        signal: "Pronounceable name",
        impact: 8,
        evidence: `randomness ${randomness.toFixed(2)}`,
        dimension: "name",
      });
      score += 8;
    }
  }
  const hasToken = bool(ctx, METRICS.LEXICAL_HAS_DICTIONARY_TOKEN);
  if (hasToken) {
    const tokens = ctx[METRICS.LEXICAL_TOKENS]?.value;
    positive.push({
      signal: "Recognizable word(s)",
      impact: 10,
      evidence: Array.isArray(tokens) ? tokens.join(", ") : "dictionary match",
      dimension: "name",
    });
    score += 10;
  }
  if (bool(ctx, METRICS.LEXICAL_IS_COM_BR)) {
    positive.push({
      signal: ".com.br namespace",
      impact: 5,
      evidence: "primary commercial namespace in Brazil",
      dimension: "name",
    });
    score += 5;
  }
  return { score: clamp(score), positive, negative, missing: [] };
}

function brandDimension(ctx: MetricContext): DimensionResult {
  const positive: ExplanationItem[] = [];
  const negative: ExplanationItem[] = [];
  const sldLength = num(ctx, METRICS.LEXICAL_SLD_LENGTH);
  const vowelRatio = num(ctx, METRICS.LEXICAL_VOWEL_RATIO);
  if (sldLength === null || vowelRatio === null) {
    return {
      score: null,
      positive,
      negative,
      missing: [
        {
          signal: "Brandability heuristics",
          reason: "Lexical analysis not available",
          dimension: "brand",
        },
      ],
    };
  }
  let score = 45;
  if (vowelRatio >= 0.3 && vowelRatio <= 0.6) {
    positive.push({
      signal: "Balanced vowel ratio",
      impact: 15,
      evidence: `vowel ratio ${vowelRatio.toFixed(2)}`,
      dimension: "brand",
    });
    score += 15;
  } else {
    negative.push({
      signal: "Unbalanced vowel ratio",
      impact: -10,
      evidence: `vowel ratio ${vowelRatio.toFixed(2)}`,
      dimension: "brand",
    });
    score -= 10;
  }
  if (sldLength >= 4 && sldLength <= 10) {
    positive.push({
      signal: "Brand-friendly length",
      impact: 15,
      evidence: `${sldLength} characters`,
      dimension: "brand",
    });
    score += 15;
  } else if (sldLength > 14) {
    negative.push({
      signal: "Too long for a brand",
      impact: -15,
      evidence: `${sldLength} characters`,
      dimension: "brand",
    });
    score -= 15;
  }
  if (
    (num(ctx, METRICS.LEXICAL_DIGIT_COUNT) ?? 0) === 0 &&
    (num(ctx, METRICS.LEXICAL_HYPHEN_COUNT) ?? 0) === 0
  ) {
    positive.push({
      signal: "Clean characters",
      impact: 10,
      evidence: "no digits or hyphens",
      dimension: "brand",
    });
    score += 10;
  } else {
    negative.push({
      signal: "Noisy characters",
      impact: -10,
      evidence: "contains digits or hyphens",
      dimension: "brand",
    });
    score -= 10;
  }
  const repeated = num(ctx, METRICS.LEXICAL_REPEATED_CHAR_MAX_RUN);
  if (repeated !== null && repeated >= 3) {
    negative.push({
      signal: "Repeated characters",
      impact: -10,
      evidence: `run of ${repeated}`,
      dimension: "brand",
    });
    score -= 10;
  }
  if (bool(ctx, METRICS.LEXICAL_IS_PUNYCODE)) {
    negative.push({
      signal: "IDN / punycode",
      impact: -10,
      evidence: "harder to type and share",
      dimension: "brand",
    });
    score -= 10;
  }
  return { score: clamp(score), positive, negative, missing: [] };
}

function seoDimension(ctx: MetricContext, providers: ProviderOutcome[]): DimensionResult {
  const positive: ExplanationItem[] = [];
  const negative: ExplanationItem[] = [];
  const keywords = num(ctx, METRICS.SEO_ORGANIC_KEYWORDS);
  const traffic = num(ctx, METRICS.SEO_ESTIMATED_ORGANIC_TRAFFIC);
  const authority = num(ctx, METRICS.SEO_AUTHORITY);
  if (keywords === null && traffic === null && authority === null) {
    const seoProvider = providers.find((p) => p.providerKey === "semrush");
    const reason =
      seoProvider?.outcome === "decision_pending"
        ? "SEO provider integration mode not yet decided (standby)"
        : seoProvider?.outcome === "not_configured"
          ? "SEO provider not configured"
          : seoProvider?.outcome === "skipped"
            ? `Deep analysis skipped: ${seoProvider.reason ?? "candidate gate"}`
            : seoProvider?.outcome === "failed"
              ? `SEO provider failed: ${seoProvider.reason ?? "error"}`
              : "No SEO provider evidence";
    return {
      score: null,
      positive,
      negative,
      missing: [{ signal: "SEO traffic / keywords", reason, dimension: "seo" }],
    };
  }
  let score = 0;
  if (keywords !== null) {
    const part = clamp(Math.log10(keywords + 1) * 25);
    score = Math.max(score, part);
    (keywords > 0 ? positive : negative).push({
      signal: "Organic keywords",
      impact: Math.round(part),
      evidence: `${keywords} keywords`,
      dimension: "seo",
    });
  }
  if (traffic !== null) {
    const part = clamp(Math.log10(traffic + 1) * 20);
    score = Math.max(score, part);
    (traffic > 0 ? positive : negative).push({
      signal: "Estimated organic traffic",
      impact: Math.round(part),
      evidence: `${traffic} visits/month`,
      dimension: "seo",
    });
  }
  if (authority !== null) {
    score = Math.max(score, authority);
    positive.push({
      signal: "Authority score",
      impact: Math.round(authority),
      evidence: `${authority}/100`,
      dimension: "seo",
    });
  }
  return { score: clamp(score), positive, negative, missing: [] };
}

function linkDimension(ctx: MetricContext): DimensionResult {
  const refDomains = num(ctx, METRICS.LINKS_REFERRING_DOMAINS);
  const backlinks = num(ctx, METRICS.LINKS_BACKLINKS);
  if (refDomains === null && backlinks === null) {
    return {
      score: null,
      positive: [],
      negative: [],
      missing: [
        { signal: "Backlink profile", reason: "No backlink provider evidence", dimension: "link" },
      ],
    };
  }
  const positive: ExplanationItem[] = [];
  let score = 0;
  if (refDomains !== null) {
    score = clamp(Math.log10(refDomains + 1) * 30);
    positive.push({
      signal: "Referring domains",
      impact: Math.round(score),
      evidence: `${refDomains} domains`,
      dimension: "link",
    });
  } else if (backlinks !== null) {
    score = clamp(Math.log10(backlinks + 1) * 20);
    positive.push({
      signal: "Backlinks",
      impact: Math.round(score),
      evidence: `${backlinks} backlinks`,
      dimension: "link",
    });
  }
  return { score, positive, negative: [], missing: [] };
}

function historyDimension(ctx: MetricContext): DimensionResult {
  const registration = ctx[METRICS.RDAP_REGISTRATION_DATE];
  if (
    !registration ||
    registration.state !== "measured" ||
    typeof registration.value !== "string"
  ) {
    return {
      score: null,
      positive: [],
      negative: [],
      missing: [
        {
          signal: "Registration history",
          reason: "RDAP not enabled or no registration date",
          dimension: "history",
        },
      ],
    };
  }
  const ageYears = (Date.now() - Date.parse(registration.value)) / (365.25 * 24 * 3600 * 1000);
  if (!Number.isFinite(ageYears)) {
    return {
      score: null,
      positive: [],
      negative: [],
      missing: [
        {
          signal: "Registration history",
          reason: "Unparseable registration date",
          dimension: "history",
        },
      ],
    };
  }
  const score = clamp(Math.min(ageYears, 20) * 5);
  return {
    score,
    positive: [
      {
        signal: "Domain age",
        impact: Math.round(score),
        evidence: `${ageYears.toFixed(1)} years`,
        dimension: "history",
      },
    ],
    negative: [],
    missing: [],
  };
}

function commercialDimension(ctx: MetricContext): DimensionResult {
  const hasToken = bool(ctx, METRICS.LEXICAL_HAS_DICTIONARY_TOKEN);
  const paidKeywords = num(ctx, METRICS.SEO_PAID_KEYWORDS);
  const paidTraffic = num(ctx, METRICS.SEO_ESTIMATED_PAID_TRAFFIC);
  const positive: ExplanationItem[] = [];
  if (paidKeywords === null && paidTraffic === null && !hasToken) {
    return {
      score: null,
      positive,
      negative: [],
      missing: [
        {
          signal: "Commercial intent",
          reason: "No paid-search evidence and no recognizable commercial term",
          dimension: "commercial",
        },
      ],
    };
  }
  let score = 0;
  if (hasToken) {
    score = 45;
    positive.push({
      signal: "Recognizable term",
      impact: 45,
      evidence: "dictionary token detected",
      dimension: "commercial",
    });
    if (bool(ctx, METRICS.LEXICAL_IS_COM_BR)) {
      score += 10;
      positive.push({
        signal: ".com.br",
        impact: 10,
        evidence: "commercial namespace",
        dimension: "commercial",
      });
    }
  }
  if (paidKeywords !== null && paidKeywords > 0) {
    const part = clamp(Math.log10(paidKeywords + 1) * 30);
    score = Math.max(score, part);
    positive.push({
      signal: "Paid keywords",
      impact: Math.round(part),
      evidence: `${paidKeywords} keywords`,
      dimension: "commercial",
    });
  }
  return { score: clamp(score), positive, negative: [], missing: [] };
}

function riskDimension(ctx: MetricContext): DimensionResult {
  const positive: ExplanationItem[] = [];
  const negative: ExplanationItem[] = [];
  const missing: MissingItem[] = [];
  if (!measured(ctx, METRICS.LEXICAL_SLD_LENGTH)) {
    return {
      score: null,
      positive,
      negative,
      missing: [{ signal: "Risk signals", reason: "No evidence measured", dimension: "risk" }],
    };
  }
  let risk = 10;
  if (bool(ctx, METRICS.HTTP_SECURITY_BLOCKED)) {
    negative.push({
      signal: "Crawler security block",
      impact: 60,
      evidence: "target refused by SSRF policy",
      dimension: "risk",
    });
    risk += 60;
  }
  if (bool(ctx, METRICS.LEXICAL_IS_PUNYCODE)) {
    negative.push({
      signal: "IDN / homograph potential",
      impact: 15,
      evidence: "punycode label",
      dimension: "risk",
    });
    risk += 15;
  }
  const randomness = num(ctx, METRICS.LEXICAL_RANDOMNESS_SCORE);
  if (randomness !== null && randomness >= 0.75) {
    negative.push({
      signal: "Random-looking (possible abuse pattern)",
      impact: 20,
      evidence: `randomness ${randomness.toFixed(2)}`,
      dimension: "risk",
    });
    risk += 20;
  }
  const digits = num(ctx, METRICS.LEXICAL_DIGIT_COUNT);
  if (digits !== null && digits >= 5) {
    negative.push({
      signal: "Many digits",
      impact: 10,
      evidence: `${digits} digits`,
      dimension: "risk",
    });
    risk += 10;
  }
  const blacklisted = bool(ctx, "internal.blacklisted");
  if (blacklisted) {
    negative.push({
      signal: "Internal blacklist",
      impact: 50,
      evidence: "matches analyst blacklist",
      dimension: "risk",
    });
    risk += 50;
  }
  if (!measured(ctx, "reputation.score"))
    missing.push({
      signal: "Reputation",
      reason: "No reputation provider configured (risk not fully checked)",
      dimension: "risk",
    });
  if (!measured(ctx, METRICS.HTTP_SECURITY_BLOCKED) && !measured(ctx, METRICS.HTTP_REACHABLE)) {
    missing.push({
      signal: "HTTP behavior",
      reason: "Crawler observation not available",
      dimension: "risk",
    });
  }
  return { score: clamp(risk), positive, negative, missing };
}

export function computeScores(model: ScoreModelDefinition, input: ScoringInput): ScoreResult {
  const { metrics, providers } = input;
  const dims: Record<ScoreDimension, DimensionResult> = {
    name: nameDimension(metrics),
    brand: brandDimension(metrics),
    seo: seoDimension(metrics, providers),
    link: linkDimension(metrics),
    history: historyDimension(metrics),
    commercial: commercialDimension(metrics),
    risk: riskDimension(metrics),
    acquisition: { score: null, positive: [], negative: [], missing: [] },
  };

  // Rule-driven adjustments (recorded, versioned, explainable).
  if (input.ruleSummary) {
    for (const adj of input.ruleSummary.scoreAdjustmentDetails) {
      const dim = dims[adj.dimension];
      if (dim.score === null) continue;
      dim.score = clamp(dim.score + adj.delta);
      (adj.delta >= 0 ? dim.positive : dim.negative).push({
        signal: `Rule ${adj.ruleKey}`,
        impact: adj.delta,
        evidence: adj.reasonCode,
        dimension: adj.dimension,
      });
    }
  }

  // Overall value score: renormalize weights among measured value dimensions.
  const valueDims = ["name", "brand", "seo", "link", "history", "commercial"] as const;
  let weightSum = 0;
  let weighted = 0;
  const weightsApplied: Partial<Record<keyof ScoreWeights, number>> = {};
  for (const d of valueDims) {
    const score = dims[d].score;
    if (score === null) continue;
    const w = model.weights[d];
    weightSum += w;
    weighted += w * score;
    weightsApplied[d] = w;
  }
  let overall = weightSum > 0 ? weighted / weightSum : 0;
  for (const d of Object.keys(weightsApplied) as (keyof ScoreWeights)[])
    weightsApplied[d] = Math.round((weightsApplied[d]! / weightSum) * 1000) / 1000;

  const risk = dims.risk.score;
  if (risk !== null) {
    const penalty = model.config.riskPenaltyFactor * Math.max(0, risk - 10);
    if (penalty > 0)
      dims.risk.negative.push({
        signal: "Risk penalty on overall",
        impact: -Math.round(penalty),
        evidence: `risk ${Math.round(risk)} × ${model.config.riskPenaltyFactor}`,
        dimension: "risk",
      });
    overall = clamp(overall - penalty);
  }

  // Acquisition: value net of risk, with a small boost for release-list domains.
  if (weightSum > 0) {
    let acq = overall;
    if (input.fromReleaseList) {
      acq = clamp(acq + 5);
      dims.acquisition.positive.push({
        signal: "On registry release list",
        impact: 5,
        evidence: "acquirable in the upcoming release process",
        dimension: "acquisition",
      });
    }
    if (input.ruleSummary?.disposition === "rejected") {
      acq = 0;
      dims.acquisition.negative.push({
        signal: "Rejected by rules",
        impact: -100,
        evidence: input.ruleSummary.dispositionReasons.join(", "),
        dimension: "acquisition",
      });
    }
    dims.acquisition.score = clamp(acq);
  } else {
    dims.acquisition.missing.push({
      signal: "Acquisition",
      reason: "No value dimension measured",
      dimension: "acquisition",
    });
  }

  // Confidence.
  const confidenceFactors: ScoreExplanation["confidenceFactors"] = [];
  const expected = model.config.expectedDimensions;
  const measuredCount = expected.filter((d) => dims[d].score !== null).length;
  const coverage = expected.length > 0 ? measuredCount / expected.length : 0;
  let confidence = 100 * coverage;
  confidenceFactors.push({
    factor: "dimension_coverage",
    impact: Math.round(100 * coverage - 100),
    detail: `${measuredCount}/${expected.length} expected dimensions measured`,
  });
  const failed = providers.filter((p) => p.outcome === "failed");
  if (failed.length > 0) {
    confidence -= 10 * failed.length;
    confidenceFactors.push({
      factor: "provider_failures",
      impact: -10 * failed.length,
      detail: failed.map((p) => `${p.providerKey}: ${p.reason ?? "failed"}`).join("; "),
    });
  }
  if (input.deepAnalysisSkipped) {
    confidence -= 10;
    confidenceFactors.push({
      factor: "deep_analysis_skipped",
      impact: -10,
      detail: "paid/deep analysis intentionally skipped by candidate gate",
    });
  }
  const reused = providers.filter((p) => p.outcome === "reused");
  if (reused.length > 0) {
    confidence -= 3 * reused.length;
    confidenceFactors.push({
      factor: "reused_observations",
      impact: -3 * reused.length,
      detail: `${reused.map((p) => p.providerKey).join(", ")} reused within TTL`,
    });
  }
  const dnsResolves = bool(metrics, METRICS.DNS_RESOLVES);
  const httpReachable = bool(metrics, METRICS.HTTP_REACHABLE);
  if (dnsResolves === false && httpReachable === true) {
    confidence -= 10;
    confidenceFactors.push({
      factor: "inconsistent_evidence",
      impact: -10,
      detail: "HTTP reachable but DNS did not resolve",
    });
  }
  confidence = clamp(confidence);

  const explanation: ScoreExplanation = {
    positive: SCORE_DIMENSIONS.flatMap((d) => dims[d].positive),
    negative: SCORE_DIMENSIONS.flatMap((d) => dims[d].negative),
    missing: SCORE_DIMENSIONS.flatMap((d) => dims[d].missing),
    confidenceFactors,
    weightsApplied,
    modelVersion: model.version,
  };

  return {
    scores: Object.fromEntries(
      SCORE_DIMENSIONS.map((d) => [d, dims[d].score === null ? null : round1(dims[d].score)]),
    ) as Record<ScoreDimension, number | null>,
    confidenceScore: round1(confidence),
    overallScore: round1(overall),
    explanation,
  };
}

export function parseScoreModel(row: {
  id: string;
  version: number;
  weightsJson: unknown;
  configJson: unknown;
}): ScoreModelDefinition {
  return {
    id: row.id,
    version: row.version,
    weights: scoreWeightsSchema.parse(row.weightsJson),
    config: scoreModelConfigSchema.parse(row.configJson ?? {}),
  };
}
