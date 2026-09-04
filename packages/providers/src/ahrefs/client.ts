import { z } from "zod";
import { ProviderError } from "../types.js";

/**
 * The ONLY place in the platform that knows Ahrefs endpoint paths, request shapes, response
 * field names and error variants. Everything it returns is already normalized into the
 * vendor-neutral shapes at the bottom of this file; `mapping.ts` turns those into metric keys.
 *
 * Source of truth: the public Backlink Checker at https://ahrefs.com/backlink-checker/, whose
 * front end posts the form to the endpoint below. There is no API key and no published
 * contract, so the response parser is deliberately tolerant: an unexpected shape becomes a
 * provider error, never a silent zero.
 */

const BACKLINKS_OVERVIEW_PATH = "/v4/stGetFreeBacklinksOverview";

export const ENDPOINT_KEYS = {
  backlinksOverview: "ahrefs.stGetFreeBacklinksOverview",
} as const;

/** URL matching modes the tool accepts. */
export const LOOKUP_MODES = ["exact", "prefix", "domain", "subdomains"] as const;
export type LookupMode = (typeof LOOKUP_MODES)[number];

/** Page the Turnstile widget is rendered on, needed by the captcha solver. */
export const CHALLENGE_PAGE_PATH = "/backlink-checker/";

// --- Response validation ------------------------------------------------------------------
// The endpoint answers with a two-element result variant: ["Ok", payload] or ["Error", detail].

const overviewSchema = z.object({
  domainRating: z.number().nullish(),
  backlinks: z.number().nullish(),
  refdomains: z.number().nullish(),
  dofollowBacklinks: z.number().nullish(),
  dofollowRefdomains: z.number().nullish(),
});

const okPayloadSchema = z.object({ data: overviewSchema });

/** `["InvalidCaptcha"]` / `["InvalidUrl"]`, or a bare string in older builds. */
const errorDetailSchema = z.union([z.array(z.string()).min(1), z.string()]);

const envelopeSchema = z.union([
  z.tuple([z.literal("Ok"), okPayloadSchema]),
  z.tuple([z.literal("Error"), errorDetailSchema]),
]);

// --- Vendor-neutral output ----------------------------------------------------------------

/** Link authority of one target, as published by the backlink index. */
export interface AuthorityOverview {
  /** Vendor score on a logarithmic 0..100 scale. */
  domainRating: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  dofollowBacklinks: number | null;
  dofollowReferringDomains: number | null;
}

export interface AuthorityLookup {
  target: string;
  mode: LookupMode;
  overview: AuthorityOverview;
  httpStatus: number;
  durationMs: number;
}

export interface AhrefsClientOptions {
  baseUrl: string;
  timeoutMs: number;
  userAgent: string;
  /** Sent as `X-Client-Version` when the operator pins one. */
  clientVersion?: string;
  /** Raw `Cookie` header, for the rare case the WAF needs a clearance cookie. */
  cookie?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface AuthorityQuery {
  /** Absolute URL to look up, e.g. `https://example.com.br/`. */
  url: string;
  mode: LookupMode;
  /** Freshly solved Turnstile token. The endpoint rejects a reused or absent one. */
  captchaToken: string;
  /** User agent the token was solved with, when the solver reported one. */
  userAgent?: string;
}

export class AhrefsClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly clientVersion: string | undefined;
  private readonly cookie: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AhrefsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
    this.userAgent = options.userAgent;
    this.clientVersion = options.clientVersion;
    this.cookie = options.cookie;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** URL of the page the Turnstile widget lives on. */
  challengePageUrl(): string {
    return `${this.baseUrl}${CHALLENGE_PAGE_PATH}`;
  }

