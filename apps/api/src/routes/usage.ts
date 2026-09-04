import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { usageQuerySchema } from "@dominio-x/contracts";
import { usageReport } from "@dominio-x/domain-core";
import { requireRole } from "../auth/session.js";
import type { ApiDeps } from "../deps.js";

export const usageRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = async (app, { deps }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/usage",
    {
      schema: { tags: ["usage"], querystring: usageQuerySchema },
      preHandler: requireRole("viewer"),
    },
    async (request) => {
      const config = {
        semrush: deps.core.semrush,
        dataforseo: deps.core.dataforseo,
        trafficState: deps.core.providers.dataforseo.describeStatus().state,
      };
      return usageReport(deps.core.db, config, { days: request.query.days });
    },
  );
};
