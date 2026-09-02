import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { updateProviderBodySchema } from "@dominio-x/contracts";
import { getProvider, listProviders, updateProvider } from "@dominio-x/domain-core";
import { actorOf, requireRole } from "../auth/session.js";
import type { ApiDeps } from "../deps.js";

const keyParams = z.object({ key: z.string().min(1).max(64) });

export const providerRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = async (app, { deps }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/providers",
    { schema: { tags: ["providers"] }, preHandler: requireRole("viewer") },
    async () => ({ items: await listProviders(deps.core) }),
  );
  r.get(
    "/providers/:key",
    { schema: { tags: ["providers"], params: keyParams }, preHandler: requireRole("viewer") },
    async (request) => getProvider(deps.core, request.params.key),
  );
  r.patch(
    "/providers/:key",
    {
      schema: { tags: ["providers"], params: keyParams, body: updateProviderBodySchema },
      preHandler: requireRole("admin"),
    },
    async (request) => {
      await updateProvider(deps.core.db, request.params.key, request.body, actorOf(request));
      return getProvider(deps.core, request.params.key);
    },
  );
};
