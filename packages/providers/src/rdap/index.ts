import { METRICS, PROVIDER_KEYS } from "@dominio-x/contracts";
import { LocalRateLimiter } from "../rate-limit/local.js";
import {
  measuredObservation,
  unknownObservation,
  type EnrichmentProvider,
  type EnrichmentRequest,
  type ObservationInput,
  type ProviderResult,
} from "../types.js";

/**
 * RDAP provider (RFC 9083). Uses the IANA bootstrap redirector so that no registry-specific
 * endpoint is hard-coded. Disabled by default; rate limited; never stores contact/PII data:
 * only registration lifecycle dates, status codes and nameserver count are mapped.
 */
export interface RdapProviderOptions {
  enabled: boolean;
  timeoutMs?: number;
  ttlHours?: number;
  rateLimitRps?: number;
  bootstrapUrl?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}
interface RdapDomain {
  status?: string[];
  events?: RdapEvent[];
  nameservers?: unknown[];
}

export class RdapProvider implements EnrichmentProvider {
  readonly key = PROVIDER_KEYS.RDAP;
  readonly capabilities = ["rdap"] as const;
  readonly paid = false;
  private readonly options: Required<Omit<RdapProviderOptions, "fetchImpl">> & {
    fetchImpl: typeof fetch;
  };
  private readonly limiter: LocalRateLimiter;

  constructor(options: RdapProviderOptions) {
    this.options = {
      enabled: options.enabled,
      timeoutMs: options.timeoutMs ?? 8000,
      ttlHours: options.ttlHours ?? 24 * 7,
      rateLimitRps: options.rateLimitRps ?? 2,
      bootstrapUrl: options.bootstrapUrl ?? "https://rdap.org/domain/",
      userAgent: options.userAgent ?? "Dominio-X/1.0 (+internal-domain-intelligence)",
      fetchImpl: options.fetchImpl ?? fetch,
    };
    this.limiter = new LocalRateLimiter({ rps: this.options.rateLimitRps, concurrency: 2 });
  }

  isConfigured(): boolean {
    return this.options.enabled;
  }
  describeStatus() {
    return this.options.enabled
      ? { configured: true, state: "ready", detail: "IANA bootstrap redirector, rate limited" }
      : { configured: false, state: "disabled", detail: "RDAP_ENABLED=false" };
  }
  estimate() {
    return Promise.resolve({ units: 0, estimatedCostUsd: 0, cached: false });
  }

  async enrich(request: EnrichmentRequest): Promise<ProviderResult> {
    const startedAt = Date.now();
    if (!this.options.enabled) {
      return {
        providerKey: this.key,
        status: "skipped",
        observations: [],
        requests: [],
        errorCode: "PROVIDER_DISABLED",
        durationMs: 0,
      };
    }
    const opts = { licenseClass: "public_source" as const, ttlHours: this.options.ttlHours };
    const url = new URL(
      encodeURIComponent(request.domain.registrableDomain),
      this.options.bootstrapUrl,
    ).toString();
    const release = await this.limiter.acquire();
    const reqStart = Date.now();
    try {
      const res = await this.options.fetchImpl(url, {
        headers: {
          accept: "application/rdap+json, application/json",
          "user-agent": this.options.userAgent,
        },
        signal: AbortSignal.timeout(this.options.timeoutMs),
        redirect: "follow",
      });
      const durationMs = Date.now() - reqStart;
      if (res.status === 404) {
        return {
          providerKey: this.key,
          status: "ok",
          observations: [measuredObservation(METRICS.RDAP_AVAILABLE, true, opts)],
          requests: [{ endpointKey: "domain", statusCode: 404, durationMs }],
          durationMs: Date.now() - startedAt,
        };
      }
      if (res.status === 429) {
        return {
          providerKey: this.key,
          status: "error",
          observations: [],
          requests: [
            {
              endpointKey: "domain",
              statusCode: 429,
              durationMs,
              errorCode: "PROVIDER_RATE_LIMITED",
            },
          ],
          errorCode: "PROVIDER_RATE_LIMITED",
          durationMs: Date.now() - startedAt,
        };
      }
      if (!res.ok) {
        return {
          providerKey: this.key,
          status: "error",
          observations: [
            unknownObservation(METRICS.RDAP_STATUS, "error", `http ${res.status}`, opts),
          ],
          requests: [
            {
              endpointKey: "domain",
              statusCode: res.status,
              durationMs,
              errorCode: "PROVIDER_UPSTREAM_ERROR",
            },
          ],
          errorCode: "PROVIDER_UPSTREAM_ERROR",
          durationMs: Date.now() - startedAt,
        };
      }
      const body = (await res.json()) as RdapDomain;
      const observations: ObservationInput[] = [
        measuredObservation(METRICS.RDAP_AVAILABLE, false, opts),
      ];
      if (Array.isArray(body.status))
        observations.push(measuredObservation(METRICS.RDAP_STATUS, body.status.slice(0, 20), opts));
      const eventDate = (action: string) =>
        body.events?.find((e) => e.eventAction === action)?.eventDate;
      const reg = eventDate("registration");
      const exp = eventDate("expiration");
      const chg = eventDate("last changed");
      if (reg) observations.push(measuredObservation(METRICS.RDAP_REGISTRATION_DATE, reg, opts));
      else
        observations.push(
          unknownObservation(
            METRICS.RDAP_REGISTRATION_DATE,
            "not_available",
            "registry did not expose registration date",
            opts,
          ),
        );
      if (exp) observations.push(measuredObservation(METRICS.RDAP_EXPIRATION_DATE, exp, opts));
      if (chg) observations.push(measuredObservation(METRICS.RDAP_LAST_CHANGED_DATE, chg, opts));
      if (Array.isArray(body.nameservers))
        observations.push(
          measuredObservation(METRICS.RDAP_NAMESERVER_COUNT, body.nameservers.length, opts),
        );
      return {
        providerKey: this.key,
        status: "ok",
        observations,
        requests: [{ endpointKey: "domain", statusCode: res.status, durationMs }],
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const timeout = (error as { name?: string }).name === "TimeoutError";
      return {
        providerKey: this.key,
        status: "error",
        observations: [
          unknownObservation(
            METRICS.RDAP_STATUS,
            "error",
            timeout ? "timeout" : "network error",
            opts,
          ),
        ],
        requests: [
          {
            endpointKey: "domain",
            durationMs: Date.now() - reqStart,
            errorCode: timeout ? "PROVIDER_TIMEOUT" : "PROVIDER_UPSTREAM_ERROR",
          },
        ],
        errorCode: timeout ? "PROVIDER_TIMEOUT" : "PROVIDER_UPSTREAM_ERROR",
        durationMs: Date.now() - startedAt,
      };
    } finally {
      release();
    }
  }
}
