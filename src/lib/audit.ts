import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { broadcast } from "@/lib/events";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "archive"
  | "restore"
  | "snapshot_restore"
  | "bulk_move"
  | "bulk_copy"
  | "bulk_create"
  | "bulk_update"
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

export function writeAudit(input: AuditInput): void {
  db.insert(auditLog)
    .values({
      clientId: input.clientId,
      userId: input.userId,
      entityType: input.entityType,
      entityId: String(input.entityId),
      action: input.action,
      before: input.before === undefined ? null : JSON.stringify(input.before),
      after: input.after === undefined ? null : JSON.stringify(input.after),
    })
    .run();
  broadcast(input.clientId, {
    entity: input.entityType,
    ids: [input.entityId],
    action: input.action,
    byUser: input.userId,
  });
}
