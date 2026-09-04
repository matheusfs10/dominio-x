import { describe, expect, it, vi } from "vitest";
import { dataForSeoSchema } from "@dominio-x/config";
import { METRICS } from "@dominio-x/contracts";
import { DataForSeoClient } from "./client.js";
import { DataForSeoProvider } from "./index.js";
import { mapTrafficObservations, monthsInWindow, trafficWindow } from "./mapping.js";

const domain = {
  id: "d",
  asciiFqdn: "cafe.com.br",
  unicodeFqdn: "cafe.com.br",
  registrableDomain: "cafe.com.br",
  sld: "cafe",
  tld: "com.br",
  isIdn: false,
};

const NOW = new Date("2026-09-04T12:00:00Z");

/** Six complete months ending in August 2026, growing steadily. */
function successPayload(cost = 0.0225) {
  return {
    status_code: 20000,
    status_message: "Ok.",
    cost,
    tasks: [
      {
        status_code: 20000,
        cost,
        result: [
          {
            location_code: 2076,
            language_code: "pt",
            items: [
              {
                target: "cafe.com.br",
                metrics: {
                  organic: [
                    { year: 2026, month: 3, etv: 100, count: 12 },
                    { year: 2026, month: 4, etv: 120, count: 14 },
                    { year: 2026, month: 5, etv: 140, count: 15 },
                    { year: 2026, month: 6, etv: 200, count: 20 },
                    { year: 2026, month: 7, etv: 220, count: 22 },
                    { year: 2026, month: 8, etv: 260, count: 25 },
                    // Outside the window: must be ignored.
                    { year: 2026, month: 9, etv: 9999, count: 99 },
                  ],
                  paid: [{ year: 2026, month: 8, etv: 30, count: 3 }],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

/** A `fetch` stub that keeps the real signature so call arguments stay typed. */
function mockFetch(handler: () => Response) {
  return vi.fn((_input: string | URL | Request, _init?: RequestInit) => Promise.resolve(handler()));
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function configuredProvider(fetchImpl: ReturnType<typeof mockFetch>) {
  const config = dataForSeoSchema.parse({
    DATAFORSEO_ENABLED: "true",
    DATAFORSEO_LOGIN: "login@example.com",
    DATAFORSEO_PASSWORD: "super-secret",
  });
  const client = new DataForSeoClient({
    baseUrl: config.DATAFORSEO_BASE_URL,
    login: config.DATAFORSEO_LOGIN!,
    password: config.DATAFORSEO_PASSWORD!,
    timeoutMs: config.DATAFORSEO_TIMEOUT_MS,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return new DataForSeoProvider({ config, client, now: () => NOW });
}

describe("trafficWindow", () => {
  it("covers the last N complete months and excludes the running month", () => {
    const w = trafficWindow(6, { code: 2076, name: "Brazil" }, NOW);
    expect(w.from).toBe("2026-03-01");
    expect(w.to).toBe("2026-08-31");
    expect(w.months).toBe(6);
  });

  it("crosses the year boundary", () => {
    const w = trafficWindow(6, { code: 2076, name: "Brazil" }, new Date("2026-02-10T00:00:00Z"));
    expect(w.from).toBe("2025-08-01");
    expect(w.to).toBe("2026-01-31");
  });

  it("keeps only months inside the window", () => {
    const w = trafficWindow(6, { code: 2076, name: "Brazil" }, NOW);
    const months = monthsInWindow(
      [
        { month: "2026-02", organicVisits: 1, paidVisits: 0, serpCount: 0 },
        { month: "2026-03", organicVisits: 2, paidVisits: 0, serpCount: 0 },
        { month: "2026-09", organicVisits: 3, paidVisits: 0, serpCount: 0 },
      ],
      w,
    );
    expect(months.map((m) => m.month)).toEqual(["2026-03"]);
  });
});

describe("mapTrafficObservations", () => {
  const window = trafficWindow(6, { code: 2076, name: "Brazil" }, NOW);
  const value = (obs: ReturnType<typeof mapTrafficObservations>, key: string) =>
    obs.find((o) => o.metricKey === key);

  it("never reports zero when the provider returned no row", () => {
    const obs = mapTrafficObservations(null, { window, ttlHours: 720 });
    expect(value(obs, METRICS.TRAFFIC_VISITS_TOTAL)!.state).toBe("unknown");
    expect(value(obs, METRICS.TRAFFIC_VISITS_TOTAL)!.value).toBeUndefined();
    expect(value(obs, METRICS.TRAFFIC_HAS_DATA)!.value).toBe(false);
  });

  it("marks the values not_available when there are no rows inside the window", () => {
    const obs = mapTrafficObservations(
      {
        target: "cafe.com.br",
        months: [{ month: "2020-01", organicVisits: 5, paidVisits: 0, serpCount: 1 }],
      },
      { window, ttlHours: 720 },
    );
    expect(value(obs, METRICS.TRAFFIC_VISITS_TOTAL)!.state).toBe("not_available");
  });

  it("leaves the trend unknown when the baseline half has no traffic", () => {
    const months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].map(
      (month, i) => ({ month, organicVisits: i < 3 ? 0 : 50, paidVisits: 0, serpCount: 1 }),
    );
    const obs = mapTrafficObservations(
      { target: "cafe.com.br", months },
      { window, ttlHours: 720 },
    );
    expect(value(obs, METRICS.TRAFFIC_TREND_RATIO)!.state).toBe("not_available");
    expect(value(obs, METRICS.TRAFFIC_MONTHS_WITH_TRAFFIC)!.value).toBe(3);
  });
});

describe("DataForSeoProvider", () => {
  it("is not configured without credentials and never calls out", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}));
    const provider = new DataForSeoProvider({
      config: dataForSeoSchema.parse({ DATAFORSEO_ENABLED: "true" }),
      client: new DataForSeoClient({
        baseUrl: "https://api.dataforseo.com",
        login: "x",
        password: "y",
        timeoutMs: 1000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    });
    expect(provider.isConfigured()).toBe(false);
    const result = await provider.enrich({ domain, analysisRunId: "r" });
    expect(result.status).toBe("skipped");
    expect(result.errorCode).toBe("PROVIDER_NOT_CONFIGURED");
    expect(result.requests).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips when disabled even with credentials present", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}));
    const provider = new DataForSeoProvider({
      config: dataForSeoSchema.parse({
        DATAFORSEO_ENABLED: "false",
        DATAFORSEO_LOGIN: "l",
        DATAFORSEO_PASSWORD: "p",
      }),
      client: new DataForSeoClient({
        baseUrl: "https://api.dataforseo.com",
        login: "l",
        password: "p",
        timeoutMs: 1000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    });
    const result = await provider.enrich({ domain, analysisRunId: "r" });
    expect(result.errorCode).toBe("PROVIDER_DISABLED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a successful lookup and records the price the provider reported", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(successPayload(0.0225)));
    const provider = configuredProvider(fetchImpl);
    const result = await provider.enrich({ domain, analysisRunId: "r" });

    expect(result.status).toBe("ok");
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]!.estimatedCostUsd).toBe(0.0225);
    expect(result.requests[0]!.unitsUsed).toBe(1);

    const byKey = new Map(result.observations.map((o) => [o.metricKey, o]));
    expect(byKey.get(METRICS.TRAFFIC_VISITS_TOTAL)!.value).toBe(1040);
    expect(byKey.get(METRICS.TRAFFIC_VISITS_LAST_MONTH)!.value).toBe(260);
    expect(byKey.get(METRICS.TRAFFIC_VISITS_PEAK_MONTH)!.value).toBe(260);
    expect(byKey.get(METRICS.TRAFFIC_MONTHS_WITH_TRAFFIC)!.value).toBe(6);
    expect(byKey.get(METRICS.TRAFFIC_PAID_VISITS_TOTAL)!.value).toBe(30);
    // (200+220+260) / (100+120+140) = 1.888...
    expect(byKey.get(METRICS.TRAFFIC_TREND_RATIO)!.value).toBe(1.889);
    expect(byKey.get(METRICS.TRAFFIC_VISITS_MONTHLY_AVG)!.value).toBe(173.33);
    expect(byKey.get(METRICS.TRAFFIC_LOCATION_CODE)!.value).toBe(2076);
    expect(byKey.get(METRICS.TRAFFIC_MONTHLY_SERIES)!.value).toHaveLength(6);
    for (const key of [METRICS.TRAFFIC_VISITS_TOTAL, METRICS.TRAFFIC_MONTHLY_SERIES]) {
      expect(byKey.get(key)!.licenseClass).toBe("provider_restricted");
    }
  });

  it("sends exactly one target, the configured location and the computed window", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(successPayload()));
    const provider = configuredProvider(fetchImpl);
    await provider.enrich({ domain, analysisRunId: "r" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain(
      "/v3/dataforseo_labs/google/historical_bulk_traffic_estimation/live",
    );
    const body = JSON.parse(String(init!.body)) as {
      targets: string[];
      location_code: number;
      date_from: string;
      date_to: string;
    }[];
    expect(body).toHaveLength(1);
    expect(body[0]!.targets).toEqual(["cafe.com.br"]);
    expect(body[0]!.location_code).toBe(2076);
    expect(body[0]!.date_from).toBe("2026-03-01");
    expect(body[0]!.date_to).toBe("2026-08-31");
  });

  it("translates provider status codes and never bills a failed call", async () => {
    const cases: [number, string][] = [
      [40100, "PROVIDER_AUTH_FAILED"],
      [40210, "PROVIDER_QUOTA_EXHAUSTED"],
      [40202, "PROVIDER_RATE_LIMITED"],
      [40501, "PROVIDER_INVALID_INPUT"],
      [50000, "PROVIDER_UPSTREAM_ERROR"],
    ];
    for (const [statusCode, expected] of cases) {
      const fetchImpl = mockFetch(() =>
        jsonResponse({ status_code: statusCode, status_message: "nope", tasks: [] }),
      );
      const provider = configuredProvider(fetchImpl);
      const result = await provider.enrich({ domain, analysisRunId: "r" });
      expect(result.status).toBe("error");
      expect(result.errorCode).toBe(expected);
      expect(result.requests[0]!.estimatedCostUsd).toBeUndefined();
      expect(result.observations.every((o) => o.state === "error")).toBe(true);
    }
  });

  it("never leaks credentials into the result", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(successPayload()));
    const provider = configuredProvider(fetchImpl);
    const result = await provider.enrich({ domain, analysisRunId: "r" });
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(JSON.stringify(provider.describeStatus())).not.toContain("super-secret");
  });

  it("caches the free balance lookup", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({
        status_code: 20000,
        tasks: [{ status_code: 20000, result: [{ money: { balance: 12.5, total: 50 } }] }],
      }),
    );
    const provider = configuredProvider(fetchImpl);
    expect((await provider.accountBalance()).balanceUsd).toBe(12.5);
    expect((await provider.accountBalance()).balanceUsd).toBe(12.5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
