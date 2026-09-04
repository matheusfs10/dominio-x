import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { updateSettingsBodySchema } from "@dominio-x/contracts";
import {
  addBlacklistEntry,
  getAllSettings,
  listBlacklist,
  recordAudit,
  removeBlacklistEntry,
  updateAuthorityGateSettings,
  updateCandidateGateSettings,
  updateTrafficGateSettings,
} from "@dominio-x/domain-core";
import { actorOf, requireRole, requireUser } from "../auth/session.js";
import type { ApiDeps } from "../deps.js";

export const settingsRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = async (app, { deps }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = deps.core.db;

  r.get(
    "/settings",
    { schema: { tags: ["settings"] }, preHandler: requireRole("viewer") },
    async () => ({
      ...(await getAllSettings(db)),
      pipeline: {
        crawlerEnabled: deps.config.CRAWLER_ENABLED,
        rdapEnabled: deps.config.RDAP_ENABLED,
        dnsTtlHours: deps.config.DNS_TTL_HOURS,
        httpTtlHours: deps.config.HTTP_TTL_HOURS,
        semrushDataTtlDays: deps.config.SEMRUSH_DATA_TTL_DAYS,
        providerRestrictedRetentionDays: deps.config.PROVIDER_RESTRICTED_RETENTION_DAYS,
        dataforseoEnabled: deps.config.DATAFORSEO_ENABLED,
        dataforseoLocation: `${deps.config.DATAFORSEO_LOCATION_NAME} (${deps.config.DATAFORSEO_LOCATION_CODE})`,
        dataforseoWindowMonths: deps.config.DATAFORSEO_WINDOW_MONTHS,
        dataforseoDataTtlDays: deps.config.DATAFORSEO_DATA_TTL_DAYS,
        dataforseoMonthlyCostBudgetUsd: deps.config.DATAFORSEO_MONTHLY_COST_BUDGET_USD ?? null,
        ahrefsEnabled: deps.config.AHREFS_ENABLED,
        ahrefsMode: deps.config.AHREFS_MODE,
        ahrefsDataTtlDays: deps.config.AHREFS_DATA_TTL_DAYS,
        ahrefsMonthlyCostBudgetUsd: deps.config.AHREFS_MONTHLY_COST_BUDGET_USD ?? null,
        ahrefsCostPerLookupUsd: deps.core.providers.ahrefs.costPerLookupUsd,
        captchaSolverState: deps.core.providers.capsolver.describeStatus().state,
      },
    }),
  );

  r.patch(
    "/settings",
    {
      schema: { tags: ["settings"], body: updateSettingsBodySchema },
      preHandler: requireRole("admin"),
    },
    async (request) => {
      const user = requireUser(request);
      const candidateGate = request.body.candidateGate
        ? await updateCandidateGateSettings(db, request.body.candidateGate, user.id)
        : undefined;
      const trafficGate = request.body.trafficGate
        ? await updateTrafficGateSettings(db, request.body.trafficGate, user.id)
        : undefined;
      const authorityGate = request.body.authorityGate
        ? await updateAuthorityGateSettings(db, request.body.authorityGate, user.id)
        : undefined;
      await recordAudit(db, {
        action: "settings.updated",
        actor: actorOf(request),
        targetType: "settings",
        targetId: Object.keys(request.body).join(",") || "settings",
        details: request.body,
      });
      return {
        ...(await getAllSettings(db)),
        updated: { candidateGate, trafficGate, authorityGate },
      };
    },
  );

  r.get(
    "/blacklist",
    { schema: { tags: ["settings"] }, preHandler: requireRole("viewer") },
    async () => ({ items: await listBlacklist(db) }),
  );
  r.post(
    "/blacklist",
    {
      schema: {
        tags: ["settings"],
        body: z.object({ pattern: z.string().min(1).max(255), reason: z.string().min(1).max(500) }),
      },
      preHandler: requireRole("analyst"),
    },
    async (request, reply) =>
      reply
        .status(201)
        .send({ entry: await addBlacklistEntry(db, request.body, actorOf(request)) }),
  );
  r.delete(
    "/blacklist/:id",
    {
      schema: { tags: ["settings"], params: z.object({ id: z.string().uuid() }) },
      preHandler: requireRole("analyst"),
    },
    async (request) => {
      await removeBlacklistEntry(db, request.params.id, actorOf(request));
      return { ok: true };
    },
  );
};
