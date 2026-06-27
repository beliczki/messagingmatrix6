import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { shareComments, shareGalleries } from "@/db/schema";

// Public comment API for the share viewer. No auth — anyone with the share
// link can post or read comments. To keep abuse manageable we cap body
// length and trim author name; rate-limiting is out of scope for this v1.

type Params = { id: string };

const MAX_NAME = 80;
const MAX_BODY = 2000;

async function findShare(shareId: string) {
  const [share] = await db
    .select()
    .from(shareGalleries)
    .where(eq(shareGalleries.id, shareId))
    .limit(1);
  if (!share || share.archivedAt !== null) return null;
  return share;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { id } = await params;
  const share = await findShare(id);
  if (!share) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const rows = await db
    .select()
    .from(shareComments)
    .where(
      and(
        eq(shareComments.shareGalleryId, id),
        isNull(shareComments.archivedAt),
      ),
    )
    .orderBy(shareComments.createdAt);
  return NextResponse.json({ comments: rows });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { id } = await params;
  const share = await findShare(id);
  if (!share) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as
    | {
        itemKey?: unknown;
        authorName?: unknown;
        body?: unknown;
        annotation?: unknown;
      }
    | null;
  const itemKey =
    typeof body?.itemKey === "string" && body.itemKey.length > 0
      ? body.itemKey
      : null;
  const authorName =
    typeof body?.authorName === "string"
      ? body.authorName.trim().slice(0, MAX_NAME)
      : "";
  const text =
    typeof body?.body === "string" ? body.body.trim().slice(0, MAX_BODY) : "";
  if (!itemKey) {
    return NextResponse.json({ error: "itemKey required" }, { status: 400 });
  }
  if (!authorName) {
    return NextResponse.json({ error: "authorName required" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }
  const annotation = parseAnnotation(body?.annotation);
  const [inserted] = await db
    .insert(shareComments)
    .values({
      id: nanoid(12),
      shareGalleryId: id,
      itemKey,
      authorName,
      body: text,
      annotation: annotation ? JSON.stringify(annotation) : null,
    })
    .returning();
  return NextResponse.json({ comment: inserted }, { status: 201 });
}

function inUnit(n: unknown): number | null {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (v < 0 || v > 1) return null;
  return v;
}

function parseAnnotation(
  raw: unknown,
):
  | { type: "point"; x: number; y: number }
  | { type: "rect"; x: number; y: number; w: number; h: number }
  | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.type === "point") {
    const x = inUnit(o.x);
    const y = inUnit(o.y);
    if (x === null || y === null) return null;
    return { type: "point", x, y };
  }
  if (o.type === "rect") {
    const x = inUnit(o.x);
    const y = inUnit(o.y);
    const w = inUnit(o.w);
    const h = inUnit(o.h);
    if (x === null || y === null || w === null || h === null) return null;
    if (w <= 0 || h <= 0) return null;
    return { type: "rect", x, y, w, h };
  }
  return null;
}
