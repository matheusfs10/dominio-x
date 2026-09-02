import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { USER_ROLES, createUserBodySchema } from "@dominio-x/contracts";
import { createUser, listUsers, updateUser } from "@dominio-x/domain-core";
import { requireRole, requireUser } from "../auth/session.js";
import type { ApiDeps } from "../deps.js";

export const userRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = async (app, { deps }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = deps.core.db;
  r.get("/users", { schema: { tags: ["users"] }, preHandler: requireRole("admin") }, async () => ({
    items: await listUsers(db),
  }));
  r.post(
    "/users",
    { schema: { tags: ["users"], body: createUserBodySchema }, preHandler: requireRole("admin") },
    async (request, reply) => {
      const actor = requireUser(request);
      return reply.status(201).send({ user: await createUser(db, request.body, actor) });
    },
  );
  r.patch(
    "/users/:id",
    {
      schema: {
        tags: ["users"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          role: z.enum(USER_ROLES).optional(),
          active: z.boolean().optional(),
          name: z.string().min(1).max(120).optional(),
        }),
      },
      preHandler: requireRole("admin"),
    },
    async (request) => {
      await updateUser(db, request.params.id, request.body, requireUser(request));
      return { ok: true };
    },
  );
};
