import type { Redis } from "ioredis";
import { AUTHORITY_METRIC_KEYS, PROVIDER_KEYS } from "@dominio-x/contracts";
import type { AhrefsConfig } from "@dominio-x/config";
import type { CaptchaSolver, SolvedCaptcha } from "../captcha.js";
import { CircuitBreaker } from "../circuit-breaker.js";
import { RedisRateLimiter } from "../rate-limit/redis.js";
import {
  ProviderError,
  unknownObservation,
  type EnrichmentProvider,
  type EnrichmentRequest,
  type ProviderEstimate,
  type ProviderRequestLog,
  type ProviderResult,
} from "../types.js";
import {
  AhrefsClient,
  ENDPOINT_KEYS,
  targetUrlFor,
  type AuthorityLookup,
  type LookupMode,
} from "./client.js";
import { mapAuthorityObservations } from "./mapping.js";

/**
 * Ahrefs — Domain Rating and the backlink counts behind it, read from the public backlink
 * checker.
 *
 * What the number means: Domain Rating is Ahrefs' own 0..100 *logarithmic* score of a domain's
 * referring-domain profile. It is a vendor ranking, not a percentage, and it is not comparable
 * with any other vendor's authority score. It is recorded as evidence and never mixed into the
 * platform's own 0..100 dimensions.
 *
 * What it costs: the tool is free but sits behind a Cloudflare Turnstile widget, so every
 * lookup needs one freshly solved token. The price of a lookup is therefore the price of one
 * solve, and it is charged whether or not the index knows the domain. The whole cost of the
 * attempt is written to the request ledger as a single row so that one lookup counts once
 * against the caps; the solver and its poll count stay traceable in the row metadata.
 *
 * Cost control lives outside this adapter (the authority gate in domain-core decides whether a
 * lookup is allowed at all). What the adapter guarantees is that it calls out only when both
 * the provider and its solver are enabled and configured, that it is rate limited and circuit
 * broken, and that the money spent is recorded even when the lookup then fails.
 */
export interface AhrefsProviderOptions {
  config: AhrefsConfig;
  /** Produces the Turnstile token. Without one the provider can never run. */
  solver?: CaptchaSolver;
  redis?: Redis;
  /** Injectable for tests. */
  client?: AhrefsClient;
}

export class AhrefsProvider implements EnrichmentProvider {
  readonly key = PROVIDER_KEYS.AHREFS;
  readonly capabilities = ["authority", "backlinks"] as const;
  readonly paid = true;
  private readonly config: AhrefsConfig;
  private readonly solver: CaptchaSolver | null;
  private readonly limiter: RedisRateLimiter | null;
  private readonly breaker = new CircuitBreaker({ failureThreshold: 5, openMs: 300_000 });
  private readonly injectedClient: AhrefsClient | null;
  private clientInstance: AhrefsClient | null = null;

  constructor(options: AhrefsProviderOptions) {
    this.config = options.config;
    this.solver = options.solver ?? null;
    this.injectedClient = options.client ?? null;
    this.limiter = options.redis
      ? new RedisRateLimiter(options.redis, {
          key: "ahrefs",
          rps: this.config.AHREFS_MAX_RPS,
          concurrency: this.config.AHREFS_MAX_CONCURRENCY,
        })
      : null;
  }

  get ttlHours(): number {
    return this.config.AHREFS_DATA_TTL_DAYS * 24;
  }

  get mode(): LookupMode {
    return this.config.AHREFS_MODE;
  }

  /** Price of one lookup in USD: exactly one captcha solve. */
  get costPerLookupUsd(): number {
    return this.solver?.costPerSolveUsd ?? 0;
  }

  isConfigured(): boolean {
    return this.describeStatus().state === "ready";
  }

  /** Never returns credentials — only whether the pieces are in place. */
  describeStatus(): { configured: boolean; state: string; detail?: string } {
    if (!this.solver) {
      return {
        configured: false,
        state: "not_configured",
        detail: "no captcha solver wired in",
      };
    }
    const solver = this.solver.describeStatus();
    if (solver.state !== "ready") {
      return {
        configured: solver.configured,
        state: solver.state === "disabled" ? "solver_disabled" : "not_configured",
        detail: `captcha solver: ${solver.detail ?? solver.state}`,
      };
    }
    if (!this.config.AHREFS_ENABLED) {
      return { configured: true, state: "disabled", detail: "AHREFS_ENABLED=false" };
    }
    const price = this.costPerLookupUsd;
    const ttl = this.config.AHREFS_DATA_TTL_DAYS;
    return {
      configured: true,
      state: "ready",
      detail: `mode ${this.mode}, US$ ${price}/lookup, ${this.config.AHREFS_MAX_RPS} rps, TTL ${ttl}d`,
    };
  }

  estimate(_request: EnrichmentRequest): Promise<ProviderEstimate> {
    // One solve per domain. The solver's price list is the only cost there is.
    const ready = this.isConfigured();
    return Promise.resolve({
      units: ready ? 1 : 0,
      estimatedCostUsd: ready ? this.costPerLookupUsd : 0,
      cached: false,
    });
  }

