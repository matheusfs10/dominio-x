/**
 * In-process token bucket + concurrency semaphore. Suitable for free providers where a
 * global (cross-replica) limit is unnecessary.
 */
export class LocalRateLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  private active = 0;
  private readonly rps: number;
  private readonly burst: number;
  private readonly concurrency: number;
  private readonly waiters: (() => void)[] = [];

  constructor(options: { rps: number; concurrency: number; burst?: number }) {
    this.rps = options.rps;
    this.concurrency = options.concurrency;
    this.burst = options.burst ?? Math.max(1, Math.ceil(options.rps));
    this.tokens = this.burst;
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rps);
    this.lastRefill = now;
  }

  async acquire(): Promise<() => void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1 && this.active < this.concurrency) {
        this.tokens -= 1;
        this.active += 1;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          this.active -= 1;
          this.waiters.shift()?.();
        };
      }
      const waitMs = this.tokens < 1 ? Math.ceil(((1 - this.tokens) / this.rps) * 1000) : 25;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.max(5, waitMs));
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}
