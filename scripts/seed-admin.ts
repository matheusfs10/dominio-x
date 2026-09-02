/**
 * Convenience wrapper: `pnpm tsx scripts/seed-admin.ts --email admin@example.com`
 * Delegates to the secure admin bootstrap CLI in @dominio-x/database.
 */
await import("../packages/database/src/admin-create.ts");
