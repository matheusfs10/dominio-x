import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("opens after consecutive failures and half-opens after the cooldown", () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 1000, now: () => now });
    expect(cb.allowRequest()).toBe(true);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe("closed");
    cb.recordFailure();
    expect(cb.state).toBe("open");
    expect(cb.allowRequest()).toBe(false);
    now = 1000;
    expect(cb.state).toBe("half_open");
    expect(cb.allowRequest()).toBe(true);
    expect(cb.allowRequest()).toBe(false);
    cb.recordSuccess();
    expect(cb.state).toBe("closed");
    expect(cb.allowRequest()).toBe(true);
  });
});
