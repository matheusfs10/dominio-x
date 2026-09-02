import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { auditQuerySchema } from "@dominio-x/contracts";
import { listAudit } from "@dominio-x/domain-core";
import { requireRole } from "../auth/session.js";
import type { ApiDeps } from "../deps.js";

export const auditRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = async (app, { deps }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/audit",
    {
      schema: { tags: ["audit"], querystring: auditQuerySchema },
      preHandler: requireRole("analyst"),
    },
    async (request) => listAudit(deps.core.db, request.query),
  );
};
