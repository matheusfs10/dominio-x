import { and, desc, eq, max, ne } from "drizzle-orm";
import { AppError, type RuleInput } from "@dominio-x/contracts";
import {
  rules,
  rulesets,
  type Db,
  type DbOrTx,
  type Rule,
  type Ruleset,
} from "@dominio-x/database";
import {
  compileRuleset,
  evaluateRuleset,
  type CompiledRuleset,
  type CompileIssue,
  type RulesetEvaluation,
} from "@dominio-x/rule-engine";
import { recordAudit, type AuditActor } from "./audit.js";
import { findDomainsByIds } from "./domains.js";
import { latestObservations, toMetricContext } from "./observations.js";

export async function listRulesets(db: Db): Promise<(Ruleset & { ruleCount: number })[]> {
  const rows = await db.select().from(rulesets).orderBy(desc(rulesets.version));
  const counts = await db.select({ rulesetId: rules.rulesetId, n: rules.id }).from(rules);
  const countMap = new Map<string, number>();
  for (const c of counts) countMap.set(c.rulesetId, (countMap.get(c.rulesetId) ?? 0) + 1);
  return rows.map((r) => ({ ...r, ruleCount: countMap.get(r.id) ?? 0 }));
}

export async function getRuleset(
  db: DbOrTx,
  id: string,
): Promise<{ ruleset: Ruleset; rules: Rule[] }> {
  const ruleset = await db.query.rulesets.findFirst({ where: eq(rulesets.id, id) });
  if (!ruleset) throw new AppError("NOT_FOUND", "Ruleset not found.");
  const ruleRows = await db
    .select()
    .from(rules)
    .where(eq(rules.rulesetId, id))
    .orderBy(rules.priority, rules.key);
  return { ruleset, rules: ruleRows };
}

export function validateRules(input: RuleInput[]): CompileIssue[] {
  return compileRuleset({
    id: "validation",
    version: 0,
    rules: input.map((r) => ({
      id: r.key,
      key: r.key,
      name: r.name,
      category: r.category,
      priority: r.priority,
      enabled: r.enabled,
      reasonCode: r.reasonCode,
      condition: r.condition,
      action: r.action,
    })),
  }).issues;
}

async function nextVersion(db: DbOrTx, scope = "default"): Promise<number> {
  const [row] = await db
    .select({ v: max(rulesets.version) })
    .from(rulesets)
    .where(eq(rulesets.scope, scope));
  return (row?.v ?? 0) + 1;
}

async function insertRules(db: DbOrTx, rulesetId: string, input: RuleInput[]): Promise<void> {
  if (input.length === 0) return;
  await db.insert(rules).values(
    input.map((r) => ({
      rulesetId,
      key: r.key,
      name: r.name,
      description: r.description,
      category: r.category,
      priority: r.priority,
      enabled: r.enabled,
      conditionJson: r.condition,
      actionJson: r.action,
      reasonCode: r.reasonCode,
    })),
  );
}

export async function createDraftRuleset(
  db: Db,
  input: { name: string; description: string; rules: RuleInput[] },
  actor: AuditActor,
): Promise<{ ruleset: Ruleset; rules: Rule[] }> {
  const issues = validateRules(input.rules);
  if (issues.length > 0)
    throw new AppError("RULESET_INVALID", "Ruleset contains invalid rules.", { details: issues });
  const id = await db.transaction(async (tx) => {
    const [rs] = await tx
      .insert(rulesets)
      .values({
        name: input.name,
        description: input.description,
        version: await nextVersion(tx),
        status: "draft",
        createdBy: actor.id,
      })
      .returning();
    await insertRules(tx, rs!.id, input.rules);
    await recordAudit(tx, {
      action: "ruleset.created",
      actor,
      targetType: "ruleset",
      targetId: rs!.id,
      details: { version: rs!.version },
    });
    return rs!.id;
  });
  return getRuleset(db, id);
}

export async function updateDraftRuleset(
  db: Db,
  id: string,
  input: { name?: string; description?: string; rules?: RuleInput[] },
  actor: AuditActor,
) {
  const { ruleset } = await getRuleset(db, id);
  if (ruleset.status !== "draft")
    throw new AppError(
      "RULESET_NOT_EDITABLE",
      "Only draft rulesets can be edited. Clone the active version first.",
    );
  if (input.rules) {
    const issues = validateRules(input.rules);
    if (issues.length > 0)
      throw new AppError("RULESET_INVALID", "Ruleset contains invalid rules.", { details: issues });
  }
  await db.transaction(async (tx) => {
    await tx
      .update(rulesets)
      .set({
        name: input.name ?? ruleset.name,
        description: input.description ?? ruleset.description,
        updatedAt: new Date(),
      })
      .where(eq(rulesets.id, id));
    if (input.rules) {
      await tx.delete(rules).where(eq(rules.rulesetId, id));
      await insertRules(tx, id, input.rules);
    }
    await recordAudit(tx, {
      action: "ruleset.updated",
      actor,
      targetType: "ruleset",
      targetId: id,
    });
  });
  invalidateActiveCache();
  return getRuleset(db, id);
}

