import { defineConfig } from "@playwright/test";

/**
 * Critical-flow E2E. Requires a running stack (web + api + worker + Postgres + Redis) and an
 * analyst/admin account supplied via E2E_EMAIL / E2E_PASSWORD. Never run against production
 * with a privileged account.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
});
