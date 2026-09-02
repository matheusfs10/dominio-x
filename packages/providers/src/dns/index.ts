import { Resolver } from "node:dns/promises";
import { METRICS, PROVIDER_KEYS } from "@dominio-x/contracts";
import {
  measuredObservation,
  unknownObservation,
  type EnrichmentProvider,
  type EnrichmentRequest,
  type ObservationInput,
  type ProviderResult,
} from "../types.js";

export interface DnsProviderOptions {
  timeoutMs?: number;
  ttlHours?: number;
  servers?: string[];
}

/** Error codes meaning "the name has no such records" (a measured zero, not an error). */
const NODATA_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

type LookupOutcome<T> =
  { ok: true; value: T } | { ok: false; nodata: true } | { ok: false; nodata: false; code: string };

async function lookup<T>(fn: () => Promise<T>, timeoutMs: number): Promise<LookupOutcome<T>> {
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })),
          timeoutMs,
        ),
      ),
    ]);
    return { ok: true, value };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "EUNKNOWN";
    if (NODATA_CODES.has(code)) return { ok: false, nodata: true };
    return { ok: false, nodata: false, code };
  }
}

export class DnsProvider implements EnrichmentProvider {
  readonly key = PROVIDER_KEYS.DNS;
  readonly capabilities = ["dns"] as const;
  readonly paid = false;
  private readonly timeoutMs: number;
  private readonly ttlHours: number;
  private readonly servers: string[] | undefined;

  constructor(options: DnsProviderOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.ttlHours = options.ttlHours ?? 24;
    this.servers = options.servers;
  }

  isConfigured(): boolean {
    return true;
  }
  describeStatus() {
    return { configured: true, state: "ready", detail: "system resolver" };
  }
  estimate() {
    return Promise.resolve({ units: 0, estimatedCostUsd: 0, cached: false });
  }

  async enrich(request: EnrichmentRequest): Promise<ProviderResult> {
    const startedAt = Date.now();
    const fqdn = request.domain.asciiFqdn;
    const resolver = new Resolver({ timeout: this.timeoutMs, tries: 1 });
    if (this.servers) resolver.setServers(this.servers);
    const t = this.timeoutMs;

    const [a, aaaa, mx, ns, txt, cname] = await Promise.all([
      lookup(() => resolver.resolve4(fqdn, { ttl: true }), t),
      lookup(() => resolver.resolve6(fqdn, { ttl: true }), t),
      lookup(() => resolver.resolveMx(fqdn), t),
      lookup(() => resolver.resolveNs(fqdn), t),
      lookup(() => resolver.resolveTxt(fqdn), t),
      lookup(() => resolver.resolveCname(fqdn), t),
    ]);

    const opts = { licenseClass: "public_source" as const, ttlHours: this.ttlHours };
    const observations: ObservationInput[] = [];
    const errors: string[] = [];
    const countOf = <T>(
      r: LookupOutcome<T[]>,
      key: string,
      records?: (v: T[]) => unknown,
      recordKey?: string,
    ) => {
      if (r.ok) {
        observations.push(measuredObservation(key, r.value.length, opts));
        if (records && recordKey)
          observations.push(measuredObservation(recordKey, records(r.value) as string[], opts));
      } else if (r.nodata) {
        observations.push(measuredObservation(key, 0, opts));
      } else {
        errors.push(`${key}:${r.code}`);
        observations.push(unknownObservation(key, "error", r.code, opts));
      }
    };

    countOf(a, METRICS.DNS_A_COUNT, (v) => v.map((r) => r.address), METRICS.DNS_A_RECORDS);
    countOf(aaaa, METRICS.DNS_AAAA_COUNT);
    countOf(
      mx,
      METRICS.DNS_MX_COUNT,
      (v) => v.map((r) => r.exchange).slice(0, 10),
      METRICS.DNS_MX_RECORDS,
    );
    countOf(ns, METRICS.DNS_NS_COUNT, (v) => v.slice(0, 10), METRICS.DNS_NS_RECORDS);
    countOf(txt, METRICS.DNS_TXT_COUNT);
    if (txt.ok)
      observations.push(
        measuredObservation(
          METRICS.DNS_HAS_SPF,
          txt.value.some((rec) => rec.join("").toLowerCase().startsWith("v=spf1")),
          opts,
        ),
      );
    else if (txt.nodata) observations.push(measuredObservation(METRICS.DNS_HAS_SPF, false, opts));

    if (cname.ok && cname.value.length > 0)
      observations.push(measuredObservation(METRICS.DNS_CNAME, cname.value[0]!, opts));
    else if (cname.ok || (!cname.ok && cname.nodata))
      observations.push(measuredObservation(METRICS.DNS_CNAME, "", opts));

    const anyMeasured = [a, aaaa, mx, ns].some((r) => r.ok || r.nodata);
    const resolves =
      (a.ok && a.value.length > 0) ||
      (aaaa.ok && aaaa.value.length > 0) ||
      (cname.ok && cname.value.length > 0);
    if (anyMeasured) observations.push(measuredObservation(METRICS.DNS_RESOLVES, resolves, opts));
    else
      observations.push(
        unknownObservation(
          METRICS.DNS_RESOLVES,
          "error",
          errors.join(",") || "resolver failure",
          opts,
        ),
      );

    const status: ProviderResult["status"] = !anyMeasured
      ? "error"
      : errors.length > 0
        ? "partial"
        : "ok";
    return {
      providerKey: this.key,
      status,
      observations,
      requests: [
        {
          endpointKey: "resolve",
          requestCount: 6,
          durationMs: Date.now() - startedAt,
          errorCode: errors[0],
        },
      ],
      errorCode: status === "error" ? "PROVIDER_UPSTREAM_ERROR" : undefined,
      message: errors.length > 0 ? errors.join(", ") : undefined,
      durationMs: Date.now() - startedAt,
    };
  }
}
