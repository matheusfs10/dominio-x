import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@dominio-x/test-utils";
import {
  analysisRuns,
  domainObservations,
  domainScores,
  domainSummaries,
  ruleExecutions,
  sourceBatches,
} from "@dominio-x/database";
import {
  CsvSourceAdapter,
  ManualSourceAdapter,
  RegistroBrReleaseSourceAdapter,
} from "@dominio-x/source-adapters";
import { DnsProvider } from "@dominio-x/providers";
import type { MemoryObjectStorage } from "@dominio-x/storage";
import { getRunSteps, requestAnalysis, retryRun } from "./analysis.js";
import { claimCrawlerJobs, completeCrawlerJob, heartbeatCrawlerJob } from "./crawler-jobs.js";
import { getDomainDetail, listDomains, requireNormalized, upsertDomain } from "./domains.js";
import { latestObservations, toMetricContext } from "./observations.js";
import { getBatchDetail, ingestArtifact, watchRegistroBr } from "./sources.js";
import { createTestContext } from "./test-helpers.js";
import {
  addDomainToShortlist,
  createShortlist,
  exportShortlistCsv,
  getShortlist,
} from "./shortlists.js";
import { runRetention } from "./retention.js";

/** DNS provider that never touches the network. */
class FakeDns extends DnsProvider {
  constructor(private readonly resolves: boolean) {
    super();
  }
  override enrich() {
    const opts = { licenseClass: "public_source" as const, ttlHours: 24 };
    return Promise.resolve({
      providerKey: "dns",
      status: "ok" as const,
      observations: [
        {
          metricKey: "dns.resolves",
          valueType: "boolean" as const,
          value: this.resolves,
          state: "measured" as const,
          ...opts,
        },
        {
          metricKey: "dns.a_count",
          valueType: "numeric" as const,
          value: this.resolves ? 1 : 0,
          state: "measured" as const,
          ...opts,
        },
      ],
      requests: [{ endpointKey: "resolve", durationMs: 1 }],
      durationMs: 1,
    });
  }
}

const FIXTURE_A = `# Processo de liberação no período de 2026-08-12T15:00:00-03:00 a 2026-08-19T15:00:00-03:00
# Arquivo gerado em 2026-08-10T10:00:08-03:00
cafe.com.br
loja-virtual.com.br
abc123456.com.br
invalid line here
# Fim do arquivo
`;
const FIXTURE_B = FIXTURE_A.replace("abc123456.com.br", "abc123456.com.br\nnovo-dominio.com.br");

function fetchFor(body: string, etag: string): typeof fetch {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    if (h["if-none-match"] === etag) return new Response(null, { status: 304, headers: { etag } });
    return new Response(body, { status: 200, headers: { etag, "content-type": "text/plain" } });
  };
}

