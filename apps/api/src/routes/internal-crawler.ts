import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  crawlerClaimBodySchema,
  crawlerCompleteBodySchema,
  crawlerFailBodySchema,
  crawlerHeartbeatBodySchema,
} from "@dominio-x/contracts";
import {
  claimCrawlerJobs,
  completeCrawlerJob,
  failCrawlerJob,
  heartbeatCrawlerJob,
} from "@dominio-x/domain-core";
import { requireMachineToken } from "../auth/machine.js";
import type { ApiDeps } from "../deps.js";

const jobParams = z.object({ jobId: z.string().uuid() });

/**
 * Narrow machine API consumed by the isolated crawler project. Protected by a dedicated
 * machine token (never a user session) and its own rate limit.
 */
export const internalCrawlerRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = async (
  app,
  { deps },
) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const guard = requireMachineToken(deps.config.CRAWLER_MACHINE_TOKEN);
  const lease = deps.config.CRAWLER_JOB_LEASE_SECONDS;
  const rl = { rateLimit: { max: 600, timeWindow: "1 minute" } };

  r.post(
    "/internal/crawler/jobs/claim",
    {
      schema: { tags: ["internal"], body: crawlerClaimBodySchema, security: [{ machine: [] }] },
      preHandler: guard,
      config: rl,
    },
    async (request) => ({
      jobs: await claimCrawlerJobs(deps.core.db, {
        workerId: request.body.workerId,
        max: request.body.max,
        leaseSeconds: lease,
      }),
      leaseSeconds: lease,
    }),
  );

  r.post(
    "/internal/crawler/jobs/:jobId/heartbeat",
    {
      schema: {
        tags: ["internal"],
        params: jobParams,
        body: crawlerHeartbeatBodySchema,
        security: [{ machine: [] }],
      },
      preHandler: guard,
      config: rl,
    },
    async (request) =>
      heartbeatCrawlerJob(deps.core.db, {
        jobId: request.params.jobId,
        workerId: request.body.workerId,
        leaseSeconds: lease,
      }),
  );

  r.post(
    "/internal/crawler/jobs/:jobId/complete",
    {
      schema: {
        tags: ["internal"],
        params: jobParams,
        body: crawlerCompleteBodySchema,
        security: [{ machine: [] }],
      },
      preHandler: guard,
      config: rl,
    },
    async (request) => {
      await completeCrawlerJob(deps.core, {
        jobId: request.params.jobId,
        workerId: request.body.workerId,
        result: request.body.result,
      });
      return { ok: true };
    },
  );

  r.post(
    "/internal/crawler/jobs/:jobId/fail",
    {
      schema: {
        tags: ["internal"],
        params: jobParams,
        body: crawlerFailBodySchema,
        security: [{ machine: [] }],
      },
      preHandler: guard,
      config: rl,
    },
    async (request) =>
      failCrawlerJob(deps.core, {
        jobId: request.params.jobId,
        workerId: request.body.workerId,
        errorCode: request.body.errorCode,
        message: request.body.message,
        retryable: request.body.retryable,
      }),
  );
};
