import { describe, expect, it, vi } from "vitest";
import { capSolverSchema } from "@dominio-x/config";
import { CapSolverClient } from "./client.js";
import { CapSolver } from "./index.js";

/** `fetch` accepts several body and input shapes; the adapter only ever sends these two. */
const urlOf = (input: string | URL | Request): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
const bodyOf = (init?: RequestInit): unknown =>
  typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A `fetch` stub that answers each call from a queue, keeping the real signature. */
function mockFetch(responses: unknown[]) {
  const calls: { url: string; body: unknown }[] = [];
  const fn = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: urlOf(input), body: bodyOf(init) });
    const next = responses.shift();
    return Promise.resolve(jsonResponse(next ?? { errorId: 1, errorCode: "ERROR_BAD_REQUEST" }));
  });
  return { fn, calls };
}

function client(responses: unknown[], overrides: Partial<{ maxWaitMs: number }> = {}) {
  const { fn, calls } = mockFetch(responses);
  return {
    calls,
    fetch: fn,
    client: new CapSolverClient({
      baseUrl: "https://api.capsolver.com",
      apiKey: "super-secret-key",
      timeoutMs: 1_000,
      pollIntervalMs: 1,
      maxWaitMs: overrides.maxWaitMs ?? 5_000,
      fetchImpl: fn,
      // Nothing really sleeps in a test.
      sleepImpl: () => Promise.resolve(),
    }),
  };
}

const challenge = {
  type: "turnstile" as const,
  websiteUrl: "https://ahrefs.com/backlink-checker/",
  websiteKey: "0x4AAAAAAAAzi9ITzSN9xKMi",
};

describe("CapSolverClient", () => {
  it("creates a Turnstile task and polls until a token is ready", async () => {
    const h = client([
      { errorId: 0, status: "idle", taskId: "t-1" },
      { errorId: 0, taskId: "t-1", status: "processing" },
      {
        errorId: 0,
        taskId: "t-1",
        status: "ready",
        solution: { token: "0.tok", userAgent: "Mozilla/5.0 test" },
      },
    ]);
    const solved = await h.client.solveTurnstile({
      websiteUrl: challenge.websiteUrl,
      websiteKey: challenge.websiteKey,
    });
    expect(solved.token).toBe("0.tok");
    expect(solved.userAgent).toBe("Mozilla/5.0 test");
    expect(solved.polls).toBe(2);

    const create = h.calls[0]!;
    expect(create.url).toBe("https://api.capsolver.com/createTask");
    expect(create.body).toMatchObject({
      clientKey: "super-secret-key",
      task: {
        type: "AntiTurnstileTaskProxyLess",
        websiteURL: challenge.websiteUrl,
        websiteKey: challenge.websiteKey,
      },
    });
    expect(h.calls[1]!.url).toBe("https://api.capsolver.com/getTaskResult");
  });

  it("passes the widget action and cdata through as task metadata", async () => {
    const h = client([
      { errorId: 0, taskId: "t-1" },
      { errorId: 0, status: "ready", solution: { token: "0.tok" } },
    ]);
    await h.client.solveTurnstile({
      websiteUrl: challenge.websiteUrl,
      websiteKey: challenge.websiteKey,
      action: "check",
      cData: "abc",
    });
    expect(h.calls[0]!.body).toMatchObject({
      task: { metadata: { action: "check", cdata: "abc" } },
    });
  });

  it("maps a denied key to an auth failure that is not retried", async () => {
    const h = client([
      { errorId: 1, errorCode: "ERROR_KEY_DENIED_ACCESS", errorDescription: "bad key" },
    ]);
    await expect(
      h.client.solveTurnstile({ websiteUrl: "u", websiteKey: "k" }),
    ).rejects.toMatchObject({ code: "PROVIDER_AUTH_FAILED", retryable: false });
  });

  it("maps an empty balance to a quota error", async () => {
    const h = client([{ errorId: 1, errorCode: "ERROR_ZERO_BALANCE" }]);
    await expect(
      h.client.solveTurnstile({ websiteUrl: "u", websiteKey: "k" }),
    ).rejects.toMatchObject({ code: "PROVIDER_QUOTA_EXHAUSTED" });
  });

  it("gives up once the maximum wait has elapsed", async () => {
    const h = client(
      [
        { errorId: 0, taskId: "t-1" },
        ...Array.from({ length: 50 }, () => ({ errorId: 0, status: "processing" })),
      ],
      { maxWaitMs: 0 },
    );
    await expect(
      h.client.solveTurnstile({ websiteUrl: "u", websiteKey: "k" }),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT", retryable: true });
  });

  it("reads the account balance", async () => {
    const h = client([{ errorId: 0, balance: 12.5 }]);
    await expect(h.client.balanceUsd()).resolves.toBe(12.5);
  });
});

describe("CapSolver", () => {
  const config = (env: Record<string, string> = {}) =>
    capSolverSchema.parse({ CAPSOLVER_ENABLED: "true", CAPSOLVER_API_KEY: "k", ...env });

  it("is not configured without a key and never calls out", () => {
    const solver = new CapSolver({ config: capSolverSchema.parse({}) });
    expect(solver.isConfigured()).toBe(false);
    expect(solver.describeStatus().state).toBe("not_configured");
  });

  it("reports disabled separately from missing credentials", () => {
    const solver = new CapSolver({
      config: capSolverSchema.parse({ CAPSOLVER_API_KEY: "k" }),
    });
    expect(solver.describeStatus().state).toBe("disabled");
  });

  it("never leaks the key through its status", () => {
    const solver = new CapSolver({ config: config({ CAPSOLVER_API_KEY: "super-secret-key" }) });
    expect(JSON.stringify(solver.describeStatus())).not.toContain("super-secret-key");
  });

  it("prices a solve from the configured price list and reports it in the ledger", async () => {
    const h = client([
      { errorId: 0, taskId: "t-1" },
      { errorId: 0, status: "ready", solution: { token: "0.tok" } },
    ]);
    const solver = new CapSolver({
      config: config({ CAPSOLVER_COST_PER_SOLVE_USD: "0.0025" }),
      client: h.client,
    });
    const solved = await solver.solve(challenge);
    expect(solved.token).toBe("0.tok");
    expect(solved.costUsd).toBe(0.0025);
    expect(solver.costPerSolveUsd).toBe(0.0025);
    expect(solved.requests).toHaveLength(1);
    expect(solved.requests[0]).toMatchObject({ unitsUsed: 1, estimatedCostUsd: 0.0025 });
  });

  it("caches the free balance lookup", async () => {
    const h = client([{ errorId: 0, balance: 9 }]);
    const solver = new CapSolver({ config: config(), client: h.client });
    await expect(solver.balanceUsd()).resolves.toBe(9);
    await expect(solver.balanceUsd()).resolves.toBe(9);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
});
