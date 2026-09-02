import type { CrawlerResult } from "@dominio-x/contracts";
import { analyzeHtml } from "./analyzers/html.js";
import {
  FetchLimitError,
  SecurityBlockedError,
  safeFetch,
  type SafeFetchOptions,
  type SafeFetchResult,
} from "./security/safe-fetch.js";

/**
 * Constrained observation of one domain: HTTPS first, then HTTP. Never executes content.
 * Security blocks and unreachable hosts are *results* (observations), not failures.
 */
export async function crawlDomain(fqdn: string, options: SafeFetchOptions): Promise<CrawlerResult> {
  const startedAt = Date.now();
  const attempts: { scheme: "https" | "http"; result?: SafeFetchResult; error?: unknown }[] = [];
  for (const scheme of ["https", "http"] as const) {
    try {
      const result = await safeFetch(`${scheme}://${fqdn}/`, options);
      attempts.push({ scheme, result });
      break;
    } catch (error) {
      attempts.push({ scheme, error });
      if (error instanceof SecurityBlockedError) break;
    }
  }
  const durationMs = Date.now() - startedAt;
  const success = attempts.find((a) => a.result);
  const httpsAttempt = attempts.find((a) => a.scheme === "https");
  const blocked = attempts.find((a) => a.error instanceof SecurityBlockedError);

  if (blocked) {
    const err = blocked.error as SecurityBlockedError;
    return {
      reachable: false,
      httpsAvailable: null,
      status: null,
      redirectCount: 0,
      redirectChain: [],
      finalUrl: null,
      finalHostname: null,
      title: null,
      metaDescription: null,
      contentType: null,
      contentLength: null,
      server: null,
      securityBlocked: true,
      error: `security:${err.reason}`,
      durationMs,
    };
  }

  if (!success?.result) {
    const lastError = attempts[attempts.length - 1]?.error;
    return {
      reachable: false,
      httpsAvailable: httpsAttempt?.result ? true : false,
      status: null,
      redirectCount: 0,
      redirectChain: [],
      finalUrl: null,
      finalHostname: null,
      title: null,
      metaDescription: null,
      contentType: null,
      contentLength: null,
      server: null,
      securityBlocked: false,
      error: describeError(lastError),
      durationMs,
    };
  }

  const r = success.result;
  const finalUrl = new URL(r.finalUrl);
  const contentType = r.headers["content-type"] ?? null;
  const meta = analyzeHtml(r.body, contentType);
  const declaredLength = r.headers["content-length"] ? Number(r.headers["content-length"]) : NaN;
  return {
    reachable: true,
    httpsAvailable:
      success.scheme === "https" || finalUrl.protocol === "https:"
        ? true
        : httpsAttempt?.result
          ? true
          : false,
    status: r.status,
    redirectCount: r.redirectChain.length,
    redirectChain: r.redirectChain.slice(0, 20).map((u) => u.slice(0, 2048)),
    finalUrl: r.finalUrl.slice(0, 2048),
    finalHostname: finalUrl.hostname.slice(0, 255),
    title: meta.title,
    metaDescription: meta.metaDescription,
    contentType: contentType?.slice(0, 255) ?? null,
    contentLength: Number.isFinite(declaredLength) ? declaredLength : r.body.length,
    server: r.headers.server?.slice(0, 255) ?? null,
    securityBlocked: false,
    error: r.truncated ? "body_truncated" : null,
    durationMs,
  };
}

export function describeError(error: unknown): string {
  if (error instanceof FetchLimitError) return error.code.toLowerCase();
  if (error instanceof SecurityBlockedError) return `security:${error.reason}`;
  const code =
    (error as { code?: string; cause?: { code?: string }; name?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  if (code) return String(code).toLowerCase();
  const name = (error as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  return error instanceof Error ? error.message.slice(0, 120) : "unknown_error";
}
