import type { Redis } from "ioredis";
import { PROVIDER_KEYS, SEO_METRIC_KEYS } from "@dominio-x/contracts";
import type { SemrushConfig } from "@dominio-x/config";
import { CircuitBreaker } from "../circuit-breaker.js";
import { RedisRateLimiter } from "../rate-limit/redis.js";
import {
  unknownObservation,
  type EnrichmentProvider,
  type EnrichmentRequest,
  type ObservationInput,
  type ProviderResult,
} from "../types.js";
import { SEMRUSH_INTEGRATION_MODE, type SemrushIntegrationMode } from "./mode.js";

/**
 * Semrush provider boundary.
 *
 * STATUS: STANDBY. The integration mode (official Semrush API vs. an alternative data path)
 * has not been decided by the operator yet. This adapter therefore owns everything the rest
 * of the platform needs — configuration, rate limiting, circuit breaking, TTL/licensing
 * metadata, generic metric keys and the request ledger contract — but performs no outbound
 * calls. When the decision is made, only `fetchMetrics()` below and `mapping.ts` change.
 *
 * Nothing outside this directory may know Semrush endpoint URLs or response field names.
 */
export interface SemrushProviderOptions {
  config: SemrushConfig;
  redis?: Redis;
  mode?: SemrushIntegrationMode;
}

export class SemrushProvider implements EnrichmentProvider {
  readonly key = PROVIDER_KEYS.SEMRUSH;
  readonly capabilities = ["seo", "backlinks", "traffic", "keywords"] as const;
  readonly paid = true;
  readonly mode: SemrushIntegrationMode;
  private readonly config: SemrushConfig;
  private readonly limiter: RedisRateLimiter | null;
  private readonly breaker = new CircuitBreaker({ failureThreshold: 5, openMs: 120_000 });

  constructor(options: SemrushProviderOptions) {
    this.config = options.config;
    this.mode = options.mode ?? SEMRUSH_INTEGRATION_MODE;
    this.limiter = options.redis
      ? new RedisRateLimiter(options.redis, {
          key: "semrush",
          rps: Math.min(this.config.SEMRUSH_MAX_RPS, 10),
          concurrency: Math.min(this.config.SEMRUSH_MAX_CONCURRENCY, 10),
        })
      : null;
  }

  get ttlHours(): number {
    return this.config.SEMRUSH_DATA_TTL_DAYS * 24;
  }

  isConfigured(): boolean {
    return (
      this.mode !== "standby" && this.config.SEMRUSH_ENABLED && Boolean(this.config.SEMRUSH_API_KEY)
    );
  }

  describeStatus() {
    if (this.mode === "standby") {
      return {
        configured: false,
        state: "decision_pending",
        detail:
          "Integration mode (official API vs alternative) awaiting operator decision. No requests are made.",
      };
    }
    if (!this.config.SEMRUSH_ENABLED)
      return {
        configured: Boolean(this.config.SEMRUSH_API_KEY),
        state: "disabled",
        detail: "SEMRUSH_ENABLED=false",
      };
    if (!this.config.SEMRUSH_API_KEY)
      return { configured: false, state: "not_configured", detail: "SEMRUSH_API_KEY missing" };
    return {
      configured: true,
      state: "ready",
      detail: `${this.config.SEMRUSH_MAX_RPS} rps, ${this.config.SEMRUSH_MAX_CONCURRENCY} concurrent, TTL ${this.config.SEMRUSH_DATA_TTL_DAYS}d`,
    };
  }

  estimate(_request: EnrichmentRequest) {
    // Unit cost per domain overview call is plan-dependent; refined once the integration mode is chosen.
    return Promise.resolve({
      units: this.isConfigured() ? 10 : 0,
      estimatedCostUsd: 0,
      cached: false,
    });
  }

  async enrich(request: EnrichmentRequest): Promise<ProviderResult> {
    const startedAt = Date.now();
    const skipped = (errorCode: string, reason: string): ProviderResult => ({
      providerKey: this.key,
      status: "skipped",
      observations: SEO_METRIC_KEYS.map((k) =>
        unknownObservation(k, "unknown", reason, { licenseClass: "provider_restricted" }),
      ),
      requests: [],
      errorCode,
      message: reason,
      durationMs: Date.now() - startedAt,
    });

    if (this.mode === "standby")
      return skipped("PROVIDER_DECISION_PENDING", "Semrush integration mode not decided (standby)");
    if (!this.config.SEMRUSH_ENABLED) return skipped("PROVIDER_DISABLED", "Semrush disabled");
    if (!this.config.SEMRUSH_API_KEY)
      return skipped("PROVIDER_NOT_CONFIGURED", "Semrush API key not configured");
    if (!this.breaker.allowRequest())
      return skipped(
        "PROVIDER_CIRCUIT_OPEN",
        "Semrush circuit breaker open after repeated failures",
      );

    let release: (() => Promise<void>) | null = null;
    try {
      if (this.limiter)
        release = await this.limiter.acquire({
          maxWaitMs: this.config.SEMRUSH_TIMEOUT_MS,
          signal: request.signal,
        });
      const result = await this.fetchMetrics(request);
      this.breaker.recordSuccess();
      return { ...result, durationMs: Date.now() - startedAt };
    } catch (error) {
      this.breaker.recordFailure();
      const message = error instanceof Error ? error.message : "unknown error";
      return {
        providerKey: this.key,
        status: "error",
        observations: SEO_METRIC_KEYS.map((k) =>
          unknownObservation(k, "error", message, { licenseClass: "provider_restricted" }),
        ),
        requests: [
          {
            endpointKey: "domain_overview",
            durationMs: Date.now() - startedAt,
            errorCode: "PROVIDER_UPSTREAM_ERROR",
          },
        ],
        errorCode: "PROVIDER_UPSTREAM_ERROR",
        message,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      if (release) await release();
    }
  }

  /**
   * Placeholder for the real data path. Intentionally not implemented while the integration
   * decision is pending: it must never be reached because `mode === "standby"` short-circuits.
   */
  protected fetchMetrics(_request: EnrichmentRequest): Promise<Omit<ProviderResult, "durationMs">> {
    return Promise.reject(
      new Error("Semrush data path not implemented: integration mode is in standby"),
    );
  }
}

export { SEMRUSH_INTEGRATION_MODE } from "./mode.js";
export type { SemrushIntegrationMode } from "./mode.js";
export type { ObservationInput as SemrushObservation };
