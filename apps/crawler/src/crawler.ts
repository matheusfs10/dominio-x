import { hostname } from "node:os";
import { loadCrawlerConfig } from "@dominio-x/config";
import type { CrawlerJob } from "@dominio-x/contracts";
import { createLogger, initSentry } from "@dominio-x/observability";
import { CoreApiError, CoreClient } from "./client.js";
import { crawlDomain } from "./crawl.js";
import type { SafeFetchOptions } from "./security/safe-fetch.js";

/**
 * Isolated crawler process. Holds no database, queue or provider credentials: it only speaks to
 * the Core machine API over HTTPS with a crawler-scoped token.
 */
async function main() {
  const config = loadCrawlerConfig();
  const logger = createLogger({ service: "crawler", level: config.LOG_LEVEL });
  await initSentry({ dsn: config.SENTRY_DSN, service: "crawler", environment: config.NODE_ENV });
  const workerId = config.CRAWLER_WORKER_ID ?? `${hostname()}-${process.pid}`;
  const client = new CoreClient(
    config.CRAWLER_CORE_API_URL,
    config.CRAWLER_MACHINE_TOKEN,
    workerId,
  );
  const fetchOptions: SafeFetchOptions = {
    connectTimeoutMs: config.CRAWLER_CONNECT_TIMEOUT_MS,
    totalTimeoutMs: config.CRAWLER_TOTAL_TIMEOUT_MS,
    maxRedirects: config.CRAWLER_MAX_REDIRECTS,
    maxBodyBytes: config.CRAWLER_MAX_BODY_BYTES,
    maxDecompressedBytes: config.CRAWLER_MAX_DECOMPRESSED_BYTES,
    userAgent: config.CRAWLER_USER_AGENT,
  };

  let stopping = false;
  let inFlight = 0;
  const stop = (signal: string) => {
    logger.info({ signal, inFlight }, "crawler stopping after in-flight jobs");
    stopping = true;
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  logger.info(
    {
      workerId,
      coreApi: new URL(config.CRAWLER_CORE_API_URL).host,
      concurrency: config.CRAWLER_CONCURRENCY,
      limits: fetchOptions,
    },
    "crawler started",
  );

  async function processJob(job: CrawlerJob, leaseSeconds: number): Promise<void> {
    inFlight += 1;
    const log = logger.child({
      jobId: job.id,
      analysisRunId: job.analysisRunId,
      domainId: job.domainId,
      fqdn: job.fqdn,
    });
    const heartbeat = setInterval(
      () => {
        client
          .heartbeat(job.id)
          .catch((error: unknown) => log.warn({ err: error }, "heartbeat failed"));
      },
      Math.max(5_000, (leaseSeconds * 1000) / 3),
    );
    try {
      const result = await crawlDomain(job.fqdn, fetchOptions);
      await client.complete(job.id, result);
      log.info(
        {
          status: result.status,
          reachable: result.reachable,
          blocked: result.securityBlocked,
          redirects: result.redirectCount,
          durationMs: result.durationMs,
        },
        "job completed",
      );
    } catch (error) {
      const retryable = !(error instanceof CoreApiError && error.status < 500);
      log.error({ err: error }, "job failed");
      await client
        .fail(
          job.id,
          "CRAWLER_ERROR",
          error instanceof Error ? error.message : "unknown",
          retryable,
        )
        .catch((e: unknown) => log.error({ err: e }, "could not report failure"));
    } finally {
      clearInterval(heartbeat);
      inFlight -= 1;
    }
  }

  while (!stopping) {
    try {
      const free = config.CRAWLER_CONCURRENCY - inFlight;
      if (free <= 0) {
        await sleep(500);
        continue;
      }
      const { jobs, leaseSeconds } = await client.claim(Math.min(free, 10));
      if (jobs.length === 0) {
        await sleep(config.CRAWLER_POLL_INTERVAL_MS);
        continue;
      }
      for (const job of jobs) void processJob(job, leaseSeconds);
      await sleep(100);
    } catch (error) {
      logger.error({ err: error }, "claim loop error; backing off");
      await sleep(Math.min(60_000, config.CRAWLER_POLL_INTERVAL_MS * 3));
    }
  }
  while (inFlight > 0) await sleep(250);
  logger.info("crawler stopped");
  process.exit(0);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((error: unknown) => {
  console.error("[crawler] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