  /** Backlink profile summary — Domain Rating plus the raw counts behind it. */
  async authorityOverview(query: AuthorityQuery, signal?: AbortSignal): Promise<AuthorityLookup> {
    if (!query.captchaToken) {
      throw new ProviderError("PROVIDER_INVALID_INPUT", "a solved captcha token is required");
    }
    const startedAt = Date.now();
    const { payload, httpStatus } = await this.request(
      BACKLINKS_OVERVIEW_PATH,
      { url: query.url, mode: query.mode, captcha: query.captchaToken },
      query.userAgent,
      signal,
    );

    const parsed = envelopeSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ProviderError(
        "PROVIDER_UPSTREAM_ERROR",
        "unrecognised response shape from the backlink checker",
        { retryable: true },
      );
    }
    if (parsed.data[0] === "Error") {
      const detail = parsed.data[1];
      const code = (Array.isArray(detail) ? detail[0] : detail) ?? "Unknown";
      // An invalid captcha means the token was rejected: retrying with a fresh one can work.
      if (code === "InvalidCaptcha") {
        throw new ProviderError("PROVIDER_AUTH_FAILED", "captcha token rejected", {
          retryable: true,
        });
      }
      if (code === "InvalidUrl") {
        throw new ProviderError("PROVIDER_INVALID_INPUT", `target rejected: ${query.url}`);
      }
      throw new ProviderError("PROVIDER_UPSTREAM_ERROR", `tool error: ${code}`, {
        retryable: true,
      });
    }

    const data = parsed.data[1].data;
    return {
      target: query.url,
      mode: query.mode,
      overview: {
        domainRating: nonNegative(data.domainRating),
        backlinks: nonNegativeInt(data.backlinks),
        referringDomains: nonNegativeInt(data.refdomains),
        dofollowBacklinks: nonNegativeInt(data.dofollowBacklinks),
        dofollowReferringDomains: nonNegativeInt(data.dofollowRefdomains),
      },
      httpStatus,
      durationMs: Date.now() - startedAt,
    };
  }

  private async request(
    path: string,
    body: unknown,
    userAgent: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ payload: unknown; httpStatus: number }> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      Accept: "*/*",
      // The token is bound to the agent that solved it whenever the solver reports one.
      "User-Agent": userAgent ?? this.userAgent,
      Origin: this.baseUrl,
      Referer: this.challengePageUrl(),
    };
    if (this.clientVersion) headers["X-Client-Version"] = this.clientVersion;
    if (this.cookie) headers.Cookie = this.cookie;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "TimeoutError";
      throw new ProviderError(
        aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_UPSTREAM_ERROR",
        aborted ? `request timed out after ${this.timeoutMs}ms` : "network error",
        { retryable: true, cause: error },
      );
    }

    // A WAF interstitial is not an application error: it means this egress needs a clearance
    // cookie or a residential exit, which no retry from here will produce.
    if (response.status === 403 && response.headers.get("cf-mitigated")) {
      throw new ProviderError(
        "PROVIDER_UPSTREAM_ERROR",
        "blocked by the upstream WAF (cf-mitigated); a clearance cookie or another egress is needed",
      );
    }
    if (response.status === 429) {
      throw new ProviderError("PROVIDER_RATE_LIMITED", "HTTP 429", { retryable: true });
    }
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("PROVIDER_AUTH_FAILED", `HTTP ${response.status}`, {
        retryable: true,
      });
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ProviderError("PROVIDER_UPSTREAM_ERROR", `HTTP ${response.status}: invalid JSON`, {
        retryable: response.status >= 500,
        cause: error,
      });
    }
    if (response.status >= 400) {
      throw new ProviderError("PROVIDER_UPSTREAM_ERROR", `HTTP ${response.status}`, {
        retryable: response.status >= 500,
      });
    }
    return { payload, httpStatus: response.status };
  }
}

/** Builds the URL the tool expects from a bare domain name. */
export function targetUrlFor(asciiFqdn: string, scheme: "https" | "http"): string {
  return `${scheme}://${asciiFqdn}/`;
}

const nonNegative = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

const nonNegativeInt = (v: number | null | undefined): number | null => {
  const n = nonNegative(v);
  return n === null ? null : Math.round(n);
};
