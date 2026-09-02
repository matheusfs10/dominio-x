import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createRulesetBodySchema,
  testRulesetBodySchema,
  updateRulesetBodySchema,
} from "@dominio-x/contracts";
import {
  activateRuleset,
  cloneRuleset,
  createDraftRuleset,
  getRuleset,
  listRulesets,
  testRuleset,
  updateDraftRuleset,
  validateRules,
} from "@dominio-x/domain-core";
import { RULE_OPERATORS } from "@dominio-x/rule-engine";
import { actorOf, requireRole } from "../auth/session.js";
import type { ApiDeps } from "../deps.js";

const idParams = z.object({ id: z.string().uuid() });

export const rulesetRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = async (app, { deps }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = deps.core.db;

  r.get(
    "/rulesets",
    { schema: { tags: ["rules"] }, preHandler: requireRole("viewer") },
    async () => ({ items: await listRulesets(db), operators: RULE_OPERATORS }),
  );
  r.post(
    "/rulesets",
    {
      schema: { tags: ["rules"], body: createRulesetBodySchema },
      preHandler: requireRole("analyst"),
    },
    async (request, reply) =>
      reply.status(201).send(await createDraftRuleset(db, request.body, actorOf(request))),
  );
  r.post(
    "/rulesets/validate",
    {
      schema: { tags: ["rules"], body: createRulesetBodySchema },
      preHandler: requireRole("analyst"),
    },
    async (request) => ({ issues: validateRules(request.body.rules) }),
  );
  r.get(
    "/rulesets/:id",
    { schema: { tags: ["rules"], params: idParams }, preHandler: requireRole("viewer") },
    async (request) => getRuleset(db, request.params.id),
  );
  r.patch(
    "/rulesets/:id",
    {
      schema: { tags: ["rules"], params: idParams, body: updateRulesetBodySchema },
      preHandler: requireRole("analyst"),
    },
    async (request) => updateDraftRuleset(db, request.params.id, request.body, actorOf(request)),
  );
  r.post(
    "/rulesets/:id/clone",
    { schema: { tags: ["rules"], params: idParams }, preHandler: requireRole("analyst") },
    async (request, reply) =>
      reply.status(201).send(await cloneRuleset(db, request.params.id, actorOf(request))),
  );
  r.post(
    "/rulesets/:id/activate",
    { schema: { tags: ["rules"], params: idParams }, preHandler: requireRole("admin") },
    async (request) => activateRuleset(db, request.params.id, actorOf(request)),
  );
  r.post(
    "/rulesets/:id/test",
    {
      schema: { tags: ["rules"], params: idParams, body: testRulesetBodySchema },
      preHandler: requireRole("analyst"),
    },
    async (request) => ({
      results: await testRuleset(db, request.params.id, request.body.domainIds),
    }),
  );
};
