import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { AppError, type UserRole } from "@dominio-x/contracts";
import {
  hashPassword,
  sessions,
  users,
  validatePasswordStrength,
  verifyPassword,
  type Db,
  type DbOrTx,
  type User,
} from "@dominio-x/database";
import { recordAudit } from "./audit.js";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Pre-computed hash used to equalize timing when the account does not exist. */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHashPromise;
}

export async function login(
  db: Db,
  input: {
    email: string;
    password: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    ttlHours: number;
    requestId?: string | null;
  },
): Promise<{ user: SessionUser; token: string; expiresAt: Date }> {
  const email = input.email.trim().toLowerCase();
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  const ok = user
    ? await verifyPassword(user.passwordHash, input.password)
    : (await verifyPassword(await dummyHash(), input.password), false);
  if (!user || !ok || !user.active) {
    await recordAudit(db, {
      action: "auth.login_failed",
      actor: { id: null, email, ipAddress: input.ipAddress, requestId: input.requestId },
      details: { reason: !user ? "unknown_user" : !user.active ? "inactive" : "bad_password" },
    });
    throw new AppError("UNAUTHORIZED", "Invalid email or password.");
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + input.ttlHours * 3600 * 1000);
  await db
    .insert(sessions)
    .values({
      id: hashToken(token),
      userId: user.id,
      expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
    });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await recordAudit(db, {
    action: "auth.login",
    actor: {
      id: user.id,
      email: user.email,
      ipAddress: input.ipAddress,
      requestId: input.requestId,
    },
  });
  return { user: toSessionUser(user), token, expiresAt };
}

export function toSessionUser(user: User): SessionUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function resolveSession(
  db: DbOrTx,
  token: string | undefined,
): Promise<{ user: SessionUser; expiresAt: Date } | null> {
  if (!token || token.length < 16 || token.length > 128) return null;
  const id = hashToken(token);
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()), eq(users.active, true)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - row.session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
  }
  return { user: toSessionUser(row.user), expiresAt: row.session.expiresAt };
}

export async function logout(
  db: Db,
  token: string | undefined,
  actor: { id: string; email: string; ipAddress?: string | null; requestId?: string | null },
): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  await recordAudit(db, { action: "auth.logout", actor });
}

export async function deleteExpiredSessions(db: DbOrTx): Promise<number> {
  const rows = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  return rows.length;
}

export async function createUser(
  db: Db,
  input: { email: string; name: string; password: string; role: UserRole },
  actor: { id: string; email: string },
): Promise<SessionUser> {
  const weakness = validatePasswordStrength(input.password);
  if (weakness) throw new AppError("VALIDATION_ERROR", weakness);
  const email = input.email.trim().toLowerCase();
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) throw new AppError("CONFLICT", "A user with this email already exists.");
  const [user] = await db
    .insert(users)
    .values({
      email,
      name: input.name,
      role: input.role,
      passwordHash: await hashPassword(input.password),
    })
    .returning();
  await recordAudit(db, {
    action: "user.created",
    actor,
    targetType: "user",
    targetId: user!.id,
    details: { role: input.role },
  });
  return toSessionUser(user!);
}

export async function listUsers(
  db: Db,
): Promise<(SessionUser & { active: boolean; lastLoginAt: Date | null; createdAt: Date })[]> {
  const rows = await db.select().from(users).orderBy(users.createdAt);
  return rows.map((u) => ({
    ...toSessionUser(u),
    active: u.active,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  }));
}

export async function updateUser(
  db: Db,
  id: string,
  patch: { role?: UserRole; active?: boolean; name?: string },
  actor: { id: string; email: string },
): Promise<void> {
  if (patch.active === false && id === actor.id)
    throw new AppError("CONFLICT", "You cannot deactivate yourself.");
  await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, id));
  if (patch.active === false) await db.delete(sessions).where(eq(sessions.userId, id));
  await recordAudit(db, {
    action: "user.updated",
    actor,
    targetType: "user",
    targetId: id,
    details: patch,
  });
}

export const ROLE_RANK: Record<UserRole, number> = { viewer: 0, analyst: 1, admin: 2 };
export function hasRole(user: SessionUser, minimum: UserRole): boolean {
  return ROLE_RANK[user.role] >= ROLE_RANK[minimum];
}
