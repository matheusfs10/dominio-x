import { and, eq, sql } from "drizzle-orm";
import { AppError, type ManualDisposition } from "@dominio-x/contracts";
import {
  domainBlacklist,
  domainDispositions,
  domainNotes,
  domainSummaries,
  domainTags,
  tags,
  type Db,
} from "@dominio-x/database";
import { recordAudit, type AuditActor } from "./audit.js";

function normalizeTagKey(tag: string): string {
  const key = tag
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!key) throw new AppError("VALIDATION_ERROR", "Invalid tag.");
  return key.slice(0, 64);
}

async function refreshTagKeys(db: Db, domainId: string): Promise<void> {
  await db
    .update(domainSummaries)
    .set({
      tagKeys: sql`coalesce((select array_agg(t.key order by t.key) from ${domainTags} dt join ${tags} t on t.id = dt.tag_id where dt.domain_id = ${domainId}), '{}'::text[])`,
      updatedAt: new Date(),
    })
    .where(eq(domainSummaries.domainId, domainId));
}

export async function addTag(
  db: Db,
  domainId: string,
  tag: string,
  actor: AuditActor,
): Promise<string> {
  const key = normalizeTagKey(tag);
  const [row] = await db
    .insert(tags)
    .values({ key, name: tag.trim(), createdBy: actor.id })
    .onConflictDoUpdate({ target: tags.key, set: { name: tags.name } })
    .returning();
  await db
    .insert(domainTags)
    .values({ domainId, tagId: row!.id, addedBy: actor.id, source: "manual" })
    .onConflictDoNothing();
  await refreshTagKeys(db, domainId);
  await recordAudit(db, {
    action: "domain.tag_added",
    actor,
    targetType: "domain",
    targetId: domainId,
    details: { tag: key },
  });
  return key;
}

export async function removeTag(
  db: Db,
  domainId: string,
  tag: string,
  actor: AuditActor,
): Promise<void> {
  const key = normalizeTagKey(tag);
  const row = await db.query.tags.findFirst({ where: eq(tags.key, key) });
  if (!row) return;
  await db
    .delete(domainTags)
    .where(and(eq(domainTags.domainId, domainId), eq(domainTags.tagId, row.id)));
  await refreshTagKeys(db, domainId);
  await recordAudit(db, {
    action: "domain.tag_removed",
    actor,
    targetType: "domain",
    targetId: domainId,
    details: { tag: key },
  });
}

export async function addNote(db: Db, domainId: string, body: string, actor: AuditActor) {
  const [note] = await db
    .insert(domainNotes)
    .values({ domainId, body: body.trim(), authorId: actor.id })
    .returning();
  await recordAudit(db, {
    action: "domain.note_added",
    actor,
    targetType: "domain",
    targetId: domainId,
    details: { noteId: note!.id },
  });
  return note!;
}

/** Additive manual disposition: history row + mirrored latest value. Rule results are untouched. */
export async function setManualDisposition(
  db: Db,
  domainId: string,
  disposition: ManualDisposition | null,
  note: string | undefined,
  actor: AuditActor,
) {
  const [row] = await db
    .insert(domainDispositions)
    .values({ domainId, disposition, note: note ?? null, setBy: actor.id })
    .returning();
  await db
    .update(domainSummaries)
    .set({ manualDisposition: disposition, updatedAt: new Date() })
    .where(eq(domainSummaries.domainId, domainId));
  await recordAudit(db, {
    action: "domain.manual_disposition",
    actor,
    targetType: "domain",
    targetId: domainId,
    details: { disposition, note: note ?? null },
  });
  return row!;
}

export async function listBlacklist(db: Db) {
  return db.select().from(domainBlacklist).orderBy(domainBlacklist.createdAt);
}

export async function addBlacklistEntry(
  db: Db,
  input: { pattern: string; reason: string },
  actor: AuditActor,
) {
  const pattern = input.pattern.trim().toLowerCase();
  if (!/^(\*[a-z0-9.-]+\*|\.?[a-z0-9.-]+)$/.test(pattern))
    throw new AppError(
      "VALIDATION_ERROR",
      "Pattern must be an exact fqdn, a .suffix or *substring*.",
    );
  const [row] = await db
    .insert(domainBlacklist)
    .values({ pattern, reason: input.reason, createdBy: actor.id })
    .onConflictDoUpdate({ target: domainBlacklist.pattern, set: { reason: input.reason } })
    .returning();
  await recordAudit(db, {
    action: "settings.updated",
    actor,
    targetType: "blacklist",
    targetId: row!.id,
    details: { pattern },
  });
  return row!;
}

export async function removeBlacklistEntry(db: Db, id: string, actor: AuditActor): Promise<void> {
  await db.delete(domainBlacklist).where(eq(domainBlacklist.id, id));
  await recordAudit(db, {
    action: "settings.updated",
    actor,
    targetType: "blacklist",
    targetId: id,
    details: { removed: true },
  });
}
