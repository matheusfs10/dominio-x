/**
 * Vitest global setup: provides a PostgreSQL server and (when reachable) a Redis server
 * for integration tests. Values are handed to test workers through environment variables
 * (workers are forked after this runs).
 *
 * - TEST_DATABASE_URL set → used as-is (CI service container, local Docker).
 * - otherwise → an embedded PostgreSQL is started in a temp dir (no Docker required).
 * - TEST_REDIS_URL / REDIS_URL → probed; when unreachable, Redis-dependent tests skip themselves.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function probeRedis(url: string): Promise<boolean> {
  const { Redis } = await import("ioredis");
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await client.connect();
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  let teardown: (() => Promise<void>) | undefined;

  let databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const port = await freePort();
    const dir = await mkdtemp(join(tmpdir(), "dominio-x-pg-"));
    const pg = new EmbeddedPostgres({
      databaseDir: dir,
      user: "postgres",
      password: "postgres",
      port,
      persistent: false,
      // SQL_ASCII cluster encoding tolerates non-UTF8 bytes in installation paths on Windows;
      // every test database is created explicitly with ENCODING 'UTF8' from template0.
      initdbFlags: ["--encoding=SQL_ASCII", "--locale=C"],
    });
    await pg.initialise();
    await pg.start();
    databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
    teardown = async () => {
      try {
        await pg.stop();
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    };
    console.error(`[test-setup] embedded postgres started on port ${port}`);
  }
  process.env.TEST_DATABASE_URL = databaseUrl;

  const redisCandidate =
    process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  const redisOk = await probeRedis(redisCandidate);
  if (redisOk) {
    process.env.TEST_REDIS_URL = redisCandidate;
    console.error(`[test-setup] redis reachable at ${redisCandidate.replace(/\/\/.*@/, "//***@")}`);
  } else {
    delete process.env.TEST_REDIS_URL;
    console.error("[test-setup] redis not reachable — queue integration tests will be skipped");
  }

  return async () => {
    await teardown?.();
  };
}
