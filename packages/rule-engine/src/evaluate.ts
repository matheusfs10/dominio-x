import { RE2JS } from "re2js";
import type { Disposition, ObservationState, ScoreDimension } from "@dominio-x/contracts";
import type {
  CompiledRule,
  CompiledRuleset,
  Condition,
  LeafCondition,
  Primitive,
  RuleActionSpec,
} from "./dsl.js";

/**
 * A metric value as seen by the rule engine. `state` distinguishes unknown from zero:
 * only `measured` values participate in comparisons.
 */
export interface MetricValue {
  state: ObservationState;
  value: Primitive | Primitive[] | Record<string, unknown> | undefined;
  providerKey?: string;
  observedAt?: string;
}

export type MetricContext = Record<string, MetricValue>;

export interface LeafEvidence {
  metric: string;
  op: string;
  expected: unknown;
  actual: unknown;
  state: ObservationState | "missing";
  matched: boolean;
}

export interface RuleExecutionResult {
  ruleId: string;
  ruleKey: string;
  ruleName: string;
  priority: number;
  matched: boolean;
  action: RuleActionSpec | null;
  reasonCode: string;
  evidence: { leaves: LeafEvidence[] };
}

export interface RulesetEvaluation {
  rulesetId: string;
  rulesetVersion: number;
  executions: RuleExecutionResult[];
  summary: RuleSummary;
}

export interface RuleSummary {
  disposition: Disposition;
  dispositionReasons: string[];
  scoreAdjustments: Partial<Record<ScoreDimension, number>>;
  scoreAdjustmentDetails: {
    dimension: ScoreDimension;
    delta: number;
    ruleKey: string;
    reasonCode: string;
  }[];
  tags: string[];
  candidateDecision: "allow" | "deny" | null;
  candidateReasons: string[];
  warnings: string[];
}

const regexCache = new Map<string, RE2JS>();
function safeRegex(pattern: string): RE2JS {
  let compiled = regexCache.get(pattern);
  if (!compiled) {
    compiled = RE2JS.compile(pattern);
    if (regexCache.size > 500) regexCache.clear();
    regexCache.set(pattern, compiled);
  }
  return compiled;
}

function toComparable(value: unknown): Primitive | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  return undefined;
}

function evaluateLeaf(leaf: LeafCondition, ctx: MetricContext): LeafEvidence {
  const metric = ctx[leaf.metric];
  const state: LeafEvidence["state"] = metric ? metric.state : "missing";
  const measured = metric?.state === "measured";
  const actual = metric?.value;
  const base: LeafEvidence = {
    metric: leaf.metric,
    op: leaf.op,
    expected: leaf.value,
    actual: measured ? actual : undefined,
    state,
    matched: false,
  };

  if (leaf.op === "exists") return { ...base, matched: measured };
  if (leaf.op === "not_exists") return { ...base, matched: !measured };
  if (!measured) return base;

  const scalar = toComparable(actual);
  const expected = leaf.value;
  let matched = false;
  switch (leaf.op) {
    case "eq":
      matched = scalar !== undefined && scalar === expected;
      break;
    case "neq":
      matched = scalar !== undefined && scalar !== expected;
      break;
    case "gt":
      matched = typeof scalar === "number" && typeof expected === "number" && scalar > expected;
      break;
    case "gte":
      matched = typeof scalar === "number" && typeof expected === "number" && scalar >= expected;
      break;
    case "lt":
      matched = typeof scalar === "number" && typeof expected === "number" && scalar < expected;
      break;
    case "lte":
      matched = typeof scalar === "number" && typeof expected === "number" && scalar <= expected;
      break;
    case "in":
      matched = Array.isArray(expected) && scalar !== undefined && expected.includes(scalar);
      break;
    case "not_in":
      matched = Array.isArray(expected) && scalar !== undefined && !expected.includes(scalar);
      break;
    case "contains":
      if (typeof expected === "string") {
        if (typeof scalar === "string") matched = scalar.includes(expected);
        else if (Array.isArray(actual)) matched = actual.includes(expected);
      }
      break;
    case "starts_with":
      matched =
        typeof scalar === "string" && typeof expected === "string" && scalar.startsWith(expected);
      break;
    case "ends_with":
      matched =
        typeof scalar === "string" && typeof expected === "string" && scalar.endsWith(expected);
      break;
    case "matches_safe_regex":
      matched =
        typeof scalar === "string" &&
        typeof expected === "string" &&
        safeRegex(expected).matcher(scalar).find();
      break;
  }
  return { ...base, matched };
}

