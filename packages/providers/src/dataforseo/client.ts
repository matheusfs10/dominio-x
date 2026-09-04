import { z } from "zod";
import type { ProviderErrorCode } from "@dominio-x/contracts";
import { ProviderError } from "../types.js";

/**
 * The ONLY place in the platform that knows DataForSEO endpoint paths, request shapes,
 * response field names and status codes. Everything it returns is already normalized into the
 * vendor-neutral shapes at the bottom of this file; `mapping.ts` turns those into metric keys.
 *
 * Docs: https://docs.dataforseo.com/v3/
 */

const HISTORICAL_BULK_TRAFFIC_PATH =
  "/v3/dataforseo_labs/google/historical_bulk_traffic_estimation/live";
const USER_DATA_PATH = "/v3/appendix/user_data";

/** Per the endpoint reference; we never send more than this in one request. */
export const MAX_TARGETS_PER_REQUEST = 1000;
/** The provider has no history before this date. */
export const EARLIEST_HISTORY_DATE = "2020-10-01";

export const ENDPOINT_KEYS = {
  historicalBulkTraffic: "labs.historical_bulk_traffic_estimation",
  userData: "appendix.user_data",
} as const;

/** DataForSEO reports outcomes in a numeric `status_code`, not in the HTTP status. */
const OK = 20000;

function providerErrorFor(statusCode: number, message: string): ProviderError {
  const map: [(c: number) => boolean, ProviderErrorCode, boolean][] = [
    [(c) => [40100, 40101, 40104, 40207].includes(c), "PROVIDER_AUTH_FAILED", false],
    [(c) => [40200, 40203, 40210].includes(c), "PROVIDER_QUOTA_EXHAUSTED", false],
    [(c) => [40202, 40205, 40206, 40209].includes(c), "PROVIDER_RATE_LIMITED", true],
    [(c) => c >= 40500 && c < 40600, "PROVIDER_INVALID_INPUT", false],
    [(c) => c === 50401 || c === 50402, "PROVIDER_TIMEOUT", true],
    [(c) => c >= 50000, "PROVIDER_UPSTREAM_ERROR", true],
  ];
  const hit = map.find(([test]) => test(statusCode));
  return new ProviderError(hit?.[1] ?? "PROVIDER_UPSTREAM_ERROR", `[${statusCode}] ${message}`, {
    retryable: hit?.[2] ?? false,
  });
}

// --- Response validation ------------------------------------------------------------------
// Deliberately permissive: unknown fields are ignored so a provider-side addition never breaks
// an analysis, but every field we actually read is validated.

const monthPointSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  etv: z.number().nullish(),
  count: z.number().nullish(),
});

const itemSchema = z.object({
  target: z.string().nullish(),
  metrics: z
    .object({
      organic: z.array(monthPointSchema).nullish(),
      paid: z.array(monthPointSchema).nullish(),
    })
    .nullish(),
});

const resultSchema = z.object({
  location_code: z.number().int().nullish(),
  language_code: z.string().nullish(),
  items: z.array(itemSchema).nullish(),
});

const taskSchema = z.object({
  status_code: z.number().int(),
  status_message: z.string().nullish(),
  cost: z.number().nullish(),
  result: z.array(resultSchema).nullish(),
});

const envelopeSchema = z.object({
  status_code: z.number().int(),
  status_message: z.string().nullish(),
  cost: z.number().nullish(),
  tasks: z.array(taskSchema).nullish(),
});

const userDataSchema = z.object({
  status_code: z.number().int(),
  status_message: z.string().nullish(),
  tasks: z
    .array(
      z.object({
        status_code: z.number().int(),
        result: z
          .array(
            z.object({
              money: z
                .object({ balance: z.number().nullish(), total: z.number().nullish() })
                .nullish(),
            }),
          )
          .nullish(),
      }),
    )
    .nullish(),
});

// --- Vendor-neutral output ----------------------------------------------------------------

/** One calendar month of estimated search traffic for one target. */
export interface TrafficMonth {
  /** `YYYY-MM`. */
  month: string;
  /** Estimated visits from organic results. */
  organicVisits: number;
  /** Estimated visits from paid results. */
  paidVisits: number;
  /** Number of SERPs the target appeared in (organic). */
  serpCount: number;
}

export interface TargetTraffic {
  target: string;
  months: TrafficMonth[];
}

export interface TrafficLookup {
  targets: TargetTraffic[];
  /** Real cost of the request in USD, as reported by the provider. */
  costUsd: number;
  httpStatus: number;
  durationMs: number;
}

export interface AccountBalance {
  balanceUsd: number;
  totalUsd: number;
}

