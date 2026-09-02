import { describe, expect, it } from "vitest";
import { LocalRateLimiter } from "./local.js";

describe("LocalRateLimiter", () => {
  it("bounds concurrency", async () => {
    const limiter = new LocalRateLimiter({ rps: 1000, concurrency: 2 });
    let active = 0;
    let maxActive = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        const release = await limiter.acquire();
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active -= 1;
        release();
      }),
    );
    expect(maxActive).toBe(2);
  });

  it("enforces requests per second", async () => {
    const limiter = new LocalRateLimiter({ rps: 20, concurrency: 10, burst: 1 });
    const started = Date.now();
    for (let i = 0; i < 5; i++) (await limiter.acquire())();
    // 4 refills at 20 rps ≈ 200ms minimum
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });
});