function evaluateCondition(
  condition: Condition,
  ctx: MetricContext,
  leaves: LeafEvidence[],
): boolean {
  if ("all" in condition) {
    let result = true;
    for (const child of condition.all) if (!evaluateCondition(child, ctx, leaves)) result = false;
    return result;
  }
  if ("any" in condition) {
    let result = false;
    for (const child of condition.any) if (evaluateCondition(child, ctx, leaves)) result = true;
    return result;
  }
  if ("not" in condition) return !evaluateCondition(condition.not, ctx, leaves);
  const evidence = evaluateLeaf(condition, ctx);
  leaves.push(evidence);
  return evidence.matched;
}

export function evaluateRule(rule: CompiledRule, ctx: MetricContext): RuleExecutionResult {
  const leaves: LeafEvidence[] = [];
  const matched = rule.enabled ? evaluateCondition(rule.condition, ctx, leaves) : false;
  return {
    ruleId: rule.id,
    ruleKey: rule.key,
    ruleName: rule.name,
    priority: rule.priority,
    matched,
    action: matched ? rule.action : null,
    reasonCode: rule.reasonCode,
    evidence: { leaves },
  };
}

const DISPOSITION_RANK: Record<Disposition, number> = {
  accepted: 0,
  needs_review: 1,
  quarantined: 2,
  rejected: 3,
};

export function summarize(executions: RuleExecutionResult[]): RuleSummary {
  const summary: RuleSummary = {
    disposition: "accepted",
    dispositionReasons: [],
    scoreAdjustments: {},
    scoreAdjustmentDetails: [],
    tags: [],
    candidateDecision: null,
    candidateReasons: [],
    warnings: [],
  };
  let deny = false;
  let allow = false;
  const raise = (d: Disposition, reason: string) => {
    if (DISPOSITION_RANK[d] > DISPOSITION_RANK[summary.disposition]) summary.disposition = d;
    summary.dispositionReasons.push(reason);
  };
  for (const ex of executions) {
    if (!ex.matched || !ex.action) continue;
    switch (ex.action.type) {
      case "reject":
        raise("rejected", ex.reasonCode);
        break;
      case "quarantine":
        raise("quarantined", ex.reasonCode);
        break;
      case "warn":
        summary.warnings.push(ex.reasonCode);
        if (ex.action.disposition) raise(ex.action.disposition, ex.reasonCode);
        break;
      case "tag":
        if (!summary.tags.includes(ex.action.tag)) summary.tags.push(ex.action.tag);
        break;
      case "score_adjustment": {
        const dim = ex.action.dimension;
        summary.scoreAdjustments[dim] = (summary.scoreAdjustments[dim] ?? 0) + ex.action.delta;
        summary.scoreAdjustmentDetails.push({
          dimension: dim,
          delta: ex.action.delta,
          ruleKey: ex.ruleKey,
          reasonCode: ex.reasonCode,
        });
        break;
      }
      case "candidate_allow":
        allow = true;
        summary.candidateReasons.push(`allow:${ex.reasonCode}`);
        break;
      case "candidate_deny":
        deny = true;
        summary.candidateReasons.push(`deny:${ex.reasonCode}`);
        break;
    }
  }
  if (summary.disposition === "rejected") {
    deny = true;
    summary.candidateReasons.push("deny:REJECTED");
  }
  summary.candidateDecision = deny ? "deny" : allow ? "allow" : null;
  return summary;
}

export function evaluateRuleset(ruleset: CompiledRuleset, ctx: MetricContext): RulesetEvaluation {
  const executions = ruleset.rules.map((rule) => evaluateRule(rule, ctx));
  return {
    rulesetId: ruleset.id,
    rulesetVersion: ruleset.version,
    executions,
    summary: summarize(executions),
  };
}