export interface DataForSeoClientOptions {
  baseUrl: string;
  login: string;
  password: string;
  timeoutMs: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface TrafficQuery {
  targets: string[];
  locationCode: number;
  languageCode: string;
  /** Inclusive `YYYY-MM-DD`. */
  dateFrom: string;
  /** Inclusive `YYYY-MM-DD`. */
  dateTo: string;
}

export class DataForSeoClient {
  private readonly baseUrl: string;
  private readonly authorization: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DataForSeoClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    // Encoded once; the raw password never leaves this object and is never logged.
    const credentials = Buffer.from(`${options.login}:${options.password}`).toString("base64");
    this.authorization = `Basic ${credentials}`;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Estimated monthly search traffic per target for one location, over a date window. */
  async historicalTraffic(query: TrafficQuery, signal?: AbortSignal): Promise<TrafficLookup> {
    if (query.targets.length === 0) {
      throw new ProviderError("PROVIDER_INVALID_INPUT", "no targets given");
    }
    if (query.targets.length > MAX_TARGETS_PER_REQUEST) {
      throw new ProviderError(
        "PROVIDER_INVALID_INPUT",
        `at most ${MAX_TARGETS_PER_REQUEST} targets per request`,
      );
    }
    const body = [
      {
        targets: query.targets,
        location_code: query.locationCode,
        language_code: query.languageCode,
        date_from: query.dateFrom < EARLIEST_HISTORY_DATE ? EARLIEST_HISTORY_DATE : query.dateFrom,
        date_to: query.dateTo,
        item_types: ["organic", "paid"],
      },
    ];
    const started = Date.now();
    const { payload, httpStatus } = await this.request(HISTORICAL_BULK_TRAFFIC_PATH, body, signal);
    const envelope = envelopeSchema.parse(payload);
    if (envelope.status_code !== OK) {
      throw providerErrorFor(envelope.status_code, envelope.status_message ?? "request failed");
    }
    const task = envelope.tasks?.[0];
    if (task && task.status_code !== OK) {
      throw providerErrorFor(task.status_code, task.status_message ?? "task failed");
    }
    const items = task?.result?.flatMap((r) => r.items ?? []) ?? [];
    return {
      targets: items
        .filter((item): item is typeof item & { target: string } => Boolean(item.target))
        .map((item) => ({
          target: item.target.toLowerCase(),
          months: mergeMonths(item.metrics?.organic ?? [], item.metrics?.paid ?? []),
        })),
      // `cost` is the authoritative price of this request; the task-level value is a subset.
      costUsd: envelope.cost ?? task?.cost ?? 0,
      httpStatus,
      durationMs: Date.now() - started,
    };
  }

  /** Account balance. Free of charge per the provider's documentation. */
  async accountBalance(signal?: AbortSignal): Promise<AccountBalance> {
    const { payload } = await this.request(USER_DATA_PATH, undefined, signal);
    const parsed = userDataSchema.parse(payload);
    if (parsed.status_code !== OK) {
      throw providerErrorFor(parsed.status_code, parsed.status_message ?? "request failed");
    }
    const money = parsed.tasks?.[0]?.result?.[0]?.money;
    return { balanceUsd: money?.balance ?? 0, totalUsd: money?.total ?? 0 };
  }

  /** `body` omitted = GET. */
  private async request(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<{ payload: unknown; httpStatus: number }> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: this.authorization,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
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
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("PROVIDER_AUTH_FAILED", `HTTP ${response.status}`);
    }
    if (response.status === 402) {
      throw new ProviderError("PROVIDER_QUOTA_EXHAUSTED", "HTTP 402 payment required");
    }
    if (response.status === 429) {
      throw new ProviderError("PROVIDER_RATE_LIMITED", "HTTP 429", { retryable: true });
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
    return { payload, httpStatus: response.status };
  }
}

/** Zips the organic and paid series into one month-keyed series sorted oldest to newest. */
function mergeMonths(
  organic: z.infer<typeof monthPointSchema>[],
  paid: z.infer<typeof monthPointSchema>[],
): TrafficMonth[] {
  const byMonth = new Map<string, TrafficMonth>();
  const upsert = (
    point: z.infer<typeof monthPointSchema>,
    apply: (m: TrafficMonth) => void,
  ): void => {
    const key = `${point.year}-${String(point.month).padStart(2, "0")}`;
    const existing = byMonth.get(key) ?? {
      month: key,
      organicVisits: 0,
      paidVisits: 0,
      serpCount: 0,
    };
    apply(existing);
    byMonth.set(key, existing);
  };
  for (const point of organic) {
    upsert(point, (m) => {
      m.organicVisits = Math.max(0, Math.round(point.etv ?? 0));
      m.serpCount = Math.max(0, Math.round(point.count ?? 0));
    });
  }
  for (const point of paid) {
    upsert(point, (m) => {
      m.paidVisits = Math.max(0, Math.round(point.etv ?? 0));
    });
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}
