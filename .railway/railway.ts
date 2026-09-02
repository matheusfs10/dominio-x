/**
 * Railway Infrastructure as Code for the `dominio-x-core` project.
 * Apply with the Railway CLI: `railway config plan` / `railway config apply` (requires `railway/iac`).
 *
 * The IaC DSL does not cover cron schedules, pre-deploy commands, watch patterns or restart
 * policies; those are applied through the public API by `scripts/railway-provision.mjs`, which is
 * also the path used when the CLI is unavailable. Generated Railway domains and secrets
 * (SESSION_SECRET, CRAWLER_MACHINE_TOKEN) are preserved, never declared here.
 */
import {
  bucket,
  defineRailway,
  group,
  postgres,
  preserve,
  project,
  redis,
  service,
} from "railway/iac";

const REGION = "us-east4-eqdc4a";

export default defineRailway(() => {
  const db = postgres("Postgres");
  const cache = redis("Redis");
  const data = bucket("dominio-x-data", { region: "iad" });

  const shared = {
    NODE_ENV: "production",
    LOG_LEVEL: "info",
    DATABASE_URL: db.env.DATABASE_URL,
    REDIS_URL: cache.env.REDIS_URL,
    STORAGE_DRIVER: "s3",
    S3_ENDPOINT: data.env.ENDPOINT,
    S3_ACCESS_KEY_ID: data.env.ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: data.env.SECRET_ACCESS_KEY,
    S3_BUCKET: data.env.BUCKET,
    S3_REGION: data.env.REGION,
    S3_URL_STYLE: "virtual",
    CRAWLER_ENABLED: "true",
    SEMRUSH_ENABLED: "false",
    SEMRUSH_DATA_TTL_DAYS: "30",
    PROVIDER_RESTRICTED_RETENTION_DAYS: "30",
    APP_URL: preserve(),
    API_URL: preserve(),
    SESSION_SECRET: preserve(),
    CRAWLER_MACHINE_TOKEN: preserve(),
  };

  const api = service("api", {
    build:
      "pnpm install --frozen-lockfile && pnpm turbo run build --filter=@dominio-x/api --filter=@dominio-x/database",
    start: "node apps/api/dist/server.js",
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: { [REGION]: 1 },
    env: { ...shared, PORT: "4000", HOST: "0.0.0.0", TRUST_PROXY: "true" },
  });

  const worker = service("worker", {
    build: "pnpm install --frozen-lockfile && pnpm turbo run build --filter=@dominio-x/worker",
    start: "node apps/worker/dist/worker.js",
    replicas: { [REGION]: 1 },
    env: shared,
  });

  const scheduler = service("scheduler-registro-br", {
    build: "pnpm install --frozen-lockfile && pnpm turbo run build --filter=@dominio-x/scheduler",
    start: "node apps/scheduler/dist/registro-br.js",
    replicas: { [REGION]: 1 },
    env: shared,
  });

  const web = service("web", {
    build: "pnpm install --frozen-lockfile && pnpm turbo run build --filter=@dominio-x/web",
    start: "pnpm --filter @dominio-x/web start",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: { [REGION]: 1 },
    env: {
      NODE_ENV: "production",
      API_INTERNAL_URL: "http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4000",
      API_URL: preserve(),
      APP_URL: preserve(),
    },
  });

  return project("dominio-x-core", {
    resources: [group("Data", [db, cache, data]), group("Core", [api, worker, scheduler]), web],
  });
});
