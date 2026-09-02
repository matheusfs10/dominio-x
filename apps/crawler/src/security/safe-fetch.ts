import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { Agent, request as undiciRequest } from "undici";
import { classifyAddress, isIpLiteral } from "./ip.js";

export class SecurityBlockedError extends Error {
  readonly reason: string;
  readonly url: string;
  constructor(reason: string, url: string, detail?: string) {
    super(`blocked:${reason} ${url}${detail ? ` (${detail})` : ""}`);
    this.name = "SecurityBlockedError";
    this.reason = reason;
    this.url = url;
  }
}

export class FetchLimitError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FetchLimitError";
    this.code = code;
  }
}

export interface SafeFetchOptions {
  connectTimeoutMs: number;
  totalTimeoutMs: number;
  maxRedirects: number;
  maxBodyBytes: number;
  maxDecompressedBytes: number;
  userAgent: string;
  method?: "GET" | "HEAD";
  allowedPorts?: number[];
  /** Test-only escape hatch for loopback servers. Never set from configuration. */
  dangerouslyAllowAddresses?: string[];
  lookup?: (hostname: string) => Promise<LookupAddress[]>;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  redirectChain: string[];
  truncated: boolean;
}

const DEFAULT_PORTS = new Set([80, 443]);

export function validateUrl(raw: string, options: Pick<SafeFetchOptions, "allowedPorts">): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SecurityBlockedError("invalid_url", raw);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new SecurityBlockedError("scheme", raw, url.protocol);
  if (url.username || url.password) throw new SecurityBlockedError("credentials", raw);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const allowed = options.allowedPorts ? new Set(options.allowedPorts) : DEFAULT_PORTS;
  if (!allowed.has(port)) throw new SecurityBlockedError("port", raw, String(port));
  if (
    !url.hostname ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.endsWith(".local") ||
    url.hostname.endsWith(".internal")
  ) {
    throw new SecurityBlockedError("hostname", raw, url.hostname);
  }
  return url;
}

/**
 * Resolves the hostname and returns one address that passed the policy. Every resolved
 * address must be allowed (a mixed public/private answer is treated as an attack).
 */
export async function resolveSafeAddress(
  url: URL,
  options: SafeFetchOptions,
): Promise<{ address: string; family: 4 | 6 }> {
  const host = url.hostname;
  const allowList = new Set(options.dangerouslyAllowAddresses ?? []);
  const check = (ip: string) => {
    const verdict = classifyAddress(ip);
    if (!verdict.allowed && !allowList.has(verdict.normalized) && !allowList.has(ip))
      throw new SecurityBlockedError(verdict.reason ?? "address", url.toString(), ip);
  };
  if (isIpLiteral(host)) {
    check(host);
    const bare = host.replace(/^\[|\]$/g, "");
    return { address: bare, family: bare.includes(":") ? 6 : 4 };
  }
  const lookup = options.lookup ?? ((h: string) => dnsLookup(h, { all: true, verbatim: true }));
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(host);
  } catch (error) {
    throw new FetchLimitError(
      "DNS_ERROR",
      `DNS lookup failed for ${host}: ${(error as { code?: string }).code ?? "unknown"}`,
    );
  }
  if (addresses.length === 0)
    throw new FetchLimitError("DNS_ERROR", `DNS lookup returned no addresses for ${host}`);
  for (const a of addresses) check(a.address);
  const preferred = addresses.find((a) => a.family === 4) ?? addresses[0]!;
  return { address: preferred.address, family: preferred.family as 4 | 6 };
}

function pinnedAgent(address: string, family: 4 | 6, options: SafeFetchOptions): Agent {
  return new Agent({
    connect: {
      timeout: options.connectTimeoutMs,
      // DNS pinning: the socket connects to the address we validated, never to a fresh resolution.
      lookup: (_hostname, _opts, callback) => {
        callback(null, [{ address, family }]);
      },
    },
    connections: 2,
    headersTimeout: options.totalTimeoutMs,
    bodyTimeout: options.totalTimeoutMs,
  });
}

async function readBody(
  stream: AsyncIterable<Uint8Array>,
  encoding: string | undefined,
  options: SafeFetchOptions,
): Promise<{ body: Buffer; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let raw = 0;
  let out = 0;
  let truncated = false;
  const decoder =
    encoding === "gzip" || encoding === "x-gzip"
      ? createGunzip()
      : encoding === "deflate"
        ? createInflate()
        : encoding === "br"
          ? createBrotliDecompress()
          : null;

  if (!decoder) {
    for await (const chunk of stream) {
      raw += chunk.length;
      if (raw > options.maxBodyBytes) {
        truncated = true;
        break;
      }
      chunks.push(Buffer.from(chunk));
    }
    return { body: Buffer.concat(chunks), truncated };
  }

  const collected = new Promise<void>((resolve, reject) => {
    decoder.on("data", (chunk: Uint8Array) => {
      out += chunk.length;
      if (out > options.maxDecompressedBytes) {
        truncated = true;
        decoder.destroy();
        resolve();
        return;
      }
      chunks.push(chunk);
    });
    decoder.on("end", resolve);
    decoder.on("close", resolve);
    decoder.on("error", (e) => (truncated ? resolve() : reject(e)));
  });
  try {
    for await (const chunk of stream) {
      raw += chunk.length;
      if (raw > options.maxBodyBytes || truncated) {
        truncated = true;
        break;
      }
      if (!decoder.write(chunk)) await new Promise((r) => decoder.once("drain", r));
    }
  } finally {
    decoder.end();
  }
  await collected;
  return { body: Buffer.concat(chunks), truncated };
}

/**
 * Fetches a URL with SSRF defenses: scheme/port/credential validation, DNS classification,
 * address pinning, re-validation on every redirect, and byte/time caps.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const deadline = Date.now() + options.totalTimeoutMs;
  const redirectChain: string[] = [];
  let current = validateUrl(rawUrl, options);
  const method = options.method ?? "GET";

  for (let hop = 0; ; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new FetchLimitError("TIMEOUT", "total timeout exceeded");
    const { address, family } = await resolveSafeAddress(current, options);
    const agent = pinnedAgent(address, family, options);
    try {
      const res = await undiciRequest(current, {
        method,
        dispatcher: agent,
        signal: AbortSignal.timeout(remaining),
        headers: {
          "user-agent": options.userAgent,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-language": "pt-BR,pt;q=0.9,en;q=0.5",
        },
      });
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers))
        headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : (v ?? "");

      if (res.statusCode >= 300 && res.statusCode < 400 && headers.location) {
        await res.body.dump();
        if (hop >= options.maxRedirects)
          throw new FetchLimitError(
            "TOO_MANY_REDIRECTS",
            `more than ${options.maxRedirects} redirects`,
          );
        let next: URL;
        try {
          next = new URL(headers.location, current);
        } catch {
          throw new SecurityBlockedError("invalid_redirect", headers.location);
        }
        redirectChain.push(current.toString());
        current = validateUrl(next.toString(), options);
        continue;
      }

      const contentType = headers["content-type"] ?? "";
      const wantBody = method === "GET" && /text\/|html|xml|json/.test(contentType);
      let body: Buffer = Buffer.alloc(0);
      let truncated = false;
      if (wantBody)
        ({ body, truncated } = await readBody(
          res.body,
          headers["content-encoding"]?.toLowerCase(),
          options,
        ));
      else await res.body.dump();
      return {
        finalUrl: current.toString(),
        status: res.statusCode,
        headers,
        body,
        redirectChain,
        truncated,
      };
    } finally {
      await agent.close().catch(() => undefined);
    }
  }
}
