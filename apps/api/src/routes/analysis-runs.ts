import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { listAnalysisRunsQuerySchema } from "@dominio-x/contracts";
import {
  getRunSteps,
  listObservationsForRun,
  listRuns,
  recordAudit,
  requireRun,
  retryRun,
} from "@dominio-x/domain-core";
import { actorOf, requireRole, requireUser } from "../auth/session.js";
import type { ApiDeps } from "../deps.js";

const idParams = z.object({ runId: z.string().uuid() });

export const analysisRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = async (app, { deps }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const core = deps.core;

  r.get(
    "/analysis-runs",
    {
      schema: { tags: ["analysis"], querystring: listAnalysisRunsQuerySchema },
      preHandler: requireRole("viewer"),
    },
    async (request) => listRuns(core.db, request.query),
  );

  r.get(
    "/analysis-runs/:runId",
    { schema: { tags: ["analysis"], params: idParams }, preHandler: requireRole("viewer") },
    async (request) => {
      const run = await requireRun(core.db, request.params.runId);
      const [steps, observations] = await Promise.all([
        getRunSteps(core.db, run.id),
        listObservationsForRun(core.db, run.id),
      ]);
      return { run, steps, observations };
    },
  );

  r.post(
    "/analysis-runs/:runId/retry",
    { schema: { tags: ["analysis"], params: idParams }, preHandler: requireRole("analyst") },
    async (request, reply) => {
      const user = requireUser(request);
      const run = await retryRun(core, request.params.runId, user.id);
      await recordAudit(core.db, {
        action: "analysis_run.retry",
        actor: actorOf(request),
        targetType: "analysis_run",
        targetId: request.params.runId,
        details: { newRunId: run.id },
      });
      return reply.status(202).send({ run });
    },
  );
};
