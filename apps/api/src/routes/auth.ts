import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { loginBodySchema } from "@dominio-x/contracts";
import { login, logout } from "@dominio-x/domain-core";
import { SESSION_COOKIE, cookieOptions, requireUser } from "../auth/session.js";
import type { ApiDeps } from "../deps.js";

export const authRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = async (app, { deps }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { config } = deps;

  r.post(
    "/auth/login",
    {
      schema: { tags: ["auth"], body: loginBodySchema },
      config: {
        rateLimit: {
          max: config.LOGIN_RATE_LIMIT_MAX,
          timeWindow: config.LOGIN_RATE_LIMIT_WINDOW_MS,
        },
      },
    },
    async (request, reply) => {
      const result = await login(deps.core.db, {
        email: request.body.email,
        password: request.body.password,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        ttlHours: config.SESSION_TTL_HOURS,
        requestId: request.id,
      });
      void reply.setCookie(SESSION_COOKIE, result.token, cookieOptions(config, result.expiresAt));
      return { user: result.user, expiresAt: result.expiresAt.toISOString() };
    },
  );

  r.post("/auth/logout", { schema: { tags: ["auth"] } }, async (request, reply) => {
    const user = requireUser(request);
    await logout(deps.core.db, request.sessionToken, {
      id: user.id,
      email: user.email,
      ipAddress: request.ip,
      requestId: request.id,
    });
    void reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  r.get("/auth/me", { schema: { tags: ["auth"] } }, async (request) => {
    const user = requireUser(request);
    return { user };
  });
};
