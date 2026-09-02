import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  addShortlistDomainBodySchema,
  createShortlistBodySchema,
  updateShortlistBodySchema,
} from "@dominio-x/contracts";
import {
  addDomainToShortlist,
  createShortlist,
  exportShortlistCsv,
  getShortlist,
  listShortlists,
  removeDomainFromShortlist,
  updateShortlist,
} from "@dominio-x/domain-core";
import { actorOf, requireRole } from "../auth/session.js";
import type { ApiDeps } from "../deps.js";

const idParams = z.object({ id: z.string().uuid() });

export const shortlistRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = async (app, { deps }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = deps.core.db;

  r.get(
    "/shortlists",
    { schema: { tags: ["shortlists"] }, preHandler: requireRole("viewer") },
    async () => ({ items: await listShortlists(db) }),
  );
  r.post(
    "/shortlists",
    {
      schema: { tags: ["shortlists"], body: createShortlistBodySchema },
      preHandler: requireRole("analyst"),
    },
    async (request, reply) =>
      reply
        .status(201)
        .send({ shortlist: await createShortlist(db, request.body, actorOf(request)) }),
  );
  r.get(
    "/shortlists/:id",
    { schema: { tags: ["shortlists"], params: idParams }, preHandler: requireRole("viewer") },
    async (request) => getShortlist(db, request.params.id),
  );
  r.patch(
    "/shortlists/:id",
    {
      schema: { tags: ["shortlists"], params: idParams, body: updateShortlistBodySchema },
      preHandler: requireRole("analyst"),
    },
    async (request) => ({
      shortlist: await updateShortlist(db, request.params.id, request.body, actorOf(request)),
    }),
  );
  r.post(
    "/shortlists/:id/domains",
    {
      schema: { tags: ["shortlists"], params: idParams, body: addShortlistDomainBodySchema },
      preHandler: requireRole("analyst"),
    },
    async (request, reply) => {
      await addDomainToShortlist(db, request.params.id, request.body, actorOf(request));
      return reply.status(201).send({ ok: true });
    },
  );
  r.delete(
    "/shortlists/:id/domains/:domainId",
    {
      schema: { tags: ["shortlists"], params: idParams.extend({ domainId: z.string().uuid() }) },
      preHandler: requireRole("analyst"),
    },
    async (request) => {
      await removeDomainFromShortlist(
        db,
        request.params.id,
        request.params.domainId,
        actorOf(request),
      );
      return { ok: true };
    },
  );
  r.get(
    "/shortlists/:id/export.csv",
    { schema: { tags: ["shortlists"], params: idParams }, preHandler: requireRole("viewer") },
    async (request, reply) => {
      const csv = await exportShortlistCsv(db, request.params.id);
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="shortlist-${request.params.id}.csv"`)
        .send(csv);
    },
  );
};
