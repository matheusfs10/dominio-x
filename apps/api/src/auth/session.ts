import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError, type UserRole } from "@dominio-x/contracts";
import { hasRole, resolveSession, type SessionUser } from "@dominio-x/domain-core";
import type { ApiDeps } from "../deps.js";

export const SESSION_COOKIE = "dx_session";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionToken: string | undefined;
  }
}

export function cookieOptions(config: ApiDeps["config"], expiresAt?: Date) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.NODE_ENV === "production",
    expires: expiresAt,
  };
}

/** Loads the session user (if any) for every request. Cheap: one indexed query. */
export function sessionLoader(deps: ApiDeps) {
  return async (request: FastifyRequest): Promise<void> => {
    request.user = null;
    request.sessionToken = request.cookies[SESSION_COOKIE];
    if (!request.sessionToken) return;
    const session = await resolveSession(deps.core.db, request.sessionToken);
    request.user = session?.user ?? null;
  };
}

export function requireRole(minimum: UserRole) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) throw new AppError("UNAUTHORIZED", "Authentication required.");
    if (!hasRole(request.user, minimum))
      throw new AppError("FORBIDDEN", `Requires role ${minimum}.`);
  };
}

export function actorOf(request: FastifyRequest) {
  return {
    id: request.user?.id ?? null,
    email: request.user?.email ?? null,
    ipAddress: request.ip,
    requestId: request.id,
  };
}

export function requireUser(request: FastifyRequest): SessionUser {
  if (!request.user) throw new AppError("UNAUTHORIZED", "Authentication required.");
  return request.user;
}
