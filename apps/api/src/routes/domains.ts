import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  AppError,
  addNoteBodySchema,
  addTagBodySchema,
  analyzeDomainBodySchema,
  createDomainBodySchema,
  listDomainsQuerySchema,
  manualDispositionBodySchema,
} from "@dominio-x/contracts";
import { ruleExecutions } from "@dominio-x/database";
import {
  addNote,
  addTag,
  getDomainDetail,
  listDomains,
  listObservationsForDomain,
  listRuns,
  listScoresForDomain,
  recentProviderRequestsForDomain,
  recordAudit,
  removeTag,
  requestAnalysis,
  requireNormalized,
  setManualDisposition,
  upsertDomain,
} from "@dominio-x/domain-core";
import { actorOf, requireRole, requireUser } from "../auth/session.js";
import type { ApiDeps } from "../deps.js";

const idParams = z.object({ domainId: z.string().uuid() });

export const domainRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = async (app, { deps }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const core = deps.core;

  r.get(
    "/domains",
    {
      schema: { tags: ["domains"], querystring: listDomainsQuerySchema },
      preHandler: requireRole("viewer"),
    },
    async (request) => listDomains(core.db, request.query),
  );

  r.post(
    "/domains",
    {
      schema: { tags: ["domains"], body: createDomainBodySchema },
      preHandler: requireRole("analyst"),
    },
    async (request, reply) => {
      const user = requireUser(request);
      const normalized = requireNormalized(request.body.domain);
      const domain = await upsertDomain(core.db, normalized, "manual");
      await recordAudit(core.db, {
        action: "domain.created",
        actor: actorOf(request),
        targetType: "domain",
        targetId: domain.id,
        details: { fqdn: normalized.asciiFqdn, isNew: domain.isNew },
      });
      let run = null;
      if (request.body.analyze) {
        const result = await requestAnalysis(core, {
          domainId: domain.id,
          triggerType: "manual",
          requestedBy: user.id,
          forceDeep: request.body.forceDeep,
          forceRefresh: request.body.forceDeep,
          priority: 50,
        });
        run = { id: result.run.id, status: result.run.status, created: result.created };
      }
      return reply
        .status(domain.isNew ? 201 : 200)
        .send({
          domain: {
            id: domain.id,
            asciiFqdn: domain.asciiFqdn,
            unicodeFqdn: normalized.unicodeFqdn,
            isNew: domain.isNew,
          },
          run,
        });
    },
  );

  r.get(
    "/domains/:domainId",
    { schema: { tags: ["domains"], params: idParams }, preHandler: requireRole("viewer") },
    async (request) => getDomainDetail(core.db, request.params.domainId),
  );

  r.post(
    "/domains/:domainId/analyze",
    {
      schema: { tags: ["domains"], params: idParams, body: analyzeDomainBodySchema },
      preHandler: requireRole("analyst"),
    },
    async (request, reply) => {
      const user = requireUser(request);
      const detail = await getDomainDetail(core.db, request.params.domainId);
      const result = await requestAnalysis(core, {
        domainId: detail.domain.id,
        triggerType: "reanalysis",
        requestedBy: user.id,
        forceDeep: request.body.forceDeep,
        forceRefresh: request.body.forceRefresh || request.body.forceDeep,
        priority: 50,
        triggerReference: request.body.reason ?? null,
      });
      await recordAudit(core.db, {
        action: request.body.forceDeep
          ? "domain.deep_analysis_forced"
          : "domain.reanalysis_requested",
        actor: actorOf(request),
        targetType: "domain",
        targetId: detail.domain.id,
        details: { runId: result.run.id, created: result.created },
      });
      return reply
        .status(result.created ? 202 : 200)
        .send({ run: result.run, created: result.created });
    },
  );

  r.get(
    "/domains/:domainId/analyses",
    { schema: { tags: ["domains"], params: idParams }, preHandler: requireRole("viewer") },
    async (request) => listRuns(core.db, { limit: 50, domainId: request.params.domainId }),
  );

  r.get(
    "/domains/:domainId/observations",
    { schema: { tags: ["domains"], params: idParams }, preHandler: requireRole("viewer") },
    async (request) => ({
      items: await listObservationsForDomain(core.db, request.params.domainId),
    }),
  );

  r.get(
    "/domains/:domainId/rules",
    { schema: { tags: ["domains"], params: idParams }, preHandler: requireRole("viewer") },
    async (request) => ({
      items: await core.db
        .select()
        .from(ruleExecutions)
        .where(eq(ruleExecutions.domainId, request.params.domainId))
        .orderBy(ruleExecutions.createdAt)
        .limit(500),
    }),
  );

  r.get(
    "/domains/:domainId/scores",
    { schema: { tags: ["domains"], params: idParams }, preHandler: requireRole("viewer") },
    async (request) => ({ items: await listScoresForDomain(core.db, request.params.domainId) }),
  );

  r.get(
    "/domains/:domainId/provider-requests",
    { schema: { tags: ["domains"], params: idParams }, preHandler: requireRole("viewer") },
    async (request) => ({
      items: await recentProviderRequestsForDomain(core.db, request.params.domainId),
    }),
  );

  r.post(
    "/domains/:domainId/tags",
    {
      schema: { tags: ["domains"], params: idParams, body: addTagBodySchema },
      preHandler: requireRole("analyst"),
    },
    async (request) => ({
      tag: await addTag(core.db, request.params.domainId, request.body.tag, actorOf(request)),
    }),
  );

  r.delete(
    "/domains/:domainId/tags/:tag",
    {
      schema: { tags: ["domains"], params: idParams.extend({ tag: z.string().min(1).max(64) }) },
      preHandler: requireRole("analyst"),
    },
    async (request) => {
      await removeTag(core.db, request.params.domainId, request.params.tag, actorOf(request));
      return { ok: true };
    },
  );

  r.post(
    "/domains/:domainId/notes",
    {
      schema: { tags: ["domains"], params: idParams, body: addNoteBodySchema },
      preHandler: requireRole("analyst"),
    },
    async (request, reply) =>
      reply
        .status(201)
        .send({
          note: await addNote(
            core.db,
            request.params.domainId,
            request.body.body,
            actorOf(request),
          ),
        }),
  );

  r.post(
    "/domains/:domainId/disposition",
    {
      schema: { tags: ["domains"], params: idParams, body: manualDispositionBodySchema },
      preHandler: requireRole("analyst"),
    },
    async (request) => {
      await getDomainDetail(core.db, request.params.domainId).catch(() => {
        throw new AppError("NOT_FOUND", "Domain not found.");
      });
      return {
        disposition: await setManualDisposition(
          core.db,
          request.params.domainId,
          request.body.disposition,
          request.body.note,
          actorOf(request),
        ),
      };
    },
  );
};
