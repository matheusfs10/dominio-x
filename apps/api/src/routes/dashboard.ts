import type { FastifyPluginAsync } from "fastify";
import { dashboard, crawlerQueueCounts } from "@dominio-x/domain-core";
import { getQueueCounts } from "@dominio-x/queue";
import { requireRole } from "../auth/session.js";
import type { ApiDeps } from "../deps.js";

export const dashboardRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.get(
    "/dashboard",
    { schema: { tags: ["dashboard"] }, preHandler: requireRole("viewer") },
    async () => dashboard(deps.core),
  );

  app.get(
    "/queue",
    { schema: { tags: ["dashboard"] }, preHandler: requireRole("viewer") },
    async () => {
      const [stages, crawler] = await Promise.all([
        getQueueCounts(deps.core.queues),
        crawlerQueueCounts(deps.core.db),
      ]);
      return { stages, crawler };
    },
  );
};
