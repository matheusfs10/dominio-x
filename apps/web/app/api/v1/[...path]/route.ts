import type { NextRequest } from "next/server";

/**
 * Runtime proxy: the browser only talks to the web origin; /api/v1/* is forwarded to the Core API
 * (private network in production). Evaluated per request, so API_INTERNAL_URL is read at runtime.
 */
export const dynamic = "force-dynamic";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "host",
  "content-length",
]);

function apiBase(): string {
  return (process.env.API_INTERNAL_URL ?? process.env.API_URL ?? "http://localhost:4000").replace(
    /\/+$/,
    "",
  );
}

async function proxy(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const target = `${apiBase()}/v1/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("x-forwarded-host", request.headers.get("host") ?? "");
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    });
  } catch (error) {
    // Surface the transport reason (ECONNREFUSED, ENOTFOUND, ...) so a broken private-network
    // path is diagnosable from the web logs and the UI instead of a bare 503.
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const detail =
      cause?.code ?? cause?.message ?? (error instanceof Error ? error.message : "unknown");
    console.error("[api-proxy] upstream fetch failed", {
      target: target.replace(/\?.*$/, ""),
      detail,
    });
    return Response.json(
      { error: { code: "SERVICE_UNAVAILABLE", message: `API unreachable (${detail}).` } },
      { status: 503 },
    );
  }
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (!HOP_BY_HOP.has(k) && k !== "set-cookie" && k !== "content-encoding") out.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