  /** Remaining captcha-solving credit in USD. Free to call, and cached by the solver. */
  solverBalanceUsd(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<number> {
    if (!this.solver) throw new ProviderError("PROVIDER_NOT_CONFIGURED", "no captcha solver");
    return this.solver.balanceUsd(options);
  }

  async enrich(request: EnrichmentRequest): Promise<ProviderResult> {
    const startedAt = Date.now();
    const status = this.describeStatus();
    if (status.state !== "ready") {
      return this.skipped(
        status.state === "disabled" || status.state === "solver_disabled"
          ? "PROVIDER_DISABLED"
          : "PROVIDER_NOT_CONFIGURED",
        status.detail ?? status.state,
        startedAt,
      );
    }
    if (!this.breaker.allowRequest()) {
      return this.skipped(
        "PROVIDER_CIRCUIT_OPEN",
        "circuit breaker open after repeated failures",
        startedAt,
      );
    }

    const solver = this.solver;
    if (!solver) {
      return this.skipped("PROVIDER_NOT_CONFIGURED", "no captcha solver wired in", startedAt);
    }
    const target = targetUrlFor(request.domain.asciiFqdn, this.config.AHREFS_TARGET_SCHEME);
    let release: (() => Promise<void>) | null = null;
    /** Set as soon as a solve is paid for, so a later failure still records the spend. */
    let solved: SolvedCaptcha | null = null;
    try {
      if (this.limiter) {
        release = await this.limiter.acquire({
          maxWaitMs: this.config.AHREFS_TIMEOUT_MS,
          signal: request.signal,
        });
      }
      const client = this.client();
      solved = await solver.solve(
        {
          type: "turnstile",
          websiteUrl: client.challengePageUrl(),
          websiteKey: this.config.AHREFS_TURNSTILE_SITEKEY,
        },
        request.signal,
      );
      const lookup = await client.authorityOverview(
        {
          url: target,
          mode: this.mode,
          captchaToken: solved.token,
          userAgent: solved.userAgent,
        },
        request.signal,
      );
      this.breaker.recordSuccess();
      return {
        providerKey: this.key,
        status: "ok",
        observations: mapAuthorityObservations(lookup, { ttlHours: this.ttlHours }),
        requests: [this.ledgerRow(solved, lookup, null, Date.now() - startedAt)],
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      this.breaker.recordFailure();
      const code = error instanceof ProviderError ? error.code : "PROVIDER_UPSTREAM_ERROR";
      const message = error instanceof Error ? error.message : "unknown error";
      return {
        providerKey: this.key,
        status: "error",
        observations: AUTHORITY_METRIC_KEYS.map((k) =>
          unknownObservation(k, "error", message, { licenseClass: "provider_restricted" }),
        ),
        requests: [this.ledgerRow(solved, null, code, Date.now() - startedAt)],
        errorCode: code,
        message,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      if (release) await release();
    }
  }

  /**
   * One row per lookup attempt. The cost is present whenever a solve was actually paid for,
   * including when the lookup that followed it failed — otherwise a run of upstream errors
   * would spend the balance without ever showing up against the monthly budget.
   */
  private ledgerRow(
    solved: SolvedCaptcha | null,
    lookup: AuthorityLookup | null,
    errorCode: string | null,
    durationMs: number,
  ): ProviderRequestLog {
    return {
      endpointKey: ENDPOINT_KEYS.backlinksOverview,
      requestCount: 1,
      unitsUsed: solved ? 1 : 0,
      estimatedCostUsd: solved?.costUsd ?? 0,
      statusCode: lookup?.httpStatus,
      durationMs,
      ...(errorCode ? { errorCode } : {}),
      metadata: {
        mode: this.mode,
        captchaSolver: this.solver?.key ?? null,
        captchaSolved: solved !== null,
        ...(solved ? { captchaSolveMs: solved.durationMs } : {}),
        ...(lookup ? { hasData: lookup.overview.domainRating !== null } : {}),
      },
    };
  }

  private skipped(errorCode: string, reason: string, startedAt: number): ProviderResult {
    return {
      providerKey: this.key,
      status: "skipped",
      observations: AUTHORITY_METRIC_KEYS.map((k) =>
        unknownObservation(k, "unknown", reason, { licenseClass: "provider_restricted" }),
      ),
      requests: [],
      errorCode,
      message: reason,
      durationMs: Date.now() - startedAt,
    };
  }

  private client(): AhrefsClient {
    if (this.injectedClient) return this.injectedClient;
    if (this.clientInstance) return this.clientInstance;
    this.clientInstance = new AhrefsClient({
      baseUrl: this.config.AHREFS_BASE_URL,
      timeoutMs: this.config.AHREFS_TIMEOUT_MS,
      userAgent: this.config.AHREFS_USER_AGENT,
      clientVersion: this.config.AHREFS_CLIENT_VERSION,
      cookie: this.config.AHREFS_COOKIE,
    });
    return this.clientInstance;
  }
}

export { AhrefsClient, LOOKUP_MODES, targetUrlFor } from "./client.js";
export type { AuthorityLookup, AuthorityOverview, LookupMode } from "./client.js";
export { mapAuthorityObservations } from "./mapping.js";
export type { MapAuthorityOptions } from "./mapping.js";
