import { z } from "zod";
import type { ProviderErrorCode } from "@dominio-x/contracts";
import { ProviderError } from "../types.js";

/**
 * The ONLY place in the platform that knows CapSolver endpoint paths, task type names,
 * response field names and error codes. Everything it returns is already normalized.
 *
 * Docs: https://docs.capsolver.com/en/
 */

const CREATE_TASK_PATH = "/createTask";
const GET_TASK_RESULT_PATH = "/getTaskResult";
const GET_BALANCE_PATH = "/getBalance";

export const ENDPOINT_KEYS = {
  createTask: "capsolver.createTask",
  getTaskResult: "capsolver.getTaskResult",
  getBalance: "capsolver.getBalance",
} as const;

/** Task type for a Turnstile widget solved without supplying a proxy. */
const TURNSTILE_TASK_TYPE = "AntiTurnstileTaskProxyLess";

/** `errorId` is 0 on success and non-zero on failure, whatever the HTTP status says. */
const OK = 0;

/** Vendor error code -> platform error code, and whether a retry can help. */
const ERROR_MAP: Record<string, [ProviderErrorCode, boolean]> = {
  ERROR_KEY_DENIED_ACCESS: ["PROVIDER_AUTH_FAILED", false],
  ERROR_KEY_TEMP_BLOCKED: ["PROVIDER_AUTH_FAILED", true],
  ERROR_ZERO_BALANCE: ["PROVIDER_QUOTA_EXHAUSTED", false],
  ERROR_SETTLEMENT_FAILED: ["PROVIDER_QUOTA_EXHAUSTED", false],
  ERROR_RATE_LIMIT: ["PROVIDER_RATE_LIMITED", true],
  ERROR_IP_BANNED: ["PROVIDER_RATE_LIMITED", true],
  ERROR_INVALID_TASK_DATA: ["PROVIDER_INVALID_INPUT", false],
  ERROR_BAD_REQUEST: ["PROVIDER_INVALID_INPUT", false],
  ERROR_TASK_NOT_SUPPORTED: ["PROVIDER_INVALID_INPUT", false],
  ERROR_TASKID_INVALID: ["PROVIDER_UPSTREAM_ERROR", true],
  ERROR_TASK_TIMEOUT: ["PROVIDER_TIMEOUT", true],
  ERROR_CAPTCHA_UNSOLVABLE: ["PROVIDER_UPSTREAM_ERROR", true],
  ERROR_SERVICE_UNAVALIABLE: ["PROVIDER_UPSTREAM_ERROR", true],
  ERROR_PROXY_BANNED: ["PROVIDER_UPSTREAM_ERROR", true],
};

function providerErrorFor(code: string | null | undefined, message: string): ProviderError {
  const hit = code ? ERROR_MAP[code] : undefined;
  return new ProviderError(
    hit?.[0] ?? "PROVIDER_UPSTREAM_ERROR",
    `[${code ?? "ERROR"}] ${message}`,
    {
      retryable: hit?.[1] ?? false,
    },
  );
}

// --- Response validation ------------------------------------------------------------------
// Permissive about unknown fields, strict about the ones we read.

const envelopeSchema = z.object({
  errorId: z.number().int(),
  errorCode: z.string().nullish(),
  errorDescription: z.string().nullish(),
});

const createTaskSchema = envelopeSchema.extend({
  taskId: z.string().nullish(),
  status: z.string().nullish(),
});

const taskResultSchema = envelopeSchema.extend({
  taskId: z.string().nullish(),
  /** `idle` | `processing` | `ready`. */
  status: z.string().nullish(),
  solution: z.object({ token: z.string().nullish(), userAgent: z.string().nullish() }).nullish(),
});

const balanceSchema = envelopeSchema.extend({ balance: z.number().nullish() });

// --- Vendor-neutral output ----------------------------------------------------------------

export interface CapSolverToken {
  token: string;
  userAgent?: string;
  /** Number of `getTaskResult` polls it took, for the ledger. */
  polls: number;
  durationMs: number;
}

