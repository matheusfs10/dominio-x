/**
 * Secure CLI to create (or reset) an admin user without environment variables.
 *
 *   pnpm admin:create --email admin@example.com            (password prompted, hidden)
 *   ADMIN_PASSWORD=... pnpm admin:create --email admin@example.com --yes
 */
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { loadDatabaseConfig } from "@dominio-x/config";
import { createDatabase } from "./client.js";
import { hashPassword, validatePasswordStrength } from "./password.js";
import { users } from "./schema/index.js";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx === -1 ? undefined : process.argv[idx + 1];
}

async function promptHidden(question: string): Promise<string> {
  if (!stdin.isTTY)
    throw new Error("No TTY available; pass ADMIN_PASSWORD via environment instead.");
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const mute = { muted: false };
  const originalWrite = stdout.write.bind(stdout);
  (stdout as unknown as { write: typeof stdout.write }).write = (
    chunk: string | Uint8Array,
    ...rest: unknown[]
  ) => {
    if (mute.muted) return true;
    return (originalWrite as unknown as (c: string | Uint8Array, ...r: unknown[]) => boolean)(
      chunk,
      ...rest,
    );
  };
  try {
    stdout.write(question);
    mute.muted = true;
    const answer = await rl.question("");
    mute.muted = false;
    stdout.write("\n");
    return answer;
  } finally {
    mute.muted = false;
    (stdout as unknown as { write: typeof stdout.write }).write = originalWrite;
    rl.close();
  }
}

async function main() {
  const email = (arg("email") ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!email || !email.includes("@"))
    throw new Error("Usage: admin:create --email <email> [--name <name>] [--yes]");
  const name = arg("name") ?? "Administrator";
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await promptHidden("Admin password (min 12 chars, hidden): ");
    const confirm = await promptHidden("Confirm password: ");
    if (password !== confirm) throw new Error("Passwords do not match.");
  }
  const weakness = validatePasswordStrength(password);
  if (weakness) throw new Error(weakness);

  const config = loadDatabaseConfig();
  const handle = createDatabase({
    url: config.DATABASE_URL,
    max: 1,
    applicationName: "dominio-x-admin-create",
  });
  try {
    const existing = await handle.db.query.users.findFirst({ where: eq(users.email, email) });
    const passwordHash = await hashPassword(password);
    if (existing) {
      if (!process.argv.includes("--yes")) {
        throw new Error(
          `User ${email} already exists. Re-run with --yes to reset its password and promote to admin.`,
        );
      }
      await handle.db
        .update(users)
        .set({ passwordHash, role: "admin", active: true, updatedAt: new Date() })
        .where(eq(users.id, existing.id));
      console.error(`[admin:create] password reset and role=admin for ${email}`);
    } else {
      await handle.db.insert(users).values({ email, name, role: "admin", passwordHash });
      console.error(`[admin:create] admin created: ${email}`);
    }
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error("[admin:create] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
