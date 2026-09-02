import { RE2JS } from "re2js";
import { z } from "zod";
import { DISPOSITIONS, RULE_ACTIONS, SCORE_DIMENSIONS } from "@dominio-x/contracts";

/**
 * JSON rule DSL. Parsed and validated with Zod; never evaluated with eval/new Function.
 */

export const RULE_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "not_exists",
  "in",
  "not_in",
  "contains",
  "starts_with",
  "ends_with",
  "matches_safe_regex",
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

export const MAX_REGEX_LENGTH = 200;
export const MAX_CONDITION_DEPTH = 8;
export const MAX_CONDITION_NODES = 200;

const primitive = z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]);
export type Primitive = z.infer<typeof primitive>;

export const metricKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/, "metric keys are dotted lowercase identifiers");

const leafBase = z.object({
  metric: metricKeySchema,
  op: z.enum(RULE_OPERATORS),
  value: z.union([primitive, z.array(primitive).max(500)]).optional(),
});

export const leafConditionSchema = leafBase.superRefine((leaf, ctx) => {
  const needsValue = !["exists", "not_exists"].includes(leaf.op);
  if (needsValue && leaf.value === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["value"],
      message: `operator "${leaf.op}" requires a value`,
    });
  }
  if (["in", "not_in"].includes(leaf.op) && !Array.isArray(leaf.value)) {
    ctx.addIssue({
      code: "custom",
      path: ["value"],
      message: `operator "${leaf.op}" requires an array value`,
    });
  }
  if (["gt", "gte", "lt", "lte"].includes(leaf.op) && typeof leaf.value !== "number") {
    ctx.addIssue({
      code: "custom",
      path: ["value"],
      message: `operator "${leaf.op}" requires a numeric value`,
    });
  }
  if (
    ["contains", "starts_with", "ends_with", "matches_safe_regex"].includes(leaf.op) &&
    typeof leaf.value !== "string"
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["value"],
      message: `operator "${leaf.op}" requires a string value`,
    });
  }
  if (leaf.op === "matches_safe_regex" && typeof leaf.value === "string") {
    if (leaf.value.length > MAX_REGEX_LENGTH) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `regex longer than ${MAX_REGEX_LENGTH} characters`,
      });
    } else {
      try {
        RE2JS.compile(leaf.value);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: `invalid RE2 regex: ${error instanceof Error ? error.message : "unknown"}`,
        });
      }
    }
  }
});
export type LeafCondition = z.infer<typeof leafConditionSchema>;

export type Condition =
  LeafCondition | { all: Condition[] } | { any: Condition[] } | { not: Condition };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    leafConditionSchema,
    z.object({ all: z.array(conditionSchema).min(1).max(50) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1).max(50) }).strict(),
    z.object({ not: conditionSchema }).strict(),
  ]),
);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reject") }).strict(),
  z.object({ type: z.literal("quarantine") }).strict(),
  z.object({ type: z.literal("warn"), disposition: z.enum(DISPOSITIONS).optional() }).strict(),
  z
    .object({
      type: z.literal("tag"),
      tag: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9_.-]+$/),
    })
    .strict(),
  z
    .object({
      type: z.literal("score_adjustment"),
      dimension: z.enum(SCORE_DIMENSIONS),
      delta: z.number().min(-100).max(100),
    })
    .strict(),
  z.object({ type: z.literal("candidate_allow") }).strict(),
  z.object({ type: z.literal("candidate_deny") }).strict(),
]);
export type RuleActionSpec = z.infer<typeof actionSchema>;
export type RuleActionType = RuleActionSpec["type"];

export const RULE_ACTION_TYPES = RULE_ACTIONS;

export interface CompiledRule {
  id: string;
  key: string;
  name: string;
  category: string;
  priority: number;
  enabled: boolean;
  reasonCode: string;
  condition: Condition;
  action: RuleActionSpec;
}

export interface CompiledRuleset {
  id: string;
  version: number;
  rules: CompiledRule[];
}

export interface RuleDefinitionInput {
  id: string;
  key: string;
  name: string;
  category: string;
  priority: number;
  enabled: boolean;
  reasonCode: string;
  condition: unknown;
  action: unknown;
}

export interface CompileIssue {
  ruleKey: string;
  path: string;
  message: string;
}

function countNodes(condition: Condition, depth = 1): { nodes: number; depth: number } {
  if ("all" in condition || "any" in condition) {
    const children = "all" in condition ? condition.all : condition.any;
    let nodes = 1;
    let maxDepth = depth;
    for (const child of children) {
      const r = countNodes(child, depth + 1);
      nodes += r.nodes;
      maxDepth = Math.max(maxDepth, r.depth);
    }
    return { nodes, depth: maxDepth };
  }
  if ("not" in condition) {
    const r = countNodes(condition.not, depth + 1);
    return { nodes: r.nodes + 1, depth: r.depth };
  }
  return { nodes: 1, depth };
}

export function compileRule(input: RuleDefinitionInput): {
  rule: CompiledRule | null;
  issues: CompileIssue[];
} {
  const issues: CompileIssue[] = [];
  const cond = conditionSchema.safeParse(input.condition);
  if (!cond.success) {
    for (const issue of cond.error.issues) {
      issues.push({
        ruleKey: input.key,
        path: `condition.${issue.path.join(".")}`,
        message: issue.message,
      });
    }
  } else {
    const size = countNodes(cond.data);
    if (size.depth > MAX_CONDITION_DEPTH)
      issues.push({
        ruleKey: input.key,
        path: "condition",
        message: `condition depth exceeds ${MAX_CONDITION_DEPTH}`,
      });
    if (size.nodes > MAX_CONDITION_NODES)
      issues.push({
        ruleKey: input.key,
        path: "condition",
        message: `condition has more than ${MAX_CONDITION_NODES} nodes`,
      });
  }
  const act = actionSchema.safeParse(input.action);
  if (!act.success) {
    for (const issue of act.error.issues) {
      issues.push({
        ruleKey: input.key,
        path: `action.${issue.path.join(".")}`,
        message: issue.message,
      });
    }
  }
  if (issues.length > 0 || !cond.success || !act.success) return { rule: null, issues };
  return {
    rule: {
      id: input.id,
      key: input.key,
      name: input.name,
      category: input.category,
      priority: input.priority,
      enabled: input.enabled,
      reasonCode: input.reasonCode,
      condition: cond.data,
      action: act.data,
    },
    issues,
  };
}

export function compileRuleset(input: {
  id: string;
  version: number;
  rules: RuleDefinitionInput[];
}): {
  ruleset: CompiledRuleset | null;
  issues: CompileIssue[];
} {
  const issues: CompileIssue[] = [];
  const rules: CompiledRule[] = [];
  const seen = new Set<string>();
  for (const def of input.rules) {
    if (seen.has(def.key))
      issues.push({ ruleKey: def.key, path: "key", message: "duplicate rule key" });
    seen.add(def.key);
    const { rule, issues: ruleIssues } = compileRule(def);
    issues.push(...ruleIssues);
    if (rule) rules.push(rule);
  }
  if (issues.length > 0) return { ruleset: null, issues };
  rules.sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  return { ruleset: { id: input.id, version: input.version, rules }, issues };
}
