import type { FastifyRequest } from "fastify";
import { AppError } from "@dominio-x/contracts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defense for cookie-authenticated state-changing requests: the request must carry an
 * Origin (or Referer) header whose origin is in the allow-list. Combined with SameSite=Lax
 * cookies this blocks cross-site form posts and cross-origin fetches.
 */
export function csrfGuard(allowedOrigins: Set<string>) {
  return async (request: FastifyRequest): Promise<void> => {
    if (SAFE_METHODS.has(request.method)) return;
    if (!request.sessionToken) return; // machine-token or anonymous requests are not cookie-authenticated
    const origin = request.headers.origin ?? refererOrigin(request.headers.referer);
    if (!origin || !allowedOrigins.has(origin)) {
      throw new AppError("CSRF_REJECTED", "Cross-site request rejected.");
    }
  };
}

function refererOrigin(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function buildAllowedOrigins(...urls: (string | undefined)[]): Set<string> {
  const set = new Set<string>();
  for (const url of urls) {
    if (!url) continue;
    for (const part of url.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      try {
        set.add(new URL(trimmed).origin);
      } catch {
        /* ignore invalid entries */
      }
    }
  }
  return set;
}
