import type { ProviderRequestLog } from "./types.js";

/**
 * Vendor-neutral captcha solving.
 *
 * A provider adapter that has to get past a challenge asks for a token through this interface
 * and never learns which service produced it. The concrete implementation lives in its own
 * vendor directory (`capsolver/`), exactly like any other provider adapter.
 */

/** Cloudflare Turnstile, the only challenge type the platform currently needs. */
export interface TurnstileChallenge {
  type: "turnstile";
  /** Page the widget is rendered on. */
  websiteUrl: string;
  /** Public site key of the widget. */
  websiteKey: string;
  /** `action` / `cdata` from the widget parameters, when the page sets them. */
  action?: string;
  cData?: string;
}

export interface SolvedCaptcha {
  token: string;
  /**
   * User agent the solver used. Some challenges bind the token to it, so a caller that has one
   * should send the same value.
   */
  userAgent?: string;
  /** Wall-clock time the solve took, for the request ledger. */
  durationMs: number;
  /** Price of this solve in USD, as configured for the solver. */
  costUsd: number;
  /** Ledger entries describing the calls made to the solving service. */
  requests: ProviderRequestLog[];
}

export interface CaptchaSolver {
  /** Stable key of the solving service, for logs and the request ledger. */
  readonly key: string;
  /** Price of one solved token in USD. The cost of a challenged lookup is exactly this. */
  readonly costPerSolveUsd: number;
  /** False when the service is switched off or has no credentials. */
  isConfigured(): boolean;
  describeStatus(): { configured: boolean; state: string; detail?: string };
  solve(challenge: TurnstileChallenge, signal?: AbortSignal): Promise<SolvedCaptcha>;
  /** Remaining credit in USD. Free to call, and cached by the implementation. */
  balanceUsd(options?: { force?: boolean; signal?: AbortSignal }): Promise<number>;
}
