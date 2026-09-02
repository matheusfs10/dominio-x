import { describe, expect, it } from "vitest";
import { ConfigError, loadApiConfig, loadCrawlerConfig, loadWorkerConfig } from "./index.js";

const validApi = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "x".repeat(40),
  CRAWLER_MACHINE_TOKEN: "y".repeat(40),
  APP_URL: "http://localhost:3000",
  API_URL: "http://localhost:4000",
  STORAGE_DRIVER: "memory",
};

describe("config", () => {
  it("loads a valid api config with defaults", () => {
    const cfg = loadApiConfig(validApi);
    expect(cfg.PORT).toBe(4000);
    expect(cfg.SEMRUSH_ENABLED).toBe(false);
    expect(cfg.SEMRUSH_MAX_RPS).toBe(8);
    expect(cfg.STORAGE_DRIVER).toBe("memory");
  });

  it("fails fast for missing critical config", () => {
    expect(() => loadApiConfig({ ...validApi, DATABASE_URL: undefined })).toThrow(ConfigError);
    expect(() => loadApiConfig({ ...validApi, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
  });

  it("requires S3 credentials only when the s3 driver is used", () => {
    expect(() => loadWorkerConfig({ ...validApi, STORAGE_DRIVER: "s3" })).toThrow(/S3_ENDPOINT/);
    const cfg = loadWorkerConfig({
      ...validApi,
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://s3.example",
      S3_ACCESS_KEY_ID: "a",
      S3_SECRET_ACCESS_KEY: "b",
      S3_BUCKET: "c",
    });
    expect(cfg.S3_BUCKET).toBe("c");
  });

  it("does not require paid provider config to boot", () => {
    const cfg = loadApiConfig({ ...validApi, SEMRUSH_API_KEY: "" });
    expect(cfg.SEMRUSH_API_KEY).toBeUndefined();
  });

  it("crawler config never includes database or redis", () => {
    const cfg = loadCrawlerConfig({
      CRAWLER_CORE_API_URL: "https://api.example",
      CRAWLER_MACHINE_TOKEN: "z".repeat(40),
    });
    expect(cfg.CRAWLER_MAX_REDIRECTS).toBe(5);
    expect("DATABASE_URL" in cfg).toBe(false);
  });

  it("parses booleans permissively", () => {
    expect(loadApiConfig({ ...validApi, SEMRUSH_ENABLED: "TRUE" }).SEMRUSH_ENABLED).toBe(true);
    expect(loadApiConfig({ ...validApi, CRAWLER_ENABLED: "0" }).CRAWLER_ENABLED).toBe(false);
  });
});
