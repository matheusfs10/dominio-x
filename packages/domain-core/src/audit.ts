import { and, desc, eq, lt } from "drizzle-orm";
import type { AuditAction } from "@dominio-x/contracts";
import { auditLogs, operationalEvents, type Db, type DbOrTx } from "@dominio-x/database";
import { decodeCursor, encodeCursor, type Page } from "@dominio-x/contracts";
import { z } from "zod";

export interface AuditActor {
  id: string | null;
  email: string | null;
  ipAddress?: string | null;
  requestId?: string | null;
}

export async function recordAudit(
  db: DbOrTx,
  input: {
    action: AuditAction;
    actor: AuditActor;
    targetType?: string;
    targetId?: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditLogs).values({
    action: input.action,
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    ipAddress: input.actor.ipAddress ?? null,
    requestId: input.actor.requestId ?? null,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    detailsJson: input.details ?? {},
  });
}

const auditCursorSchema = z.object({ createdAt: z.string(), id: z.string() });

export async function listAudit(
  db: Db,
  query: { limit: number; cursor?: string; action?: string; userId?: string },
): Promise<Page<typeof auditLogs.$inferSelect>> {
  const cursor = decodeCursor(query.cursor, auditCursorSchema);
  const conditions = [];
  if (query.action) conditions.push(eq(auditLogs.action, query.action));
  if (query.userId) conditions.push(eq(auditLogs.actorId, query.userId));
  if (cursor) conditions.push(lt(auditLogs.createdAt, new Date(cursor.createdAt)));
  const rows = await db
    .select()
    .from(auditLogs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(query.limit + 1);
  const items = rows.slice(0, query.limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

export async function recordOperationalEvent(
  db: DbOrTx,
  input: {
    level?: "error" | "warn" | "info";
    component: string;
    code: string;
    message: string;
    context?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(operationalEvents).values({
    level: input.level ?? "error",
    component: input.component,
    code: input.code,
    message: input.message.slice(0, 1000),
    contextJson: input.context ?? {},
  });
}
