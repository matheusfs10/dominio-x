import { count, eq } from "drizzle-orm";
import { normalizeDomain } from "@dominio-x/normalization";
import type { Db } from "./client.js";
import { hashPassword } from "./password.js";
import {
  DEV_SAMPLE_DOMAINS,
  SEED_PROVIDERS,
  SEED_RULESET_V1,
  SEED_RULESET_V2,
  SEED_SCORE_MODEL_V1,
  SEED_SCORE_MODEL_V2,
  SEED_SETTINGS,
  SEED_SOURCES,
} from "./seed-data.js";
import {
  appSettings,
  domainSummaries,
  domains,
  providers,
  rules,
  rulesets,
  scoreModels,
  sourceBatchDomains,
  sourceBatches,
  sources,
  users,
} from "./schema/index.js";
import { sha256 } from "./util.js";

export interface SeedOptions {
  /** Create the bootstrap admin when no user exists. Password is never logged. */
  bootstrapAdmin?: { email: string; password: string } | null;
  /** Insert development sample data (never in production). */
  dev?: boolean;
  log?: (message: string) => void;
}

export interface SeedReport {
  sources: number;
  providers: number;
  rulesetCreated: boolean;
  scoreModelCreated: boolean;
  adminCreated: boolean;
  adminSkippedReason?: string;
  devDomains: number;
}

/**
 * Idempotent seed: reference data is upserted, versioned artifacts (ruleset v1, score model v1)
 * are created only when absent, and the admin is created only when there are no users at all.
 */
