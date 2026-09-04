import type { Redis } from "ioredis";
import { PROVIDER_KEYS, TRAFFIC_METRIC_KEYS } from "@dominio-x/contracts";
import type { DataForSeoConfig } from "@dominio-x/config";
import { CircuitBreaker } from "../circuit-breaker.js";
import { RedisRateLimiter } from "../rate-limit/redis.js";
import {
  ProviderError,
  unknownObservation,
  type EnrichmentProvider,
  type EnrichmentRequest,
  type ProviderEstimate,
  type ProviderResult,
} from "../types.js";
import {
  DataForSeoClient,
  ENDPOINT_KEYS,
  type AccountBalance,
  type TargetTraffic,
} from "./client.js";
import { mapTrafficObservations, trafficWindow, type TrafficWindow } from "./mapping.js";

/**
 * DataForSEO — estimated search traffic for one audience location over a rolling window.
 *
 * What the numbers mean: the provider estimates visits as SERP position x search volume for the
 * keywords a domain ranks for in the chosen location. They are *estimates of organic search
 * traffic*, not analytics visits, and they only describe the location in
 * `traffic.location_code` (Brazil by default).
 *
 * Cost control lives outside this adapter (the traffic gate in domain-core decides whether a
 * lookup is allowed at all). What the adapter guarantees is that a call is made only when the
 * provider is enabled and configured, that it is rate limited and circuit broken, and that the
 * *real* price reported by the provider is written to the request ledger.
 */
export interface DataForSeoProviderOptions {
  config: DataForSeoConfig;
  redis?: Redis;
  /** Injectable for tests. */
  client?: DataForSeoClient;
  now?: () => Date;
}

export class DataForSeoProvider implements EnrichmentProvider {
  readonly key = PROVIDER_KEYS.DATAFORSEO;
  readonly capabilities = ["traffic"] as const;
  readonly paid = true;
  private readonly config: DataForSeoConfig;
  private readonly limiter: RedisRateLimiter | null;
  private readonly breaker = new CircuitBreaker({ failureThreshold: 5, openMs: 120_000 });
  private readonly injectedClient: DataForSeoClient | null;
  private clientInstance: DataForSeoClient | null = null;
  private readonly now: () => Date;
  private balanceCache: { value: AccountBalance; at: number } | null = null;

  constructor(options: DataForSeoProviderOptions) {
    this.config = options.config;
    this.injectedClient = options.client ?? null;
    this.now = options.now ?? (() => new Date());
    this.limiter = options.redis
      ? new RedisRateLimiter(options.redis, {
          key: "dataforseo",
          rps: this.config.DATAFORSEO_MAX_RPS,
          concurrency: this.config.DATAFORSEO_MAX_CONCURRENCY,
        })
      : null;
  }

  get ttlHours(): number {
    return this.config.DATAFORSEO_DATA_TTL_DAYS * 24;
  }

  get windowMonths(): number {
    return this.config.DATAFORSEO_WINDOW_MONTHS;
  }

