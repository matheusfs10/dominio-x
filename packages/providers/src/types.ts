import type {
  LicenseClass,
  ObservationState,
  ObservationValueType,
  ProviderCapability,
  ProviderErrorCode,
} from "@dominio-x/contracts";

/** Domain identity as seen by providers (never the full DB row). */
export interface ProviderDomain {
  id: string;
  asciiFqdn: string;
  unicodeFqdn: string;
  registrableDomain: string;
  sld: string;
  tld: string;
  isIdn: boolean;
}

export interface EnrichmentRequest {
  domain: ProviderDomain;
  analysisRunId: string;
  /** Force refresh even when fresh observations exist. */
  force?: boolean;
  /** Extra context supplied by the pipeline (e.g. blacklist entries). */
  context?: Record<string, unknown>;
  signal?: AbortSignal;
}

export type ObservationValue =
  number | string | boolean | Record<string, unknown> | unknown[] | null;

export interface ObservationInput {
  metricKey: string;
  valueType: ObservationValueType;
  value: ObservationValue | undefined;
  state: ObservationState;
  licenseClass: LicenseClass;
  ttlHours?: number | null;
  confidence?: number;
  metadata?: Record<string, unknown>;
  rawEvidenceKey?: string;
}

export interface ProviderRequestLog {
  endpointKey: string;
  requestCount?: number;
  unitsUsed?: number;
  estimatedCostUsd?: number;
  statusCode?: number;
  durationMs: number;
  cached?: boolean;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderResult {
  providerKey: string;
  status: "ok" | "partial" | "skipped" | "error";
  observations: ObservationInput[];
  requests: ProviderRequestLog[];
  errorCode?: string;
  message?: string;
  durationMs: number;
}

export interface ProviderEstimate {
  /** Expected API units (provider-specific unit), 0 for free providers. */
  units: number;
  estimatedCostUsd: number;
  cached: boolean;
}

export interface ProviderMetadata {
  key: string;
  name: string;
  enabled: boolean;
  paid: boolean;
  rateLimitRps: number;
  concurrencyLimit: number;
  timeoutMs: number;
  defaultTtlHours: number;
  retentionPolicy: LicenseClass;
  capabilities: readonly ProviderCapability[];
}

export interface EnrichmentProvider {
  readonly key: string;
  readonly capabilities: readonly ProviderCapability[];
  readonly paid: boolean;
  isConfigured(): Promise<boolean> | boolean;
  /** Human-readable configuration status for the admin UI (never includes secrets). */
  describeStatus(): { configured: boolean; state: string; detail?: string };
  estimate(request: EnrichmentRequest): Promise<ProviderEstimate>;
  enrich(request: EnrichmentRequest): Promise<ProviderResult>;
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  constructor(
    code: ProviderErrorCode,
    message: string,
    options?: { retryable?: boolean; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ProviderError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export function measuredObservation(
  metricKey: string,
  value: ObservationValue,
  options: Partial<Omit<ObservationInput, "metricKey" | "value" | "state">> = {},
): ObservationInput {
  const valueType: ObservationValueType =
    typeof value === "number"
      ? "numeric"
      : typeof value === "boolean"
        ? "boolean"
        : typeof value === "string"
          ? "text"
          : "json";
  return {
    metricKey,
    value,
    valueType,
    state: "measured",
    licenseClass: options.licenseClass ?? "internal",
    ...options,
  };
}

export function unknownObservation(
  metricKey: string,
  state: Exclude<ObservationState, "measured">,
  reason: string,
  options: Partial<ObservationInput> = {},
): ObservationInput {
  return {
    metricKey,
    valueType: options.valueType ?? "json",
    value: undefined,
    state,
    licenseClass: options.licenseClass ?? "internal",
    metadata: { reason, ...options.metadata },
    ttlHours: options.ttlHours,
  };
}
