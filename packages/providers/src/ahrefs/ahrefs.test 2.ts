import { describe, expect, it, vi } from "vitest";
import { ahrefsSchema } from "@dominio-x/config";
import { METRICS } from "@dominio-x/contracts";
import type { CaptchaSolver, SolvedCaptcha, TurnstileChallenge } from "../captcha.js";
import { ProviderError } from "../types.js";
import { AhrefsClient, targetUrlFor } from "./client.js";
import { AhrefsProvider } from "./index.js";
import { mapAuthorityObservations } from "./mapping.js";

const domain = {
  id: "d",
  asciiFqdn: "cnmd.com.br",
  unicodeFqdn: "cnmd.com.br",
  registrableDomain: "cnmd.com.br",
  sld: "cnmd",
  tld: "com.br",
  isIdn: false,
};

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A `fetch` stub that keeps the real signature so call arguments stay typed. */
function mockFetch(handler: () => Response) {
  return vi.fn((_input: string | URL | Request, _init?: RequestInit) => Promise.resolve(handler()));
}

const okPayload = (overrides: Record<string, number> = {}) => [
  "Ok",
  {
    data: {
      domainRating: 42.5,
      backlinks: 1234,
      refdomains: 80,
      dofollowBacklinks: 900,
      dofollowRefdomains: 60,
      ...overrides,
    },
    signedInput: { input: { url: "https://cnmd.com.br/", mode: "subdomains" }, signature: "s" },
  },
];

/** Solver stub: records what it was asked for and never touches the network. */
class StubSolver implements CaptchaSolver {
  readonly key = "stub-solver";
  readonly costPerSolveUsd = 0.002;
  readonly seen: TurnstileChallenge[] = [];
  constructor(private readonly behaviour: { fail?: ProviderError; token?: string } = {}) {}
  isConfigured(): boolean {
    return true;
  }
  describeStatus(): { configured: boolean; state: string; detail?: string } {
    return { configured: true, state: "ready" };
  }
  solve(challenge: TurnstileChallenge): Promise<SolvedCaptcha> {
    this.seen.push(challenge);
    if (this.behaviour.fail) return Promise.reject(this.behaviour.fail);
    return Promise.resolve({
      token: this.behaviour.token ?? "0.turnstile-token",
      userAgent: "Mozilla/5.0 solver",
      durationMs: 12,
      costUsd: this.costPerSolveUsd,
      requests: [],
    });
  }
  balanceUsd(): Promise<number> {
    return Promise.resolve(7);
  }
}

const config = (env: Record<string, string> = {}) =>
  ahrefsSchema.parse({ AHREFS_ENABLED: "true", ...env });

function providerWith(
  handler: () => Response,
  options: { solver?: CaptchaSolver; env?: Record<string, string> } = {},
) {
  const fetchImpl = mockFetch(handler);
  const provider = new AhrefsProvider({
    config: config(options.env),
    solver: options.solver ?? new StubSolver(),
    client: new AhrefsClient({
      baseUrl: "https://ahrefs.com",
      timeoutMs: 1_000,
      userAgent: "test-agent",
      fetchImpl,
    }),
  });
  return { provider, fetchImpl };
}

describe("targetUrlFor", () => {
  it("builds the URL the tool expects from a bare domain", () => {
    expect(targetUrlFor("cnmd.com.br", "https")).toBe("https://cnmd.com.br/");
    expect(targetUrlFor("cnmd.com.br", "http")).toBe("http://cnmd.com.br/");
  });
});

describe("mapAuthorityObservations", () => {
  const options = { ttlHours: 720 };

  it("never reports zero when the tool returned no row", () => {
    const obs = mapAuthorityObservations(null, options);
    const dr = obs.find((o) => o.metricKey === METRICS.AUTHORITY_DOMAIN_RATING);
    expect(dr?.state).toBe("unknown");
    expect(dr?.value).toBeUndefined();
    expect(obs.find((o) => o.metricKey === METRICS.AUTHORITY_HAS_DATA)?.value).toBe(false);
  });

  it("maps every value and derives the dofollow ratio", () => {
    const obs = mapAuthorityObservations(
      {
        target: "https://cnmd.com.br/",
        mode: "subdomains",
        overview: {
          domainRating: 42.5,
          backlinks: 1234,
          referringDomains: 80,
          dofollowBacklinks: 900,
          dofollowReferringDomains: 60,
        },
        httpStatus: 200,
        durationMs: 1,
      },
      options,
    );
    const value = (key: string) => obs.find((o) => o.metricKey === key);
    expect(value(METRICS.AUTHORITY_DOMAIN_RATING)?.value).toBe(42.5);
    expect(value(METRICS.AUTHORITY_REFERRING_DOMAINS)?.value).toBe(80);
    expect(value(METRICS.AUTHORITY_DOFOLLOW_RATIO)?.value).toBe(0.75);
    expect(value(METRICS.AUTHORITY_HAS_DATA)?.value).toBe(true);
    expect(value(METRICS.AUTHORITY_TARGET_URL)?.value).toBe("https://cnmd.com.br/");
    expect(value(METRICS.AUTHORITY_MODE)?.value).toBe("subdomains");
  });

  it("leaves the ratio unknown when there is no baseline to divide by", () => {
    const obs = mapAuthorityObservations(
      {
        target: "https://cnmd.com.br/",
        mode: "subdomains",
        overview: {
          domainRating: 0,
          backlinks: 0,
          referringDomains: 0,
          dofollowBacklinks: 0,
          dofollowReferringDomains: 0,
        },
        httpStatus: 200,
        durationMs: 1,
      },
      options,
    );
    const ratio = obs.find((o) => o.metricKey === METRICS.AUTHORITY_DOFOLLOW_RATIO);
    expect(ratio?.state).toBe("not_available");
    // A domain the index knows at DR 0 still counts as having data.
    expect(obs.find((o) => o.metricKey === METRICS.AUTHORITY_HAS_DATA)?.value).toBe(true);
  });
});

