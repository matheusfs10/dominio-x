import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testRedisUrl } from "@dominio-x/test-utils";
import { RedisRateLimiter } from "./redis.js";

const url = testRedisUrl();

describe.skipIf(!url)("RedisRateLimiter (integration)", () => {
  let redis: Redis;
  beforeAll(() => {
    redis = new Redis(url!, { maxRetriesPerRequest: 1 });
  });
  afterAll(async () => {
    await redis.quit();
  });

  it("enforces a global concurrency limit across clients", async () => {
    const key = `test:${Date.now()}`;
    const a = new RedisRateLimiter(redis, { key, rps: 1000, concurrency: 2 });
    const b = new RedisRateLimiter(new Redis(url!), { key, rps: 1000, concurrency: 2 });
    expect(await a.tryAcquireSlot("1")).toBe(true);
    expect(await b.tryAcquireSlot("2")).toBe(true);
    expect(await a.tryAcquireSlot("3")).toBe(false);
    await a.releaseSlot("1");
    expect(await b.tryAcquireSlot("3")).toBe(true);
    expect((await a.snapshot()).activeSlots).toBe(2);
  });

  it("rate limits tokens per second", async () => {
    const limiter = new RedisRateLimiter(redis, {
      key: `tb:${Date.now()}`,
      rps: 5,
      concurrency: 10,
      burst: 2,
    });
    const results = await Promise.all(Array.from({ length: 4 }, () => limiter.tryTakeToken()));
    expect(results.filter((r) => r.allowed).length).toBe(2);
    expect(results.find((r) => !r.allowed)?.waitMs).toBeGreaterThan(0);
    const started = Date.now();
    const release = await limiter.acquire({ maxWaitMs: 2000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    await release();
  });
});