export async function cloneRuleset(db: Db, id: string, actor: AuditActor) {
  const source = await getRuleset(db, id);
  const newId = await db.transaction(async (tx) => {
    const [rs] = await tx
      .insert(rulesets)
      .values({
        name: `${source.ruleset.name} (copy)`,
        description: source.ruleset.description,
        version: await nextVersion(tx),
        status: "draft",
        createdBy: actor.id,
        clonedFromId: id,
      })
      .returning();
    if (source.rules.length) {
      await tx
        .insert(rules)
        .values(
          source.rules.map(({ id: _id, rulesetId: _r, createdAt: _c, updatedAt: _u, ...rest }) => ({
            ...rest,
            rulesetId: rs!.id,
          })),
        );
    }
    await recordAudit(tx, {
      action: "ruleset.cloned",
      actor,
      targetType: "ruleset",
      targetId: rs!.id,
      details: { from: id },
    });
    return rs!.id;
  });
  return getRuleset(db, newId);
}

export async function activateRuleset(db: Db, id: string, actor: AuditActor) {
  const { ruleset, rules: ruleRows } = await getRuleset(db, id);
  if (ruleset.status === "active") return getRuleset(db, id);
  if (ruleset.status !== "draft")
    throw new AppError("RULESET_NOT_EDITABLE", "Only drafts can be activated.");
  const compiled = compileRuleset({
    id,
    version: ruleset.version,
    rules: ruleRows.map(toRuleDefinition),
  });
  if (!compiled.ruleset)
    throw new AppError("RULESET_INVALID", "Ruleset failed to compile.", {
      details: compiled.issues,
    });
  await db.transaction(async (tx) => {
    await tx
      .update(rulesets)
      .set({ status: "archived", archivedAt: new Date() })
      .where(
        and(eq(rulesets.scope, ruleset.scope), eq(rulesets.status, "active"), ne(rulesets.id, id)),
      );
    await tx
      .update(rulesets)
      .set({ status: "active", activatedAt: new Date(), updatedAt: new Date() })
      .where(eq(rulesets.id, id));
    await recordAudit(tx, {
      action: "ruleset.activated",
      actor,
      targetType: "ruleset",
      targetId: id,
      details: { version: ruleset.version },
    });
  });
  invalidateActiveCache();
  return getRuleset(db, id);
}

function toRuleDefinition(r: Rule) {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    category: r.category,
    priority: r.priority,
    enabled: r.enabled,
    reasonCode: r.reasonCode,
    condition: r.conditionJson,
    action: r.actionJson,
  };
}

let activeCache: { at: number; value: CompiledRuleset | null } | null = null;
const ACTIVE_CACHE_MS = 15_000;
export function invalidateActiveCache() {
  activeCache = null;
}

export async function getActiveCompiledRuleset(
  db: DbOrTx,
  scope = "default",
): Promise<CompiledRuleset | null> {
  if (activeCache && Date.now() - activeCache.at < ACTIVE_CACHE_MS) return activeCache.value;
  const active = await db.query.rulesets.findFirst({
    where: and(eq(rulesets.scope, scope), eq(rulesets.status, "active")),
  });
  if (!active) {
    activeCache = { at: Date.now(), value: null };
    return null;
  }
  const ruleRows = await db.select().from(rules).where(eq(rules.rulesetId, active.id));
  const compiled = compileRuleset({
    id: active.id,
    version: active.version,
    rules: ruleRows.map(toRuleDefinition),
  });
  activeCache = { at: Date.now(), value: compiled.ruleset };
  return compiled.ruleset;
}

export async function compileRulesetById(db: DbOrTx, id: string): Promise<CompiledRuleset> {
  const { ruleset, rules: ruleRows } = await getRuleset(db, id);
  const compiled = compileRuleset({
    id,
    version: ruleset.version,
    rules: ruleRows.map(toRuleDefinition),
  });
  if (!compiled.ruleset)
    throw new AppError("RULESET_INVALID", "Ruleset failed to compile.", {
      details: compiled.issues,
    });
  return compiled.ruleset;
}

/** Dry-run a (draft) ruleset against the latest observations of selected domains. Nothing is persisted. */
export async function testRuleset(
  db: Db,
  id: string,
  domainIds: string[],
): Promise<{ domainId: string; asciiFqdn: string; evaluation: RulesetEvaluation }[]> {
  const compiled = await compileRulesetById(db, id);
  const domains = await findDomainsByIds(db, domainIds);
  const out = [];
  for (const domain of domains) {
    const metrics = toMetricContext(
      await latestObservations(db, domain.id, { includeExpired: true }),
    );
    out.push({
      domainId: domain.id,
      asciiFqdn: domain.asciiFqdn,
      evaluation: evaluateRuleset(compiled, metrics),
    });
  }
  return out;
}