  window(now = this.now()): TrafficWindow {
    return trafficWindow(
      this.config.DATAFORSEO_WINDOW_MONTHS,
      { code: this.config.DATAFORSEO_LOCATION_CODE, name: this.config.DATAFORSEO_LOCATION_NAME },
      now,
    );
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.DATAFORSEO_ENABLED &&
        this.config.DATAFORSEO_LOGIN &&
        this.config.DATAFORSEO_PASSWORD,
    );
  }

  /** Never returns credentials — only whether they are present. */
  describeStatus(): { configured: boolean; state: string; detail?: string } {
    const hasCredentials = Boolean(
      this.config.DATAFORSEO_LOGIN && this.config.DATAFORSEO_PASSWORD,
    );
    if (!hasCredentials) {
      return {
        configured: false,
        state: "not_configured",
        detail: "DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD missing",
      };
    }
    if (!this.config.DATAFORSEO_ENABLED) {
      return { configured: true, state: "disabled", detail: "DATAFORSEO_ENABLED=false" };
    }
    const w = this.window();
    const where = `${this.config.DATAFORSEO_LOCATION_NAME} (${w.locationCode})`;
    const when = `${w.months} months (${w.from}..${w.to})`;
    const ttl = this.config.DATAFORSEO_DATA_TTL_DAYS;
    const limits = `${this.config.DATAFORSEO_MAX_RPS} rps, TTL ${ttl}d`;
    return { configured: true, state: "ready", detail: `${where}, ${when}, ${limits}` };
  }

  estimate(_request: EnrichmentRequest): Promise<ProviderEstimate> {
    // One live task per domain. The provider reports the real price in the response; this is the
    // conservative figure the budget check uses *before* spending anything.
    return Promise.resolve({
      units: this.isConfigured() ? 1 : 0,
      estimatedCostUsd: this.isConfigured()
        ? this.config.DATAFORSEO_ESTIMATED_COST_PER_CALL_USD
        : 0,
      cached: false,
    });
  }

  /** Account balance in USD. The provider documents this endpoint as free of charge. */
  async accountBalance(
    options: { force?: boolean; signal?: AbortSignal } = {},
  ): Promise<AccountBalance> {
    const ttlMs = this.config.DATAFORSEO_BALANCE_CACHE_SECONDS * 1000;
    const cached = this.balanceCache;
    if (!options.force && cached && Date.now() - cached.at < ttlMs) return cached.value;
    const value = await this.client().accountBalance(options.signal);
    this.balanceCache = { value, at: Date.now() };
    return value;
  }

  async enrich(request: EnrichmentRequest): Promise<ProviderResult> {
    const startedAt = Date.now();
    const window = this.window();
    const skipped = (errorCode: string, reason: string): ProviderResult => ({
      providerKey: this.key,
      status: "skipped",
      observations: TRAFFIC_METRIC_KEYS.map((k) =>
        unknownObservation(k, "unknown", reason, { licenseClass: "provider_restricted" }),
      ),
      requests: [],
      errorCode,
      message: reason,
      durationMs: Date.now() - startedAt,
    });

    const status = this.describeStatus();
    if (status.state === "not_configured")
      return skipped("PROVIDER_NOT_CONFIGURED", status.detail ?? "not configured");
    if (status.state === "disabled") return skipped("PROVIDER_DISABLED", "DataForSEO disabled");
    if (!this.breaker.allowRequest())
      return skipped("PROVIDER_CIRCUIT_OPEN", "circuit breaker open after repeated failures");

    const target = request.domain.asciiFqdn;
    let release: (() => Promise<void>) | null = null;
    try {
      if (this.limiter)
        release = await this.limiter.acquire({
          maxWaitMs: this.config.DATAFORSEO_TIMEOUT_MS,
          signal: request.signal,
        });
      const lookup = await this.client().historicalTraffic(
        {
          targets: [target],
          locationCode: window.locationCode,
          languageCode: this.config.DATAFORSEO_LANGUAGE_CODE,
          dateFrom: window.from,
          dateTo: window.to,
        },
        request.signal,
      );
      this.breaker.recordSuccess();
      const found: TargetTraffic | null =
        lookup.targets.find((t) => t.target === target.toLowerCase()) ?? lookup.targets[0] ?? null;
      return {
        providerKey: this.key,
        status: "ok",
        observations: mapTrafficObservations(found, { window, ttlHours: this.ttlHours }),
        requests: [
          {
            endpointKey: ENDPOINT_KEYS.historicalBulkTraffic,
            requestCount: 1,
            unitsUsed: 1,
            estimatedCostUsd: lookup.costUsd,
            statusCode: lookup.httpStatus,
            durationMs: lookup.durationMs,
            metadata: {
              targets: 1,
              locationCode: window.locationCode,
              windowFrom: window.from,
              windowTo: window.to,
              matched: found !== null,
            },
          },
        ],
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      this.breaker.recordFailure();
      const code = error instanceof ProviderError ? error.code : "PROVIDER_UPSTREAM_ERROR";
      const message = error instanceof Error ? error.message : "unknown error";
      return {
        providerKey: this.key,
        status: "error",
        observations: TRAFFIC_METRIC_KEYS.map((k) =>
          unknownObservation(k, "error", message, { licenseClass: "provider_restricted" }),
        ),
        requests: [
          {
            endpointKey: ENDPOINT_KEYS.historicalBulkTraffic,
            requestCount: 1,
            // A failed call is not billed by the provider, so no cost is recorded.
            durationMs: Date.now() - startedAt,
            errorCode: code,
          },
        ],
        errorCode: code,
        message,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      if (release) await release();
    }
  }

  private client(): DataForSeoClient {
    if (this.injectedClient) return this.injectedClient;
    if (this.clientInstance) return this.clientInstance;
    if (!this.config.DATAFORSEO_LOGIN || !this.config.DATAFORSEO_PASSWORD) {
      throw new ProviderError("PROVIDER_NOT_CONFIGURED", "DataForSEO credentials missing");
    }
    this.clientInstance = new DataForSeoClient({
      baseUrl: this.config.DATAFORSEO_BASE_URL,
      login: this.config.DATAFORSEO_LOGIN,
      password: this.config.DATAFORSEO_PASSWORD,
      timeoutMs: this.config.DATAFORSEO_TIMEOUT_MS,
    });
    return this.clientInstance;
  }
}

export { MAX_TARGETS_PER_REQUEST, DataForSeoClient } from "./client.js";
export type { AccountBalance, TargetTraffic, TrafficMonth } from "./client.js";
export { mapTrafficObservations, monthsInWindow, trafficWindow } from "./mapping.js";
export type { TrafficWindow } from "./mapping.js";
