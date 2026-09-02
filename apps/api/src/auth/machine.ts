import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { AppError } from "@dominio-x/contracts";

export const MACHINE_TOKEN_HEADER = "x-machine-token";

/** Constant-time comparison of SHA-256 digests (lengths may differ, digests never do). */
export function verifyMachineToken(presented: string | undefined, expected: string): boolean {
  if (!presented) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function requireMachineToken(expected: string) {
  return async (request: FastifyRequest): Promise<void> => {
    const header = request.headers[MACHINE_TOKEN_HEADER];
    const presented = Array.isArray(header) ? header[0] : header;
    if (!verifyMachineToken(presented, expected))
      throw new AppError("UNAUTHORIZED", "Invalid machine token.");
  };
}
