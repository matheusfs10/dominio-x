/**
 * Simple circuit breaker: after `failureThreshold` consecutive failures the circuit opens for
 * `openMs`; a single trial request is then allowed (half-open) and success closes it again.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private halfOpenInFlight = false;

  constructor(
    private readonly options: { failureThreshold: number; openMs: number; now?: () => number } = {
      failureThreshold: 5,
      openMs: 60_000,
    },
  ) {}

  private now() {
    return this.options.now ? this.options.now() : Date.now();
  }

  get state(): "closed" | "open" | "half_open" {
    if (this.openedAt === null) return "closed";
    if (this.now() - this.openedAt >= this.options.openMs) return "half_open";
    return "open";
  }

  /** Returns false when the request must be rejected without calling the provider. */
  allowRequest(): boolean {
    const state = this.state;
    if (state === "closed") return true;
    if (state === "half_open" && !this.halfOpenInFlight) {
      this.halfOpenInFlight = true;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.halfOpenInFlight = false;
  }

  recordFailure(): void {
    this.failures += 1;
    this.halfOpenInFlight = false;
    if (this.failures >= this.options.failureThreshold) this.openedAt = this.now();
  }

  snapshot() {
    return { state: this.state, consecutiveFailures: this.failures };
  }
}
