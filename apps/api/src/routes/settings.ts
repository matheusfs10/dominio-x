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
  updateCandidateGateSettings,
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
      await recordAudit(db, {
        action: "settings.updated",
        actor: actorOf(request),
        targetType: "settings",
        targetId: "candidate_gate",
        details: request.body,
      });
      return { ...(await getAllSettings(db)), updated: { candidateGate } };
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
