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

  /**
   * Live account balance of the paid traffic provider. The upstream endpoint is documented as
   * free of charge and the result is cached in the adapter, so this is safe to call from the UI.
   */
  r.get(
    "/providers/dataforseo/account",
    { schema: { tags: ["providers"] }, preHandler: requireRole("admin") },
    async () => {
      const provider = deps.core.providers.dataforseo;
      const status = provider.describeStatus();
      if (!status.configured) {
        return { configured: false, state: status.state, balanceUsd: null, totalUsd: null };
      }
      try {
        const account = await provider.accountBalance();
        return {
          configured: true,
          state: status.state,
          balanceUsd: account.balanceUsd,
          totalUsd: account.totalUsd,
        };
      } catch (error) {
        deps.core.logger.warn({ err: error }, "dataforseo balance lookup failed");
        return {
          configured: true,
          state: status.state,
          balanceUsd: null,
          totalUsd: null,
          error: error instanceof Error ? error.message : "unknown error",
        };
      }
    },
  );

  /**
   * Captcha-solving credit behind the authority provider. One lookup costs one solve, so this
   * balance is what actually limits how many Domain Rating lookups are still possible. The
   * upstream endpoint is free and the result is cached in the solver.
   */
  r.get(
    "/providers/ahrefs/account",
    { schema: { tags: ["providers"] }, preHandler: requireRole("admin") },
    async () => {
      const provider = deps.core.providers.ahrefs;
      const solver = deps.core.providers.capsolver.describeStatus();
      const status = provider.describeStatus();
      const base = {
        state: status.state,
        solverState: solver.state,
        costPerLookupUsd: provider.costPerLookupUsd,
      };
      if (!solver.configured) return { ...base, configured: false, balanceUsd: null };
      try {
        return { ...base, configured: true, balanceUsd: await provider.solverBalanceUsd() };
      } catch (error) {
        deps.core.logger.warn({ err: error }, "captcha solver balance lookup failed");
        return {
          ...base,
          configured: true,
          balanceUsd: null,
          error: error instanceof Error ? error.message : "unknown error",
        };
      }
    },
  );
};