export interface CapSolverClientOptions {
  baseUrl: string;
  apiKey: string;
  appId?: string;
  timeoutMs: number;
  pollIntervalMs: number;
  maxWaitMs: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests so a poll loop does not really sleep. */
  sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface TurnstileTaskInput {
  websiteUrl: string;
  websiteKey: string;
  action?: string;
  cData?: string;
}

export class CapSolverClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly appId: string | undefined;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(options: CapSolverClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    // Kept on the instance only; it is never logged and never returned by any method.
    this.apiKey = options.apiKey;
    this.appId = options.appId;
    this.timeoutMs = options.timeoutMs;
    this.pollIntervalMs = options.pollIntervalMs;
    this.maxWaitMs = options.maxWaitMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
  }

  /**
   * Creates a Turnstile task and polls until it is `ready`. The vendor bills a solved token
   * only, so an unsolvable task costs nothing and is reported as a retryable upstream error.
   */
  async solveTurnstile(input: TurnstileTaskInput, signal?: AbortSignal): Promise<CapSolverToken> {
    const startedAt = Date.now();
    const metadata: Record<string, string> = {};
    if (input.action) metadata.action = input.action;
    if (input.cData) metadata.cdata = input.cData;
    const created = createTaskSchema.parse(
      await this.request(
        CREATE_TASK_PATH,
        {
          clientKey: this.apiKey,
          ...(this.appId ? { appId: this.appId } : {}),
          task: {
            type: TURNSTILE_TASK_TYPE,
            websiteURL: input.websiteUrl,
            websiteKey: input.websiteKey,
            ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
          },
        },
        signal,
      ),
    );
    if (created.errorId !== OK) {
      throw providerErrorFor(created.errorCode, created.errorDescription ?? "createTask failed");
    }
    // Some task types answer synchronously; honour that before starting to poll.
    const taskId = created.taskId;
    if (!taskId) {
      throw new ProviderError("PROVIDER_UPSTREAM_ERROR", "createTask returned no taskId", {
        retryable: true,
      });
    }

    let polls = 0;
    for (;;) {
      if (Date.now() - startedAt >= this.maxWaitMs) {
        throw new ProviderError(
          "PROVIDER_TIMEOUT",
          `captcha not solved within ${this.maxWaitMs}ms`,
          { retryable: true },
        );
      }
      await this.sleepImpl(this.pollIntervalMs, signal);
      polls += 1;
      const result = taskResultSchema.parse(
        await this.request(GET_TASK_RESULT_PATH, { clientKey: this.apiKey, taskId }, signal),
      );
      if (result.errorId !== OK) {
        throw providerErrorFor(result.errorCode, result.errorDescription ?? "getTaskResult failed");
      }
      if (result.status !== "ready") continue;
      const token = result.solution?.token;
      if (!token) {
        throw new ProviderError("PROVIDER_UPSTREAM_ERROR", "solved task carried no token", {
          retryable: true,
        });
      }
      return {
        token,
        userAgent: result.solution?.userAgent ?? undefined,
        polls,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  /** Remaining credit in USD. The vendor documents this endpoint as free of charge. */
  async balanceUsd(signal?: AbortSignal): Promise<number> {
    const parsed = balanceSchema.parse(
      await this.request(GET_BALANCE_PATH, { clientKey: this.apiKey }, signal),
    );
    if (parsed.errorId !== OK) {
      throw providerErrorFor(parsed.errorCode, parsed.errorDescription ?? "getBalance failed");
    }
    return parsed.balance ?? 0;
  }

  private async request(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    if (response.status === 429) {
      throw new ProviderError("PROVIDER_RATE_LIMITED", "HTTP 429", { retryable: true });
    }
    try {
      return await response.json();
    } catch (error) {
      throw new ProviderError("PROVIDER_UPSTREAM_ERROR", `HTTP ${response.status}: invalid JSON`, {
        retryable: response.status >= 500,
        cause: error,
      });
    }
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError("PROVIDER_TIMEOUT", "aborted while waiting for the solver"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ProviderError("PROVIDER_TIMEOUT", "aborted while waiting for the solver"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