export async function seedDatabase(db: Db, options: SeedOptions = {}): Promise<SeedReport> {
  const log = options.log ?? (() => undefined);
  const report: SeedReport = {
    sources: 0,
    providers: 0,
    rulesetCreated: false,
    scoreModelCreated: false,
    adminCreated: false,
    devDomains: 0,
  };

  for (const source of SEED_SOURCES) {
    await db
      .insert(sources)
      .values(source)
      .onConflictDoUpdate({
        target: sources.key,
        set: { name: source.name, type: source.type, updatedAt: new Date() },
      });
    report.sources += 1;
  }

  for (const provider of SEED_PROVIDERS) {
    await db
      .insert(providers)
      .values(provider)
      .onConflictDoUpdate({
        target: providers.key,
        set: {
          name: provider.name,
          capabilities: provider.capabilities,
          paid: provider.paid,
          updatedAt: new Date(),
        },
      });
    report.providers += 1;
  }

  for (const [key, value] of Object.entries(SEED_SETTINGS)) {
    await db.insert(appSettings).values({ key, valueJson: value }).onConflictDoNothing();
  }

  const existingModel = await db.query.scoreModels.findFirst({
    where: eq(scoreModels.version, SEED_SCORE_MODEL_V1.version),
  });
  if (!existingModel) {
    await db
      .insert(scoreModels)
      .values({ ...SEED_SCORE_MODEL_V1, status: "active", activatedAt: new Date() });
    report.scoreModelCreated = true;
    log("score model v1 created and activated");
  }

  const existingModelV2 = await db.query.scoreModels.findFirst({
    where: eq(scoreModels.version, SEED_SCORE_MODEL_V2.version),
  });
  if (!existingModelV2) {
    // Draft on purpose: it changes scoring for every future run, so an admin activates it.
    await db.insert(scoreModels).values({ ...SEED_SCORE_MODEL_V2, status: "draft" });
    log("score model v2 created as draft (traffic signals; activate it when ready)");
  }

  /** Creates a ruleset with its rules, or leaves it alone when that version already exists. */
  const seedRuleset = async (
    definition: {
      name: string;
      version: number;
      description: string;
      rules: readonly {
        key: string;
        name: string;
        description: string;
        category: string;
        priority: number;
        reasonCode: string;
        condition: unknown;
        action: unknown;
      }[];
    },
    status: "active" | "draft",
  ): Promise<boolean> => {
    const existing = await db.query.rulesets.findFirst({
      where: eq(rulesets.version, definition.version),
    });
    if (existing) return false;
    await db.transaction(async (tx) => {
      const [rs] = await tx
        .insert(rulesets)
        .values({
          name: definition.name,
          version: definition.version,
          description: definition.description,
          status,
          activatedAt: status === "active" ? new Date() : null,
        })
        .returning();
      await tx.insert(rules).values(
        definition.rules.map((r) => ({
          rulesetId: rs!.id,
          key: r.key,
          name: r.name,
          description: r.description,
          category: r.category as (typeof rules.$inferInsert)["category"],
          priority: r.priority,
          enabled: true,
          conditionJson: r.condition,
          actionJson: r.action,
          reasonCode: r.reasonCode,
        })),
      );
    });
    return true;
  };

  if (await seedRuleset(SEED_RULESET_V1, "active")) {
    report.rulesetCreated = true;
    log("ruleset v1 created and activated");
  }
  if (await seedRuleset(SEED_RULESET_V2, "draft")) {
    // Draft on purpose: activating it starts rejecting gambling/adult domains automatically.
    log(
      `ruleset v2 created as draft (${SEED_RULESET_V2.rules.length} rules, content blocks included; activate it when ready)`,
    );
  }

  const userCount = (await db.select({ value: count() }).from(users))[0]?.value ?? 0;
  if (userCount === 0) {
    if (options.bootstrapAdmin) {
      await db.insert(users).values({
        email: options.bootstrapAdmin.email.toLowerCase(),
        name: "Administrator",
        role: "admin",
        passwordHash: await hashPassword(options.bootstrapAdmin.password),
      });
      report.adminCreated = true;
      log(
        `bootstrap admin created: ${options.bootstrapAdmin.email.toLowerCase()} — remove BOOTSTRAP_ADMIN_* variables now`,
      );
    } else {
      report.adminSkippedReason =
        "no users exist and BOOTSTRAP_ADMIN_EMAIL/PASSWORD not set; run `pnpm admin:create`";
    }
  } else {
    report.adminSkippedReason = "users already exist";
  }

  if (options.dev) {
    const manual = await db.query.sources.findFirst({ where: eq(sources.key, "manual") });
    const content = DEV_SAMPLE_DOMAINS.join("\n") + "\n";
    const contentSha = sha256(content);
    const existingBatch = await db.query.sourceBatches.findFirst({
      where: eq(sourceBatches.contentSha256, contentSha),
    });
    if (!existingBatch && manual) {
      await db.transaction(async (tx) => {
        const [batch] = await tx
          .insert(sourceBatches)
          .values({
            sourceId: manual.id,
            name: "Development sample batch",
            status: "ingested",
            contentSha256: contentSha,
            domainCount: DEV_SAMPLE_DOMAINS.length,
            metadataJson: { seed: true },
          })
          .returning();
        let position = 0;
        for (const raw of DEV_SAMPLE_DOMAINS) {
          const normalized = normalizeDomain(raw);
          if (!normalized.ok) continue;
          const [domain] = await tx
            .insert(domains)
            .values({
              fqdn: normalized.asciiFqdn,
              asciiFqdn: normalized.asciiFqdn,
              unicodeFqdn: normalized.unicodeFqdn,
              sld: normalized.sld,
              tld: normalized.tld,
              registrableDomain: normalized.registrableDomain,
              normalizationVersion: normalized.normalizationVersion,
            })
            .onConflictDoUpdate({ target: domains.asciiFqdn, set: { lastSeenAt: new Date() } })
            .returning();
          await tx
            .insert(domainSummaries)
            .values({ domainId: domain!.id, sourceKeys: ["manual"] })
            .onConflictDoNothing();
          await tx
            .insert(sourceBatchDomains)
            .values({
              sourceBatchId: batch!.id,
              domainId: domain!.id,
              rawValue: raw,
              position: position++,
              isNew: true,
            })
            .onConflictDoNothing();
          report.devDomains += 1;
        }
      });
      log(
        `dev sample batch created with ${report.devDomains} domains (run the worker to analyze them)`,
      );
    }
    for (const [email, role] of [
      ["analyst@dominio-x.local", "analyst"],
      ["viewer@dominio-x.local", "viewer"],
    ] as const) {
      const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (!existing) {
        await db.insert(users).values({
          email,
          name: role,
          role,
          passwordHash: await hashPassword("dev-password-123"),
        });
        log(`dev user ${email} created (password: dev-password-123)`);
      }
    }
  }

  return report;
}
