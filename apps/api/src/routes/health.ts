import type { FastifyPluginAsync } from "fastify";
import type { ApiDeps } from "../deps.js";

/** /health: process alive. /ready: DB + Redis reachable within strict timeouts. No hostnames leaked. */
export const healthRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.get("/health", { config: { rateLimit: false } }, async () => ({
    status: "ok",
    service: "api",
    time: new Date().toISOString(),
  }));

  app.get("/ready", { config: { rateLimit: false } }, async (_request, reply) => {
    const [db, redis] = await Promise.all([
      deps.database.ping(1500),
      deps.redis
        ? Promise.race([
            deps.redis.ping().then((r) => r === "PONG"),
            new Promise<boolean>((r) => setTimeout(() => r(false), 1500)),
          ]).catch(() => false)
        : Promise.resolve(true),
    ]);
    const ok = db && redis;
    return reply
      .status(ok ? 200 : 503)
      .send({
        status: ok ? "ready" : "degraded",
        checks: {
          database: db ? "ok" : "fail",
          redis: deps.redis ? (redis ? "ok" : "fail") : "skipped",
        },
      });
  });
};
