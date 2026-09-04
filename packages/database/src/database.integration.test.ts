import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@dominio-x/test-utils";
import { seedDatabase } from "./seed-core.js";
import { CONTENT_RULESET_MARKER_KEY, SEED_CONTENT_RULESET } from "./seed-data.js";
import {
  domains,
  providers,
  rules,
  rulesets,
  scoreModels,
  sources,
  users,
} from "./schema/index.js";
import { hashPassword, verifyPassword } from "./password.js";

describe("database (integration)", () => {
  let tdb: TestDatabase;
  beforeAll(async () => {
    tdb = await createTestDatabase({ seed: false });
  });
  afterAll(async () => {
    await tdb.destroy();
  });

  it("still seeds the content ruleset when an analyst already occupies that version", async () => {
    // Regression: the seed used to recognise the content ruleset by its version number. An
    // analyst who created or cloned a ruleset through the UI took version 2 first, and the seed
    // then skipped itself in silence, leaving the content blocks out of the database entirely.
    const fresh = await createTestDatabase({ seed: false });
    try {
      await fresh.db
        .insert(rulesets)
        .values({ name: "rascunho do analista", version: 2, status: "draft" });

      await seedDatabase(fresh.db, {});

      const contentRule = await fresh.db.query.rules.findFirst({
        where: eq(rules.key, CONTENT_RULESET_MARKER_KEY),
      });
      expect(contentRule).toBeDefined();
      const owner = await fresh.db.query.rulesets.findFirst({
        where: eq(rulesets.id, contentRule!.rulesetId),
      });
      expect(owner?.version).toBe(3);
      expect(owner?.status).toBe("draft");
      expect(
        (await fresh.db.select().from(rules).where(eq(rules.rulesetId, contentRule!.rulesetId)))
          .length,
      ).toBe(SEED_CONTENT_RULESET.rules.length);

      // Running it again must not create a second copy.
      await seedDatabase(fresh.db, {});
      const all = await fresh.db.select().from(rulesets);
      expect(all.filter((r) => r.name === SEED_CONTENT_RULESET.name).length).toBe(1);
    } finally {
      await fresh.destroy();
    }
  });

  it("applies migrations and seeds reference data idempotently", async () => {
    const first = await seedDatabase(tdb.db, {
      bootstrapAdmin: { email: "Admin@Example.com", password: "correct-horse-battery-1" },
    });
    expect(first.rulesetCreated).toBe(true);
    expect(first.scoreModelCreated).toBe(true);
    expect(first.adminCreated).toBe(true);

    const second = await seedDatabase(tdb.db, {
      bootstrapAdmin: { email: "other@example.com", password: "x".repeat(20) },
    });
    expect(second.rulesetCreated).toBe(false);
    expect(second.adminCreated).toBe(false);
    expect(second.adminSkippedReason).toMatch(/already exist/);

    expect((await tdb.db.select().from(sources)).length).toBe(3);
    expect((await tdb.db.select().from(providers)).length).toBe(7);
    // v1 is active; the content ruleset takes the next free version and stays a draft.
    const seededRulesets = await tdb.db.select().from(rulesets);
    expect(seededRulesets.map((r) => `v${r.version}:${r.status}`).sort()).toEqual([
      "v1:active",
      "v2:draft",
    ]);
    expect((await tdb.db.select().from(rules)).length).toBeGreaterThan(5);
    expect((await tdb.db.select().from(scoreModels))[0]?.status).toBe("active");
    const admin = await tdb.db.query.users.findFirst({
      where: eq(users.email, "admin@example.com"),
    });
    expect(admin?.role).toBe("admin");
    expect(await verifyPassword(admin!.passwordHash, "correct-horse-battery-1")).toBe(true);
    expect(await verifyPassword(admin!.passwordHash, "wrong")).toBe(false);
  });

  it("enforces unique ascii_fqdn and supports trigram search", async () => {
    const row = {
      fqdn: "exemplo.com.br",
      asciiFqdn: "exemplo.com.br",
      unicodeFqdn: "exemplo.com.br",
      sld: "exemplo",
      tld: "com.br",
      registrableDomain: "exemplo.com.br",
      normalizationVersion: 1,
    };
    await tdb.db.insert(domains).values(row);
    await expect(tdb.db.insert(domains).values(row)).rejects.toThrow();
    const hits = await tdb.sql`select ascii_fqdn from domains where ascii_fqdn ilike ${"%xempl%"}`;
    expect(hits.length).toBe(1);
    const ext = await tdb.sql`select extname from pg_extension where extname = 'pg_trgm'`;
    expect(ext.length).toBe(1);
  });

  it("hashes passwords with argon2id", async () => {
    const h = await hashPassword("some-password-123");
    expect(h.startsWith("$argon2id$")).toBe(true);
  });
});
