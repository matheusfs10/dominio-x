import { describe, expect, it } from "vitest";
import { backoffDelayMs, redisConnectionOptions, stageJobId, stageJobSchema } from "./index.js";

describe("queue helpers", () => {
  it("builds deterministic job ids", () => {
    const id = "0190f0a0-0000-7000-8000-000000000000";
    expect(stageJobId("preflight", id)).toBe(`preflight--${id}`);
    expect(stageJobId("crawl", id, "crawl_timeout")).toBe(`crawl_timeout--${id}`);
  });

  it("validates job payloads", () => {
    expect(() =>
      stageJobSchema.parse({ analysisRunId: "x", domainId: "y", stage: "dns" }),
    ).toThrow();
    const ok = stageJobSchema.parse({
      analysisRunId: "0190f0a0-0000-7000-8000-000000000000",
      domainId: "0190f0a0-0000-7000-8000-000000000001",
      stage: "dns",
    });
    expect(ok.kind).toBe("stage");
  });

  it("computes exponential backoff with bounded jitter", () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const d = backoffDelayMs(attempt, 1000);
      const base = Math.min(1000 * 2 ** (attempt - 1), 300_000);
      expect(d).toBeGreaterThanOrEqual(base * 0.7 - 1);
      expect(d).toBeLessThanOrEqual(base * 1.3 + 1);
    }
  });

  it("parses redis urls including auth, db and private networking", () => {
    const o = redisConnectionOptions("redis://default:p%40ss@redis.railway.internal:6379/2");
    expect(o).toMatchObject({
      host: "redis.railway.internal",
      port: 6379,
      username: "default",
      password: "p@ss",
      db: 2,
      family: 0,
    });
    const tls = redisConnectionOptions("rediss://h:6380");
    expect(tls).toHaveProperty("tls");
  });
});
