import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, messages, shareGalleries, users } from "@/db/schema";

// Public change history for ONE item of a share. Same door as the comments
// route — the share link is the credential — with two things it does not need:
//
//  1. The item must be IN this share. The itemKey is turned into entities only
//     after it is found in the share's own snapshot, so the route can never be
//     used to read the audit log of an entity the share does not contain.
//  2. What comes back is trimmed to what a reviewer needs: when, what happened,
//     which fields moved, and WHO as a display name. Audit rows carry whole
//     entity snapshots and account e-mails; neither belongs on a public page.
//
// A shared item has two lives, and they are logged separately: the CARD (the
// messaging card and the draft it came from — one `messages` row per cell, all
// of them the same card) and the FILE (the delivered creative). "The creative
// was replaced yesterday" and "the copy changed last week" are different
// answers, so they come back as separate sections rather than interleaved.

type Params = { id: string };

// A reviewer reads the recent story of a card, not its whole life.
const LIMIT = 50;

// One card can exist as many rows; a share cannot reasonably need more than
// this, and the cap keeps an unbounded IN list out of the query.
const MAX_IDS = 100;

// Bookkeeping columns move on every write and would drown the fields a person
// actually changed.
const IGNORED_FIELDS = new Set(["updatedAt", "createdAt", "id", "clientId"]);
const MAX_FIELDS = 6;

type Target = {
  key: "creative" | "card" | "creatives";
  label: string;
  entityType: string;
  entityIds: string[];
};

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

  const targets = await resolveTargets(share.clientId, share.metadata, itemKey);
  if (targets === null) {
    return NextResponse.json({ error: "not_in_share" }, { status: 404 });
  }

  const sections = [];
  for (const t of targets) {
    if (t.entityIds.length === 0) continue;
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
          eq(auditLog.entityType, t.entityType),
          inArray(auditLog.entityId, t.entityIds),
        ),
      )
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(LIMIT);

    const names = await displayNames(
      share.clientId,
      rows.map((r) => r.userId),
    );

    sections.push({
      key: t.key,
      label: t.label,
      entries: rows.map((r) => ({
        id: r.id,
        action: r.action,
        at: r.createdAt,
        by: r.userId ? (names.get(r.userId) ?? "someone") : "system",
        fields: changedFields(r.before, r.after),
      })),
    });
  }

  return NextResponse.json({ sections });
}

type Snapshot = {
  creatives?: {
    id?: unknown;
    fileName?: unknown;
    mcNumber?: unknown;
    mcVariant?: unknown;
  }[];
  matrixItems?: { messageId?: unknown }[];
  messages?: { id?: unknown; number?: unknown; variant?: unknown }[];
};

/**
 * The share's own snapshot decides what the item key may point at — and what
 * else may come with it. A creative that is in the share brings its card, and
 * a shared cell brings the creatives of that card THAT THE SHARE HOLDS; nothing
 * is reachable that the viewer could not already see.
 *
 * null means "not in this share", which the caller turns into a 404.
 */
async function resolveTargets(
  clientId: number,
  metadata: string | null,
  itemKey: string,
): Promise<Target[] | null> {
  if (!metadata || !itemKey) return null;
  let snap: Snapshot;
  try {
    snap = JSON.parse(metadata) as Snapshot;
  } catch {
    return null;
  }

  const creative = itemKey.match(/^creative:(\d+)$/);
  if (creative) {
    const wanted = Number(creative[1]);
    const row = (snap.creatives ?? []).find((c) => c.id === wanted);
    if (!row) return null;
    const targets: Target[] = [
      {
        key: "creative",
        label: "Creative file",
        entityType: "creatives",
        entityIds: [String(wanted)],
      },
    ];
    const mc = mcOf(row.mcNumber, row.mcVariant);
    if (mc) {
      targets.push({
        key: "card",
        label: `Card · MC${mc.number}${mc.variant}`,
        entityType: "messages",
        entityIds: await cardMessageIds(clientId, mc),
      });
    }
    return targets;
  }

  // matrix:<messageId>:<size> — the history belongs to the card, not to the
  // size it is being viewed at.
  const matrix = itemKey.match(/^matrix:(\d+):/);
  if (matrix) {
    const wanted = Number(matrix[1]);
    if (!(snap.matrixItems ?? []).some((m) => m.messageId === wanted)) {
      return null;
    }
    const row = (snap.messages ?? []).find((m) => m.id === wanted);
    const mc = mcOf(row?.number, row?.variant);

    const targets: Target[] = [
      {
        key: "card",
        label: mc ? `Card · MC${mc.number}${mc.variant}` : "Card",
        entityType: "messages",
        // The whole card when its number is known (its cells are one card),
        // the opened row alone when the snapshot did not capture the number.
        entityIds: mc
          ? await cardMessageIds(clientId, mc)
          : [String(wanted)],
      },
    ];

    if (mc) {
      const files = (snap.creatives ?? [])
        .filter((c) => {
          const m = mcOf(c.mcNumber, c.mcVariant);
          return m && m.number === mc.number && m.variant === mc.variant;
        })
        .map((c) => String(c.id))
        .slice(0, MAX_IDS);
      if (files.length > 0) {
        targets.push({
          key: "creatives",
          label: `Creative files · ${files.length}`,
          entityType: "creatives",
          entityIds: files,
        });
      }
    }
    return targets;
  }

  return null;
}

function mcOf(
  number: unknown,
  variant: unknown,
): { number: number; variant: string } | null {
  if (typeof number !== "number") return null;
  return { number, variant: typeof variant === "string" ? variant : "" };
}

/** Every row of one card. A card is one MC, spread over a row per cell plus the
 *  draft it was promoted from, and its story is the union of those rows. */
async function cardMessageIds(
  clientId: number,
  mc: { number: number; variant: string },
): Promise<string[]> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        eq(messages.number, mc.number),
        eq(messages.variant, mc.variant),
      ),
    )
    .limit(MAX_IDS);
  return rows.map((r) => String(r.id));
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
