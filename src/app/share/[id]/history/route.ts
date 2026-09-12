import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, shareGalleries, users } from "@/db/schema";

// Public change history for ONE item of a share. Same door as the comments
// route — the share link is the credential — with two things it does not need:
//
//  1. The item must be IN this share. The itemKey is turned into an entity only
//     after it is found in the share's own snapshot, so the route can never be
//     used to read the audit log of an entity the share does not contain.
//  2. What comes back is trimmed to what a reviewer needs: when, what happened,
//     which fields moved, and WHO as a display name. Audit rows carry whole
//     entity snapshots and account e-mails; neither belongs on a public page.

type Params = { id: string };

// A reviewer reads the recent story of a card, not its whole life.
const LIMIT = 50;

// Bookkeeping columns move on every write and would drown the fields a person
// actually changed.
const IGNORED_FIELDS = new Set(["updatedAt", "createdAt", "id", "clientId"]);
const MAX_FIELDS = 6;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { id } = await params;
  const itemKey = new URL(req.url).searchParams.get("itemKey") ?? "";

  const [share] = await db
    .select()
    .from(shareGalleries)
    .where(eq(shareGalleries.id, id))
    .limit(1);
  if (!share || share.archivedAt !== null) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const entity = resolveItem(share.metadata, itemKey);
  if (!entity) {
    return NextResponse.json({ error: "not_in_share" }, { status: 404 });
  }

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      userId: auditLog.userId,
      before: auditLog.before,
      after: auditLog.after,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.clientId, share.clientId),
        eq(auditLog.entityType, entity.entityType),
        eq(auditLog.entityId, entity.entityId),
      ),
    )
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(LIMIT);

  const names = await displayNames(
    share.clientId,
    rows.map((r) => r.userId),
  );

  return NextResponse.json({
    entries: rows.map((r) => ({
      id: r.id,
      action: r.action,
      at: r.createdAt,
      by: r.userId ? (names.get(r.userId) ?? "someone") : "system",
      fields: changedFields(r.before, r.after),
    })),
  });
}

/** The share's own snapshot decides what the item key may point at. */
function resolveItem(
  metadata: string | null,
  itemKey: string,
): { entityType: string; entityId: string } | null {
  if (!metadata || !itemKey) return null;
  let snap: {
    creatives?: { id?: unknown }[];
    matrixItems?: { messageId?: unknown }[];
  };
  try {
    snap = JSON.parse(metadata) as typeof snap;
  } catch {
    return null;
  }

  const creative = itemKey.match(/^creative:(\d+)$/);
  if (creative) {
    const wanted = Number(creative[1]);
    const held = (snap.creatives ?? []).some((c) => c.id === wanted);
    return held ? { entityType: "creatives", entityId: String(wanted) } : null;
  }

  // matrix:<messageId>:<size> — the history belongs to the card, not to the
  // size it is being viewed at.
  const matrix = itemKey.match(/^matrix:(\d+):/);
  if (matrix) {
    const wanted = Number(matrix[1]);
    const held = (snap.matrixItems ?? []).some((m) => m.messageId === wanted);
    return held ? { entityType: "messages", entityId: String(wanted) } : null;
  }

  return null;
}

/** userId -> the part of the account e-mail before the @. A public page names
 *  who changed something without handing out addresses. */
async function displayNames(clientId: number, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((v): v is string => v !== null))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.clientId, clientId), inArray(users.id, wanted)));
  for (const r of rows) out.set(r.id, r.email.split("@")[0]!);
  return out;
}

function parse(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Field NAMES only — never their values. A creative's history says "status,
 *  driveFileId changed", not what they changed to. */
function changedFields(before: string | null, after: string | null): string[] {
  const a = parse(before);
  const b = parse(after);
  if (!a || !b) return [];
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (IGNORED_FIELDS.has(k)) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  }
  return out.slice(0, MAX_FIELDS);
}
