import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { broadcast } from "@/lib/events";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "archive"
  | "restore"
  | "reveal"
  | "snapshot_restore"
  | "bulk_move"
  | "bulk_copy"
  | "bulk_create"
  | "bulk_update"
  | "bulk_upsert"
  | "bulk_delete"
  | "bulk_archive"
  | "bulk_restore";

export type AuditInput = {
  clientId: number;
  userId: string | null;
  entityType: string;
  entityId: string | number;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
};

export async function writeAudit(input: AuditInput): Promise<void> {
  await db.insert(auditLog).values({
    clientId: input.clientId,
    userId: input.userId,
    entityType: input.entityType,
    entityId: String(input.entityId),
    action: input.action,
    before: input.before === undefined ? null : JSON.stringify(input.before),
    after: input.after === undefined ? null : JSON.stringify(input.after),
  });
  broadcast(input.clientId, {
    entity: input.entityType,
    ids: [input.entityId],
    action: input.action,
    byUser: input.userId,
  });
}

export type AuditRow = typeof auditLog.$inferSelect;

/** Revision history for a single entity — newest first, capped at 100.
 *  Reads the `before`/`after` snapshots `writeAudit` already records on
 *  every change; no separate history store. */
export async function readEntityHistory(
  clientId: number,
  entityType: string,
  entityId: string | number,
): Promise<AuditRow[]> {
  return db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.clientId, clientId),
        eq(auditLog.entityType, entityType),
        eq(auditLog.entityId, String(entityId)),
      ),
    )
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(100);
}
