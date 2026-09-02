"use client";

import type { ApiErrorBody, ErrorCode } from "@dominio-x/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "NETWORK_ERROR",
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api/v1";

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...init,
    });
  } catch (error) {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      error instanceof Error ? error.message : "Network error",
    );
  }
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    let parsed: ApiErrorBody | null = null;
    if (contentType.includes("application/json"))
      parsed = (await res.json().catch(() => null)) as ApiErrorBody | null;
    const err = parsed?.error;
    if (
      res.status === 401 &&
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/login")
    ) {
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ApiError(
      res.status,
      err?.code ?? "INTERNAL_ERROR",
      err?.message ?? `HTTP ${res.status}`,
      err?.details,
      err?.requestId,
    );
  }
  if (contentType.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T>(path: string) => call<T>("GET", path),
  post: <T>(path: string, body?: unknown) => call<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => call<T>("PATCH", path, body),
  delete: <T>(path: string) => call<T>("DELETE", path),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
