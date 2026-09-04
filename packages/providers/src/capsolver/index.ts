import type { CapSolverConfig } from "@dominio-x/config";
import type { CaptchaSolver, SolvedCaptcha, TurnstileChallenge } from "../captcha.js";
import { ProviderError } from "../types.js";
import { CapSolverClient, ENDPOINT_KEYS } from "./client.js";

/**
 * CapSolver as the platform's captcha solver.
 *
 * It is not an `EnrichmentProvider`: it produces no observation about a domain. It is a paid
 * dependency of the providers that have to get past a challenge, and every solve it performs
 * is written to the request ledger under its own provider key so the money is visible in the
 * usage dashboard next to the lookup that needed it.
 */
export interface CapSolverOptions {
  config: CapSolverConfig;
  /** Injectable for tests. */
  client?: CapSolverClient;
}

export class CapSolver implements CaptchaSolver {
  readonly key = "capsolver";
  private readonly config: CapSolverConfig;
  private readonly injectedClient: CapSolverClient | null;
  private clientInstance: CapSolverClient | null = null;
  private balanceCache: { value: number; at: number } | null = null;

  constructor(options: CapSolverOptions) {
    this.config = options.config;
    this.injectedClient = options.client ?? null;
  }

  get costPerSolveUsd(): number {
    return this.config.CAPSOLVER_COST_PER_SOLVE_USD;
  }

  isConfigured(): boolean {
    return Boolean(this.config.CAPSOLVER_ENABLED && this.config.CAPSOLVER_API_KEY);
  }

  /** Never returns the key — only whether one is present. */
  describeStatus(): { configured: boolean; state: string; detail?: string } {
    if (!this.config.CAPSOLVER_API_KEY) {
      // Deliberately does not echo the environment variable name: the providers endpoint is
      // checked against anything that looks like a credential.
      return { configured: false, state: "not_configured", detail: "CapSolver credential missing" };
    }
    if (!this.config.CAPSOLVER_ENABLED) {
      return { configured: true, state: "disabled", detail: "CAPSOLVER_ENABLED=false" };
    }
    const price = this.config.CAPSOLVER_COST_PER_SOLVE_USD;
    const wait = Math.round(this.config.CAPSOLVER_MAX_WAIT_MS / 1000);
    return { configured: true, state: "ready", detail: `US$ ${price}/solve, up to ${wait}s` };
  }

  async solve(challenge: TurnstileChallenge, signal?: AbortSignal): Promise<SolvedCaptcha> {
    if (challenge.type !== "turnstile") {
      throw new ProviderError(
        "PROVIDER_INVALID_INPUT",
        `unsupported challenge type: ${String(challenge.type)}`,
      );
    }
    try {
      const solved = await this.client().solveTurnstile(
        {
          websiteUrl: challenge.websiteUrl,
          websiteKey: challenge.websiteKey,
          action: challenge.action,
          cData: challenge.cData,
        },
        signal,
      );
      return {
        token: solved.token,
        userAgent: solved.userAgent,
        durationMs: solved.durationMs,
        costUsd: this.costPerSolveUsd,
        requests: [
          {
            endpointKey: ENDPOINT_KEYS.createTask,
            // One createTask plus the polls it took; the ledger counts them as one billed unit.
            requestCount: 1 + solved.polls,
            unitsUsed: 1,
            estimatedCostUsd: this.costPerSolveUsd,
            durationMs: solved.durationMs,
            metadata: { challenge: "turnstile", polls: solved.polls },
          },
        ],
      };
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : "PROVIDER_UPSTREAM_ERROR";
      // A failed solve is not billed by the vendor, so no cost is attached to the ledger row.
      throw new ProviderError(
        code,
        error instanceof Error ? error.message : "captcha solve failed",
        { retryable: error instanceof ProviderError ? error.retryable : true, cause: error },
      );
    }
  }

  async balanceUsd(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<number> {
    const ttlMs = this.config.CAPSOLVER_BALANCE_CACHE_SECONDS * 1000;
    const cached = this.balanceCache;
    if (!options.force && cached && Date.now() - cached.at < ttlMs) return cached.value;
    const value = await this.client().balanceUsd(options.signal);
    this.balanceCache = { value, at: Date.now() };
    return value;
  }

  private client(): CapSolverClient {
    if (this.injectedClient) return this.injectedClient;
    if (this.clientInstance) return this.clientInstance;
    if (!this.config.CAPSOLVER_API_KEY) {
      throw new ProviderError("PROVIDER_NOT_CONFIGURED", "CapSolver API key missing");
    }
    this.clientInstance = new CapSolverClient({
      baseUrl: this.config.CAPSOLVER_BASE_URL,
      apiKey: this.config.CAPSOLVER_API_KEY,
      appId: this.config.CAPSOLVER_APP_ID,
      timeoutMs: this.config.CAPSOLVER_TIMEOUT_MS,
      pollIntervalMs: this.config.CAPSOLVER_POLL_INTERVAL_MS,
      maxWaitMs: this.config.CAPSOLVER_MAX_WAIT_MS,
    });
    return this.clientInstance;
  }
}

export { CapSolverClient, ENDPOINT_KEYS as CAPSOLVER_ENDPOINT_KEYS } from "./client.js";
export type { CapSolverToken, TurnstileTaskInput } from "./client.js";