describe("AhrefsProvider", () => {
  it("is not configured without a solver and never calls out", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(okPayload()));
    const provider = new AhrefsProvider({
      config: config(),
      client: new AhrefsClient({
        baseUrl: "https://ahrefs.com",
        timeoutMs: 1_000,
        userAgent: "t",
        fetchImpl,
      }),
    });
    expect(provider.isConfigured()).toBe(false);
    const result = await provider.enrich({ domain, analysisRunId: "r" });
    expect(result.status).toBe("skipped");
    expect(result.errorCode).toBe("PROVIDER_NOT_CONFIGURED");
    expect(result.requests).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips when disabled even with a working solver", async () => {
    const { provider, fetchImpl } = providerWith(() => jsonResponse(okPayload()), {
      env: { AHREFS_ENABLED: "false" },
    });
    const result = await provider.enrich({ domain, analysisRunId: "r" });
    expect(result.status).toBe("skipped");
    expect(result.errorCode).toBe("PROVIDER_DISABLED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a successful lookup and bills exactly one solve", async () => {
    const solver = new StubSolver();
    const { provider } = providerWith(() => jsonResponse(okPayload()), { solver });
    const result = await provider.enrich({ domain, analysisRunId: "r" });
    expect(result.status).toBe("ok");
    const dr = result.observations.find((o) => o.metricKey === METRICS.AUTHORITY_DOMAIN_RATING);
    expect(dr?.state).toBe("measured");
    expect(dr?.value).toBe(42.5);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({
      endpointKey: "ahrefs.stGetFreeBacklinksOverview",
      unitsUsed: 1,
      estimatedCostUsd: 0.002,
      statusCode: 200,
    });
    expect(solver.seen[0]).toMatchObject({
      type: "turnstile",
      websiteUrl: "https://ahrefs.com/backlink-checker/",
      websiteKey: "0x4AAAAAAAAzi9ITzSN9xKMi",
    });
  });

  it("sends the configured mode, the built URL and the freshly solved token", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      // The adapter always sends a JSON string body; anything else is a bug worth failing on.
      bodies.push(typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null);
      return Promise.resolve(jsonResponse(okPayload()));
    });
    const provider = new AhrefsProvider({
      config: config({ AHREFS_MODE: "domain" }),
      solver: new StubSolver({ token: "0.fresh" }),
      client: new AhrefsClient({
        baseUrl: "https://ahrefs.com",
        timeoutMs: 1_000,
        userAgent: "t",
        fetchImpl,
      }),
    });
    await provider.enrich({ domain, analysisRunId: "r" });
    expect(bodies[0]).toEqual({
      url: "https://cnmd.com.br/",
      mode: "domain",
      captcha: "0.fresh",
    });
  });

  it("charges the solve even when the lookup that followed it failed", async () => {
    const { provider } = providerWith(() => jsonResponse(["Error", ["InvalidCaptcha"]]));
    const result = await provider.enrich({ domain, analysisRunId: "r" });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("PROVIDER_AUTH_FAILED");
    // The token was paid for before the tool rejected it: the money must be on the ledger.
    expect(result.requests[0]).toMatchObject({ estimatedCostUsd: 0.002, unitsUsed: 1 });
    expect(result.observations.every((o) => o.state === "error")).toBe(true);
  });

  it("bills nothing when the solve itself failed", async () => {
    const { provider, fetchImpl } = providerWith(() => jsonResponse(okPayload()), {
      solver: new StubSolver({
        fail: new ProviderError("PROVIDER_QUOTA_EXHAUSTED", "no credit"),
      }),
    });
    const result = await provider.enrich({ domain, analysisRunId: "r" });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("PROVIDER_QUOTA_EXHAUSTED");
    expect(result.requests[0]).toMatchObject({ estimatedCostUsd: 0, unitsUsed: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an invalid target as bad input rather than as a missing value", async () => {
    const { provider } = providerWith(() => jsonResponse(["Error", ["InvalidUrl"]]));
    const result = await provider.enrich({ domain, analysisRunId: "r" });
    expect(result.errorCode).toBe("PROVIDER_INVALID_INPUT");
  });

  it("names the WAF explicitly when the egress is challenged", async () => {
    const { provider } = providerWith(() => jsonResponse({}, 403, { "cf-mitigated": "challenge" }));
    const result = await provider.enrich({ domain, analysisRunId: "r" });
    expect(result.status).toBe("error");
    expect(result.message).toContain("WAF");
  });

  it("refuses an unrecognised response shape instead of inventing a zero", async () => {
    const { provider } = providerWith(() => jsonResponse({ unexpected: true }));
    const result = await provider.enrich({ domain, analysisRunId: "r" });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("PROVIDER_UPSTREAM_ERROR");
  });

  it("prices an estimate at exactly one solve", async () => {
    const { provider } = providerWith(() => jsonResponse(okPayload()));
    await expect(provider.estimate({ domain, analysisRunId: "r" })).resolves.toEqual({
      units: 1,
      estimatedCostUsd: 0.002,
      cached: false,
    });
  });
});
