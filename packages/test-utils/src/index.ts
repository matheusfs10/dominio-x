import { randomBytes } from "node:crypto";
import postgres from "postgres";
import {
  createDatabase,
  runMigrations,
  seedDatabase,
  type DatabaseHandle,
} from "@dominio-x/database";
import { MemoryObjectStorage } from "@dominio-x/storage";

export interface TestDatabase extends DatabaseHandle {
  url: string;
  name: string;
  destroy(): Promise<void>;
}

function adminUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (global setup did not run?)");
  return url;
}

/**
 * Creates an isolated database (fresh schema via migrations) for one test file.
 */
export async function createTestDatabase(options: { seed?: boolean } = {}): Promise<TestDatabase> {
  const base = new URL(adminUrl());
  const name = `dx_test_${randomBytes(6).toString("hex")}`;
  const admin = postgres(base.toString(), { max: 1, onnotice: () => undefined });
  await admin.unsafe(
    `CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`,
  );
  await admin.end();

  const url = new URL(base.toString());
  url.pathname = `/${name}`;
  const handle = createDatabase({ url: url.toString(), max: 5, applicationName: "dominio-x-test" });
  await runMigrations(handle.db);
  if (options.seed !== false) {
    await seedDatabase(handle.db, { dev: false, bootstrapAdmin: null });
  }
  return {
    ...handle,
    url: url.toString(),
    name,
    async destroy() {
      await handle.close();
      const drop = postgres(base.toString(), { max: 1, onnotice: () => undefined });
      try {
        await drop.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await drop.end();
      }
    },
  };
}

export function testRedisUrl(): string | null {
  return process.env.TEST_REDIS_URL ?? null;
}

export function createTestStorage(): MemoryObjectStorage {
  return new MemoryObjectStorage();
}

export const TEST_SECRET = "test-secret-value-with-at-least-32-characters-0123456789";
export const TEST_MACHINE_TOKEN = "test-machine-token-with-at-least-32-characters-abcdef";
