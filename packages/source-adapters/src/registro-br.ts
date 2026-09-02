import { SOURCE_KEYS } from "@dominio-x/contracts";
import { parseLines } from "./line-parser.js";
import {
  emptyStats,
  sha256Hex,
  type ParseStats,
  type RawDomainRecord,
  type SourceAdapter,
  type SourceArtifact,
  type SourceFetchContext,
  type SourceProbeContext,
  type SourceProbeResult,
} from "./types.js";

export interface RegistroBrAdapterOptions {
  url?: string;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class NonRetryableSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableSourceError";
  }
}

/**
 * Registro.br release-list adapter.
 *
 * Format (observed 2026-09): UTF-8 text, `#` comment header with the release window and
 * generation timestamp, one domain per line, `# Fim do arquivo` trailer.
 */
export class RegistroBrReleaseSourceAdapter implements SourceAdapter {
  readonly key = SOURCE_KEYS.REGISTRO_BR_RELEASE;
  private readonly options: Required<RegistroBrAdapterOptions>;
  private stats: ParseStats | null = null;

  constructor(options: RegistroBrAdapterOptions = {}) {
    this.options = {
      url: options.url ?? "https://registro.br/dominio/lista-processo-liberacao.txt",
      userAgent: options.userAgent ?? "Dominio-X/1.0 (+internal-domain-intelligence)",
      timeoutMs: options.timeoutMs ?? 30_000,
      maxBytes: options.maxBytes ?? 64 * 1024 * 1024,
      retries: options.retries ?? 2,
      fetchImpl: options.fetchImpl ?? fetch,
    };
  }

  private headers(
    ctx: { lastEtag?: string | null; lastModified?: string | null },
    conditional: boolean,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "user-agent": this.options.userAgent,
      accept: "text/plain, */*;q=0.5",
    };
    if (conditional && ctx.lastEtag) headers["if-none-match"] = ctx.lastEtag;
    if (conditional && ctx.lastModified) headers["if-modified-since"] = ctx.lastModified;
    return headers;
  }

  async probe(input: SourceProbeContext): Promise<SourceProbeResult> {
    const res = await this.request("HEAD", this.headers(input, true), input.signal);
    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");
    const unchanged = res.status === 304 || (Boolean(input.lastEtag) && etag === input.lastEtag);
    return { unchanged, etag, lastModified, status: res.status };
  }

  async fetch(input: SourceFetchContext): Promise<SourceArtifact> {
    const res = await this.request("GET", this.headers(input, true), input.signal);
    const fetchedAt = new Date();
    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");
    const contentType = res.headers.get("content-type");
    if (res.status === 304) {
      return {
        sourceKey: this.key,
        content: Buffer.alloc(0),
        contentType,
        sha256: "",
        fetchedAt,
        notModified: true,
        etag,
        lastModified,
        httpStatus: 304,
        url: this.options.url,
        metadata: {},
      };
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > this.options.maxBytes)
      throw new Error(`Source exceeds max size (${declared} bytes)`);
    const content = Buffer.from(await res.arrayBuffer());
    if (content.length > this.options.maxBytes)
      throw new Error(`Source exceeds max size (${content.length} bytes)`);
    return {
      sourceKey: this.key,
      content,
      contentType,
      sha256: sha256Hex(content),
      fetchedAt,
      notModified: false,
      etag,
      lastModified,
      httpStatus: res.status,
      url: this.options.url,
      metadata: { contentLength: content.length },
    };
  }

  private async request(
    method: "GET" | "HEAD",
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      try {
        const res = await this.options.fetchImpl(this.options.url, {
          method,
          headers,
          redirect: "follow",
          signal: signal ?? AbortSignal.timeout(this.options.timeoutMs),
        });
        if (res.ok || res.status === 304) return res;
        if (!RETRYABLE_STATUS.has(res.status))
          throw new NonRetryableSourceError(`Registro.br responded with HTTP ${res.status}`);
        lastError = new Error(`Registro.br responded with HTTP ${res.status}`);
      } catch (error) {
        if (error instanceof NonRetryableSourceError) throw error;
        lastError = error;
        if ((error as { name?: string }).name === "AbortError" && signal?.aborted) throw error;
      }
      if (attempt < this.options.retries)
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 250));
    }
    throw lastError instanceof Error ? lastError : new Error("Registro.br fetch failed");
  }

  parse(artifact: SourceArtifact): AsyncIterable<RawDomainRecord> {
    const stats = emptyStats();
    this.stats = stats;
    const content = artifact.content.toString("utf8");
    const metadata: Record<string, unknown> = {};
    return parseLines(content, stats, {
      onComment: (line) => {
        // "período" may arrive precomposed or with a combining accent; match loosely.
        const period = /per.{1,3}odo de\s+(\S+)\s+a\s+(\S+)/i.exec(line);
        if (period) {
          metadata.releasePeriodStart = period[1];
          metadata.releasePeriodEnd = period[2];
        }
        const generated = /gerado em\s+(\S+)/i.exec(line);
        if (generated) metadata.generatedAt = generated[1];
        if (/fim do arquivo/i.test(line)) metadata.trailerSeen = true;
        stats.metadata = metadata;
      },
    });
  }

  lastParseStats(): ParseStats | null {
    return this.stats;
  }
}

/** Parses the `generatedAt` header value into a Date when possible. */
export function parseRegistroBrTimestamp(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
