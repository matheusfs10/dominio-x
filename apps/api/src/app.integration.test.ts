import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiConfigSchema } from "@dominio-x/config";
import { seedDatabase } from "@dominio-x/database";
import {
  createCrawlerJob,
  requestAnalysis,
  upsertDomain,
  requireNormalized,
} from "@dominio-x/domain-core";
import { createTestContext } from "@dominio-x/domain-core/testing";
import {
  TEST_MACHINE_TOKEN,
  TEST_SECRET,
  createTestDatabase,
  type TestDatabase,
} from "@dominio-x/test-utils";
import { buildApp, type App } from "./app.js";

const ORIGIN = "http://localhost:3000";

describe("api (integration)", () => {
  let tdb: TestDatabase;
  let app: App;
  let adminCookie: string;
  let viewerCookie: string;

  beforeAll(async () => {
    tdb = await createTestDatabase({ seed: false });
    await seedDatabase(tdb.db, {
      dev: true,
      bootstrapAdmin: { email: "admin@example.com", password: "admin-password-123" },
    });
    const config = apiConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: tdb.url,
      REDIS_URL: "redis://127.0.0.1:6379",
      SESSION_SECRET: TEST_SECRET,
      CRAWLER_MACHINE_TOKEN: TEST_MACHINE_TOKEN,
      APP_URL: ORIGIN,
      API_URL: "http://localhost:4000",
      STORAGE_DRIVER: "memory",
      LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? "silent",
    });
    const core = createTestContext(tdb.db);
    app = await buildApp({ config, database: tdb, redis: null, core });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await tdb.destroy();
  });

  async function loginAs(email: string, password: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { origin: ORIGIN },
      payload: { email, password },
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === "dx_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe("lax");
    return `dx_session=${cookie!.value}`;
  }

  it("exposes health and readiness", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ checks: { database: "ok" } });
    expect(JSON.stringify(ready.json())).not.toContain("127.0.0.1");
  });

  it("serves an OpenAPI document", async () => {
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ openapi: "3.1.0" });
    expect(Object.keys(res.json().paths)).toContain("/v1/domains");
  });

  it("rejects bad credentials and returns the error contract", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { origin: ORIGIN },
      payload: { email: "admin@example.com", password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      error: { code: "UNAUTHORIZED", requestId: expect.any(String) },
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { origin: ORIGIN },
      payload: { email: "nope" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("logs in with a secure cookie session and reports the current user", async () => {
    adminCookie = await loginAs("admin@example.com", "admin-password-123");
    viewerCookie = await loginAs("viewer@dominio-x.local", "dev-password-123");
    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: adminCookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ email: "admin@example.com", role: "admin" });
    expect(JSON.stringify(me.json())).not.toContain("passwordHash");
    expect((await app.inject({ method: "GET", url: "/v1/auth/me" })).statusCode).toBe(401);
  });

  it("enforces CSRF origin checks on cookie-authenticated mutations", async () => {
    const noOrigin = await app.inject({
      method: "POST",
      url: "/v1/domains",
      headers: { cookie: adminCookie },
      payload: { domain: "csrf.com.br" },
    });
    expect(noOrigin.statusCode).toBe(403);
    expect(noOrigin.json().error.code).toBe("CSRF_REJECTED");
    const badOrigin = await app.inject({
      method: "POST",
      url: "/v1/domains",
      headers: { cookie: adminCookie, origin: "https://evil.example" },
      payload: { domain: "csrf.com.br" },
    });
    expect(badOrigin.statusCode).toBe(403);
  });

  it("enforces RBAC", async () => {
    const viewerPost = await app.inject({
      method: "POST",
      url: "/v1/domains",
      headers: { cookie: viewerCookie, origin: ORIGIN },
      payload: { domain: "rbac.com.br" },
    });
    expect(viewerPost.statusCode).toBe(403);
    expect(viewerPost.json().error.code).toBe("FORBIDDEN");
    expect(
      (await app.inject({ method: "GET", url: "/v1/domains", headers: { cookie: viewerCookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/users", headers: { cookie: viewerCookie } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "GET", url: "/v1/users", headers: { cookie: adminCookie } }))
        .statusCode,
    ).toBe(200);
  });

  it("creates a domain, queues an analysis and lists/detail it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/domains",
      headers: { cookie: adminCookie, origin: ORIGIN },
      payload: { domain: "https://Nova-Loja.com.br/path" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.domain.asciiFqdn).toBe("nova-loja.com.br");
    expect(body.run.status).toBe("queued");
    const dup = await app.inject({
      method: "POST",
      url: "/v1/domains",
      headers: { cookie: adminCookie, origin: ORIGIN },
      payload: { domain: "nova-loja.com.br" },
    });
    expect(dup.statusCode).toBe(200);
    expect(dup.json().run.created).toBe(false);
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/domains",
      headers: { cookie: adminCookie, origin: ORIGIN },
      payload: { domain: "127.0.0.1" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("DOMAIN_INVALID");

    const list = await app.inject({
      method: "GET",
      url: "/v1/domains?q=nova&limit=5",
      headers: { cookie: adminCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(
      list.json().items.some((d: { asciiFqdn: string }) => d.asciiFqdn === "nova-loja.com.br"),
    ).toBe(true);
    const detail = await app.inject({
      method: "GET",
      url: `/v1/domains/${body.domain.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().runs.length).toBe(1);
    const runs = await app.inject({
      method: "GET",
      url: "/v1/analysis-runs?status=queued",
      headers: { cookie: adminCookie },
    });
    expect(runs.json().items.length).toBeGreaterThan(0);
  });

  it("imports CSV batches with row errors", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/batches/import",
      headers: { cookie: adminCookie, origin: ORIGIN },
      payload: { content: "domain\nimport-a.com.br\nbad line\n", analyze: false, name: "t" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().stats).toMatchObject({ total: 1, invalid: 1 });
    expect(res.json().issues.length).toBe(1);
    const batches = await app.inject({
      method: "GET",
      url: "/v1/batches",
      headers: { cookie: adminCookie },
    });
    expect(batches.json().items.length).toBeGreaterThan(0);
    const detail = await app.inject({
      method: "GET",
      url: `/v1/batches/${res.json().batch.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.json().funnel.total).toBe(1);
  });

  it("protects the internal crawler API with the machine token and processes a job lease", async () => {
    const domain = await upsertDomain(tdb.db, requireNormalized("machine.com.br"), "manual");
    const core = createTestContext(tdb.db);
    const { run } = await requestAnalysis(core, { domainId: domain.id, triggerType: "manual" });
    await createCrawlerJob(tdb.db, {
      analysisRunId: run.id,
      domainId: domain.id,
      fqdn: "machine.com.br",
    });

    const noToken = await app.inject({
      method: "POST",
      url: "/v1/internal/crawler/jobs/claim",
      payload: { workerId: "w" },
    });
    expect(noToken.statusCode).toBe(401);
    const cookieOnly = await app.inject({
      method: "POST",
      url: "/v1/internal/crawler/jobs/claim",
      headers: { cookie: adminCookie, origin: ORIGIN },
      payload: { workerId: "w" },
    });
    expect(cookieOnly.statusCode).toBe(401);
    const wrong = await app.inject({
      method: "POST",
      url: "/v1/internal/crawler/jobs/claim",
      headers: { "x-machine-token": "x".repeat(40) },
      payload: { workerId: "w" },
    });
    expect(wrong.statusCode).toBe(401);

    const claim = await app.inject({
      method: "POST",
      url: "/v1/internal/crawler/jobs/claim",
      headers: { "x-machine-token": TEST_MACHINE_TOKEN },
      payload: { workerId: "w1", max: 5 },
    });
    expect(claim.statusCode).toBe(200);
    const jobs = claim.json().jobs;
    expect(jobs.length).toBe(1);
    const hb = await app.inject({
      method: "POST",
      url: `/v1/internal/crawler/jobs/${jobs[0].id}/heartbeat`,
      headers: { "x-machine-token": TEST_MACHINE_TOKEN },
      payload: { workerId: "w1" },
    });
    expect(hb.statusCode).toBe(200);
    const complete = await app.inject({
      method: "POST",
      url: `/v1/internal/crawler/jobs/${jobs[0].id}/complete`,
      headers: { "x-machine-token": TEST_MACHINE_TOKEN },
      payload: {
        workerId: "w1",
        result: {
          reachable: false,
          httpsAvailable: null,
          status: null,
          redirectCount: 0,
          redirectChain: [],
          finalUrl: null,
          finalHostname: null,
          title: null,
          metaDescription: null,
          contentType: null,
          contentLength: null,
          server: null,
          securityBlocked: true,
          error: "security:private",
          durationMs: 5,
        },
      },
    });
    expect(complete.statusCode).toBe(200);
    const again = await app.inject({
      method: "POST",
      url: `/v1/internal/crawler/jobs/${jobs[0].id}/complete`,
      headers: { "x-machine-token": TEST_MACHINE_TOKEN },
      payload: {
        workerId: "w1",
        result: {
          reachable: false,
          httpsAvailable: null,
          status: null,
          redirectCount: 0,
          redirectChain: [],
          finalUrl: null,
          finalHostname: null,
          title: null,
          metaDescription: null,
          contentType: null,
          contentLength: null,
          server: null,
          securityBlocked: false,
          error: null,
          durationMs: 5,
        },
      },
    });
    expect(again.statusCode).toBe(409);
  });

  it("manages shortlists, rulesets, providers, settings and audit", async () => {
    const list = await app.inject({
      method: "POST",
      url: "/v1/shortlists",
      headers: { cookie: adminCookie, origin: ORIGIN },
      payload: { name: "Targets" },
    });
    expect(list.statusCode).toBe(201);
    const domain = await upsertDomain(tdb.db, requireNormalized("short.com.br"), "manual");
    const add = await app.inject({
      method: "POST",
      url: `/v1/shortlists/${list.json().shortlist.id}/domains`,
      headers: { cookie: adminCookie, origin: ORIGIN },
      payload: { domainId: domain.id, note: "n" },
    });
    expect(add.statusCode).toBe(201);
    const csv = await app.inject({
      method: "GET",
      url: `/v1/shortlists/${list.json().shortlist.id}/export.csv`,
      headers: { cookie: viewerCookie },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain("short.com.br");

    const rulesets = await app.inject({
      method: "GET",
      url: "/v1/rulesets",
      headers: { cookie: viewerCookie },
    });
    // v1 is the active ruleset; v2 (content blocks) is seeded as a draft until an admin activates it.
    const rulesetItems = rulesets.json().items as { id: string; version: number; status: string }[];
    expect(rulesetItems.filter((r) => r.status === "active").map((r) => r.version)).toEqual([1]);
    expect(rulesetItems.find((r) => r.version === 2)?.status).toBe("draft");
    const activeRuleset = rulesetItems.find((r) => r.status === "active")!;
    const invalidRule = await app.inject({
      method: "POST",
      url: "/v1/rulesets",
      headers: { cookie: adminCookie, origin: ORIGIN },
      payload: {
        name: "bad",
        rules: [
          {
            key: "x",
            name: "x",
            reasonCode: "X",
            condition: { metric: "a", op: "gt", value: "no" },
            action: { type: "reject" },
          },
        ],
      },
    });
    expect(invalidRule.statusCode).toBe(400);
    expect(invalidRule.json().error.code).toBe("RULESET_INVALID");
    const clone = await app.inject({
      method: "POST",
      url: `/v1/rulesets/${activeRuleset.id}/clone`,
      headers: { cookie: adminCookie, origin: ORIGIN },
    });
    expect(clone.statusCode).toBe(201);
    expect(clone.json().ruleset.status).toBe("draft");
    const editActive = await app.inject({
      method: "PATCH",
      url: `/v1/rulesets/${activeRuleset.id}`,
      headers: { cookie: adminCookie, origin: ORIGIN },
      payload: { name: "nope" },
    });
    expect(editActive.statusCode).toBe(409);
    const activate = await app.inject({
      method: "POST",
      url: `/v1/rulesets/${clone.json().ruleset.id}/activate`,
      headers: { cookie: adminCookie, origin: ORIGIN },
    });
    expect(activate.statusCode).toBe(200);
    expect(activate.json().ruleset.status).toBe("active");
    const test = await app.inject({
      method: "POST",
      url: `/v1/rulesets/${clone.json().ruleset.id}/test`,
      headers: { cookie: adminCookie, origin: ORIGIN },
      payload: { domainIds: [domain.id] },
    });
    expect(test.statusCode).toBe(200);

    const providers = await app.inject({
      method: "GET",
      url: "/v1/providers",
      headers: { cookie: viewerCookie },
    });
    expect(providers.statusCode).toBe(200);
    const semrush = providers.json().items.find((p: { key: string }) => p.key === "semrush");
    expect(semrush.runtime.state).toBe("decision_pending");
    expect(JSON.stringify(providers.json())).not.toMatch(/api[_-]?key/i);
    const viewerPatch = await app.inject({
      method: "PATCH",
      url: "/v1/providers/semrush",
      headers: { cookie: viewerCookie, origin: ORIGIN },
      payload: { enabled: true },
    });
    expect(viewerPatch.statusCode).toBe(403);

    const settings = await app.inject({
      method: "PATCH",
      url: "/v1/settings",
      headers: { cookie: adminCookie, origin: ORIGIN },
      payload: { candidateGate: { maxDigits: 2 } },
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().candidateGate.maxDigits).toBe(2);

    const usage = await app.inject({
      method: "GET",
      url: "/v1/usage?days=7",
      headers: { cookie: viewerCookie },
    });
    expect(usage.statusCode).toBe(200);
    expect(usage.json().semrush).toBeDefined();
    const dashboard = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: { cookie: viewerCookie },
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().domains.known).toBeGreaterThan(0);

    const audit = await app.inject({
      method: "GET",
      url: "/v1/audit",
      headers: { cookie: adminCookie },
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().items.some((a: { action: string }) => a.action === "auth.login")).toBe(
      true,
    );
    expect(
      audit.json().items.some((a: { action: string }) => a.action === "ruleset.activated"),
    ).toBe(true);
  });

  it("logs out and invalidates the session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { cookie: viewerCookie, origin: ORIGIN },
    });
    expect(res.statusCode).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: viewerCookie } }))
        .statusCode,
    ).toBe(401);
  });
});
