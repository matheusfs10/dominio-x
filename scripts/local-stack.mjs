#!/usr/bin/env node
/**
 * Boots a complete local stack without Docker for E2E / manual testing:
 * embedded PostgreSQL → migrate + seed (with a bootstrap admin) → api → worker → web (next start).
 * Requires a reachable Redis (REDIS_URL, default redis://127.0.0.1:6379) and a prior `pnpm build`.
 *
 *   node scripts/local-stack.mjs            # runs until Ctrl+C
 *   E2E=1 node scripts/local-stack.mjs      # also runs the Playwright critical flow, then exits
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const pnpm = isWin ? "pnpm.cmd" : "pnpm";

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

const children = [];
function run(name, cmd, args, env, cwd = root) {
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWin,
  });
  child.stdout.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  child.on("exit", (code) => console.log(`[${name}] exited ${code}`));
  children.push(child);
  return child;
}
const runOnce = (name, cmd, args, env, cwd) =>
  new Promise((resolve, reject) => {
    const child = run(name, cmd, args, env, cwd);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${name} exited ${code}`)),
    );
  });

async function waitFor(url, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} did not become ready`);
}

const { default: EmbeddedPostgres } = await import("embedded-postgres");
const pgPort = await freePort();
const dir = await mkdtemp(path.join(tmpdir(), "dominio-x-stack-"));
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "postgres",
  password: "postgres",
  port: pgPort,
  persistent: false,
  initdbFlags: ["--encoding=SQL_ASCII", "--locale=C"],
});
await pg.initialise();
await pg.start();
await pg.createDatabase("dominiox");
console.log(`[stack] postgres on ${pgPort}`);

const apiPort = process.env.API_PORT ?? "4100";
const webPort = process.env.WEB_PORT ?? "3100";
const env = {
  NODE_ENV: "development",
  DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${pgPort}/dominiox`,
  REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  SESSION_SECRET: "local-stack-session-secret-0123456789abcdef0123456789",
  CRAWLER_MACHINE_TOKEN: "local-stack-crawler-token-0123456789abcdef0123456789",
  APP_URL: `http://localhost:${webPort}`,
  API_URL: `http://localhost:${apiPort}`,
  API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
  STORAGE_DRIVER: "fs",
  STORAGE_FS_ROOT: path.join(dir, "storage"),
  CRAWLER_ENABLED: "false",
  BOOTSTRAP_ADMIN_EMAIL: process.env.E2E_EMAIL ?? "admin@dominio-x.local",
  BOOTSTRAP_ADMIN_PASSWORD: process.env.E2E_PASSWORD ?? "admin-password-123",
  PORT: apiPort,
  LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
};

async function shutdown(code) {
  for (const c of children) {
    try {
      if (isWin) spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
      else c.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  await pg.stop().catch(() => undefined);
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

try {
  await runOnce("migrate", "node", ["packages/database/dist/migrate.js"], env);
  await runOnce("seed", "node", ["packages/database/dist/seed.js", "--dev"], env);
  run("api", "node", ["apps/api/dist/server.js"], env);
  await waitFor(`http://127.0.0.1:${apiPort}/ready`, "api");
  run("worker", "node", ["apps/worker/dist/worker.js"], env);
  run("web", pnpm, ["--filter", "@dominio-x/web", "exec", "next", "start", "-p", webPort], {
    ...env,
    NODE_ENV: "production",
  });
  await waitFor(`http://127.0.0.1:${webPort}/api/health`, "web");
  console.log(
    `[stack] ready → web http://localhost:${webPort} · api http://localhost:${apiPort} · admin ${env.BOOTSTRAP_ADMIN_EMAIL}`,
  );
  if (process.env.E2E) {
    await runOnce(
      "e2e",
      pnpm,
      ["exec", "playwright", "test"],
      {
        ...env,
        E2E_BASE_URL: `http://localhost:${webPort}`,
        E2E_EMAIL: env.BOOTSTRAP_ADMIN_EMAIL,
        E2E_PASSWORD: env.BOOTSTRAP_ADMIN_PASSWORD,
      },
      path.join(root, "apps/web"),
    );
    console.log("[stack] e2e passed");
    await shutdown(0);
  }
} catch (error) {
  console.error("[stack] failed:", error instanceof Error ? error.message : error);
  await shutdown(1);
}