describe("domain-core pipeline (integration)", () => {
  let tdb: TestDatabase;
  beforeAll(async () => {
    tdb = await createTestDatabase();
  });
  afterAll(async () => {
    await tdb.destroy();
  });

  it("runs a full local analysis for a manually submitted domain", async () => {
    const ctx = createTestContext(tdb.db);
    ctx.providers.dns = new FakeDns(false);
    const n = requireNormalized("Cafe.com.br");
    const domain = await upsertDomain(ctx.db, n, "manual");
    expect(domain.isNew).toBe(true);

    const { run, created } = await requestAnalysis(ctx, {
      domainId: domain.id,
      triggerType: "manual",
    });
    expect(created).toBe(true);
    const again = await requestAnalysis(ctx, { domainId: domain.id, triggerType: "manual" });
    expect(again.created).toBe(false);
    expect(again.run.id).toBe(run.id);

    const processed = await ctx.stub.drain(ctx);
    expect(processed.map((p) => p.stage)).toEqual([
      "preflight",
      "dns",
      "crawl",
      "candidate_gate",
      "seo",
      "rules",
      "score",
      "complete",
    ]);

    const finished = await tdb.db.query.analysisRuns.findFirst({
      where: eq(analysisRuns.id, run.id),
    });
    expect(finished?.status).toBe("completed");
    const steps = await getRunSteps(tdb.db, run.id);
    const byKey = Object.fromEntries(steps.map((s) => [s.stepKey, s]));
    expect(byKey.preflight?.status).toBe("completed");
    expect(byKey.crawl?.status).toBe("skipped");
    expect(byKey.seo?.status).toBe("skipped");
    expect((byKey.seo?.metadataJson as { outcome: string }).outcome).toBe("decision_pending");
    expect((byKey.candidate_gate?.metadataJson as { outcome: string }).outcome).toBe("passed");

    const score = await tdb.db.query.domainScores.findFirst({
      where: eq(domainScores.analysisRunId, run.id),
    });
    expect(score?.overallScore).toBeGreaterThan(50);
    expect(score?.seoScore).toBeNull();
    const explanation = score?.explanationJson as { missing: { reason: string }[] };
    expect(explanation.missing.some((m) => /standby/.test(m.reason))).toBe(true);

    const execs = await tdb.db
      .select()
      .from(ruleExecutions)
      .where(eq(ruleExecutions.analysisRunId, run.id));
    expect(execs.length).toBeGreaterThan(5);
    expect(execs.find((e) => e.ruleKey === "gate.short_clean_name")?.matched).toBe(true);

    const summary = await tdb.db.query.domainSummaries.findFirst({
      where: eq(domainSummaries.domainId, domain.id),
    });
    expect(summary?.latestRunStatus).toBe("completed");
    expect(summary?.disposition).toBe("accepted");
    expect(summary?.dnsResolves).toBe(false);
    expect(summary?.overallScore).toBe(score?.overallScore);

    const detail = await getDomainDetail(tdb.db, domain.id);
    expect(detail.runs.length).toBe(1);
    expect(detail.latestScore?.id).toBe(score?.id);
  });

  it("reuses fresh observations on reanalysis and creates new versioned rows", async () => {
    const ctx = createTestContext(tdb.db);
    let dnsCalls = 0;
    ctx.providers.dns = new (class extends FakeDns {
      override enrich() {
        dnsCalls += 1;
        return super.enrich();
      }
    })(true);
    const domain = await upsertDomain(ctx.db, requireNormalized("reuso.com.br"), "manual");
    const first = await requestAnalysis(ctx, { domainId: domain.id, triggerType: "manual" });
    await ctx.stub.drain(ctx);
    expect(dnsCalls).toBe(1);
    const second = await requestAnalysis(ctx, {
      domainId: domain.id,
      triggerType: "reanalysis",
      forceDeep: true,
    });
    expect(second.run.id).not.toBe(first.run.id);
    await ctx.stub.drain(ctx);
    expect(dnsCalls).toBe(1);
    const steps = await getRunSteps(tdb.db, second.run.id);
    expect(
      (steps.find((s) => s.stepKey === "dns")?.metadataJson as { outcome: string }).outcome,
    ).toBe("reused");
    const scores = await tdb.db
      .select()
      .from(domainScores)
      .where(eq(domainScores.domainId, domain.id));
    expect(scores.length).toBe(2);
    const forced = await requestAnalysis(ctx, {
      domainId: domain.id,
      triggerType: "reanalysis",
      forceRefresh: true,
    });
    await ctx.stub.drain(ctx);
    expect(dnsCalls).toBe(2);
    expect(forced.run.id).not.toBe(second.run.id);
  });

  it("routes the crawl through the lease-based crawler job API", async () => {
    const ctx = createTestContext(tdb.db, {
      env: { CRAWLER_ENABLED: "true", CRAWLER_STAGE_WAIT_TIMEOUT_MS: "60000" },
    });
    ctx.providers.dns = new FakeDns(true);
    const domain = await upsertDomain(ctx.db, requireNormalized("crawl-me.com.br"), "manual");
    const { run } = await requestAnalysis(ctx, { domainId: domain.id, triggerType: "manual" });
    await ctx.stub.drain(ctx, { skipTimeouts: true });
    const steps = await getRunSteps(tdb.db, run.id);
    expect(steps.find((s) => s.stepKey === "crawl")?.status).toBe("running");

    const claimed = await claimCrawlerJobs(tdb.db, { workerId: "w1", max: 5, leaseSeconds: 60 });
    expect(claimed.length).toBe(1);
    expect(claimed[0]?.fqdn).toBe("crawl-me.com.br");
    expect(
      await claimCrawlerJobs(tdb.db, { workerId: "w2", max: 5, leaseSeconds: 60 }),
    ).toHaveLength(0);
    await heartbeatCrawlerJob(tdb.db, { jobId: claimed[0]!.id, workerId: "w1", leaseSeconds: 60 });
    await expect(
      heartbeatCrawlerJob(tdb.db, { jobId: claimed[0]!.id, workerId: "w2", leaseSeconds: 60 }),
    ).rejects.toThrow(/not claimed/);

    await completeCrawlerJob(ctx, {
      jobId: claimed[0]!.id,
      workerId: "w1",
      result: {
        reachable: true,
        httpsAvailable: true,
        status: 200,
        redirectCount: 1,
        redirectChain: ["http://crawl-me.com.br/"],
        finalUrl: "https://www.crawl-me.com.br/",
        finalHostname: "www.crawl-me.com.br",
        title: "Crawl me",
        metaDescription: null,
        contentType: "text/html",
        contentLength: 1234,
        server: "nginx",
        securityBlocked: false,
        error: null,
        durationMs: 250,
      },
    });
    await ctx.stub.drain(ctx, { skipTimeouts: true });
    const finished = await tdb.db.query.analysisRuns.findFirst({
      where: eq(analysisRuns.id, run.id),
    });
    expect(finished?.status).toBe("completed");
    const metrics = toMetricContext(await latestObservations(tdb.db, domain.id));
    expect(metrics["http.status"]?.value).toBe(200);
    expect(metrics["http.title"]?.value).toBe("Crawl me");
    const summary = await tdb.db.query.domainSummaries.findFirst({
      where: eq(domainSummaries.domainId, domain.id),
    });
    expect(summary?.httpStatus).toBe(200);
  });

  it("gives up waiting for the crawler after the timeout job fires", async () => {
    const ctx = createTestContext(tdb.db, { env: { CRAWLER_ENABLED: "true" } });
    ctx.providers.dns = new FakeDns(true);
    const domain = await upsertDomain(ctx.db, requireNormalized("timeout.com.br"), "manual");
    const { run } = await requestAnalysis(ctx, { domainId: domain.id, triggerType: "manual" });
    await ctx.stub.drain(ctx);
    const finished = await tdb.db.query.analysisRuns.findFirst({
      where: eq(analysisRuns.id, run.id),
    });
    expect(finished?.status).toBe("completed");
    const steps = await getRunSteps(tdb.db, run.id);
    expect(steps.find((s) => s.stepKey === "crawl")?.status).toBe("skipped");
    expect(steps.find((s) => s.stepKey === "crawl")?.errorCode).toBe("CRAWL_WAIT_TIMEOUT");
  });

  it("ingests a Registro.br artifact once and detects changed content", async () => {
    const ctx = createTestContext(tdb.db);
    ctx.providers.dns = new FakeDns(false);
    const adapterA = new RegistroBrReleaseSourceAdapter({ fetchImpl: fetchFor(FIXTURE_A, '"v1"') });
    const first = await watchRegistroBr(ctx, adapterA);
    expect(first.changed).toBe(true);
    expect(first.reason).toBe("new_batch");
    expect(first.stats?.total).toBe(3);
    expect(first.stats?.invalid).toBe(1);
    expect(first.stats?.runsCreated).toBe(3);
    expect(first.batch?.publishedAt).toBeInstanceOf(Date);
    expect(
      (ctx.storage as MemoryObjectStorage)
        .keys()
        .some((k) => k.startsWith("sources/registro-br-release/")),
    ).toBe(true);

    const second = await watchRegistroBr(ctx, adapterA);
    expect(second.changed).toBe(false);
    expect(second.reason).toBe("not_modified");

    const noEtag = new RegistroBrReleaseSourceAdapter({
      fetchImpl: fetchFor(FIXTURE_A, '"v1-other"'),
    });
    const third = await watchRegistroBr(ctx, noEtag);
    expect(third.changed).toBe(false);
    expect(third.reason).toBe("same_sha");

    const adapterB = new RegistroBrReleaseSourceAdapter({ fetchImpl: fetchFor(FIXTURE_B, '"v2"') });
    const fourth = await watchRegistroBr(ctx, adapterB);
    expect(fourth.changed).toBe(true);
    expect(fourth.stats?.total).toBe(4);
    expect(fourth.stats?.newDomains).toBe(1);
    const batches = await tdb.db.select().from(sourceBatches);
    expect(batches.filter((b) => b.contentSha256 === fourth.batch!.contentSha256).length).toBe(1);

    await ctx.stub.drain(ctx);
    const detail = await getBatchDetail(tdb.db, fourth.batch!.id);
    expect(detail.funnel.total).toBe(4);
    expect(detail.funnel.previouslySeen).toBe(3);
    expect(detail.funnel.analyzed).toBeGreaterThan(0);
    const listed = await listDomains(tdb.db, {
      limit: 10,
      sort: "overall_score",
      order: "desc",
      batchId: fourth.batch!.id,
    });
    expect(listed.items.length).toBe(4);
  });

  it("imports CSV with row-level errors and dedupes against existing domains", async () => {
    const ctx = createTestContext(tdb.db);
    const adapter = new CsvSourceAdapter();
    const artifact = adapter.artifactFromContent(
      "domain\ncafe.com.br\nnova-importacao.com.br\nbad domain\n",
    );
    const result = await ingestArtifact(ctx, {
      adapter,
      artifact,
      analyze: false,
      triggerType: "csv_import",
      name: "test import",
    });
    expect(result.created).toBe(true);
    expect(result.stats.total).toBe(2);
    expect(result.stats.newDomains).toBe(1);
    expect(result.stats.invalid).toBe(1);
    const dup = await ingestArtifact(ctx, {
      adapter,
      artifact,
      analyze: false,
      triggerType: "csv_import",
    });
    expect(dup.created).toBe(false);
    expect(dup.batch.id).toBe(result.batch.id);
    const manual = new ManualSourceAdapter();
    const m = await ingestArtifact(ctx, {
      adapter: manual,
      artifact: manual.artifactFromDomains(["cafe.com.br"]),
      analyze: false,
      triggerType: "manual",
    });
    expect(m.stats.newDomains).toBe(0);
  });

  it("supports shortlists with safe CSV export", async () => {
    const ctx = createTestContext(tdb.db);
    const actor = { id: null, email: "test@example.com" };
    const list = await createShortlist(tdb.db, { name: "Q4 targets" }, actor);
    expect(() => requireNormalized("=cmd.com.br")).toThrow(/Invalid label/);
    const ok = await upsertDomain(ctx.db, requireNormalized("cafe.com.br"), "manual");
    await addDomainToShortlist(
      tdb.db,
      list.id,
      { domainId: ok.id, note: '=HYPERLINK("x")', rank: 1 },
      actor,
    );
    const detail = await getShortlist(tdb.db, list.id);
    expect(detail.domains.length).toBe(1);
    const csv = await exportShortlistCsv(tdb.db, list.id);
    expect(csv).toContain("cafe.com.br");
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    const summary = await tdb.db.query.domainSummaries.findFirst({
      where: eq(domainSummaries.domainId, ok.id),
    });
    expect(summary?.shortlistCount).toBe(1);
  });

  it("retries failed runs as new runs and applies retention", async () => {
    const ctx = createTestContext(tdb.db);
    const domain = await upsertDomain(ctx.db, requireNormalized("retry.com.br"), "manual");
    const { run } = await requestAnalysis(ctx, { domainId: domain.id, triggerType: "manual" });
    await tdb.db.update(analysisRuns).set({ status: "failed" }).where(eq(analysisRuns.id, run.id));
    ctx.stub.pending.length = 0;
    const retried = await retryRun(ctx, run.id, null);
    expect(retried.triggerReference).toBe(run.id);
    expect(retried.forceRefresh).toBe(true);
    await tdb.db
      .insert(domainObservations)
      .values({
        domainId: domain.id,
        providerKey: "semrush",
        metricKey: "seo.authority",
        valueType: "numeric",
        valueNumeric: 42,
        state: "measured",
        licenseClass: "provider_restricted",
        observedAt: new Date(Date.now() - 40 * 24 * 3600 * 1000),
      });
    const report = await runRetention(tdb.db, { restrictedRetentionDays: 30 });
    expect(report.purgedRestrictedObservations).toBe(1);
    const purged = await tdb.db.query.domainObservations.findFirst({
      where: eq(domainObservations.metricKey, "seo.authority"),
    });
    expect(purged?.valueNumeric).toBeNull();
    expect(purged?.purgedAt).not.toBeNull();
  });
});
