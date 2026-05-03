import { NextResponse, type NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, shareGalleries, uploadedFiles } from "@/db/schema";
import { readFileBytes, resolveStoragePath } from "@/lib/storage";

// Public file proxy used by the share viewer. The viewer is unauthenticated,
// so we cannot hit /api/files/{id}. Instead, we gate access on the file id
// being referenced in this specific share gallery's snapshot metadata. That
// keeps the file private to anyone who has the share link, without exposing
// other files in the client.

type Params = { id: string; fileId: string };

const ALLOWED_THUMB_WIDTHS = [80, 200, 400, 800];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { id, fileId } = await params;
  const share = db
    .select()
    .from(shareGalleries)
    .where(eq(shareGalleries.id, id))
    .get();
  if (!share || share.archivedAt !== null) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let referenced = false;
  if (share.metadata) {
    try {
      const meta = JSON.parse(share.metadata) as {
        files?: Array<{ id?: string }>;
      };
      referenced = (meta.files ?? []).some((f) => f?.id === fileId);
    } catch {
      // fall through to 404
    }
  }
  if (!referenced) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const file = db
    .select()
    .from(uploadedFiles)
    .where(eq(uploadedFiles.id, fileId))
    .get();
  if (!file || file.clientId !== share.clientId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const thumbRaw = url.searchParams.get("thumb");
  const wantThumb = thumbRaw !== null;
  const isImage = file.mimeType?.startsWith("image/") ?? false;

  if (wantThumb && isImage && file.mimeType !== "image/svg+xml") {
    const wRaw = Number(thumbRaw) || 200;
    const w =
      ALLOWED_THUMB_WIDTHS.find((n) => n >= wRaw) ??
      ALLOWED_THUMB_WIDTHS[ALLOWED_THUMB_WIDTHS.length - 1];
    const client = db
      .select({ key: clients.key })
      .from(clients)
      .where(eq(clients.id, file.clientId))
      .get();
    if (!client) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const ext = path.extname(file.storagePath) || ".jpg";
    const thumbRel = path.join(client.key, ".thumbs", `${file.id}-${w}${ext}`);
    const thumbAbs = resolveStoragePath(thumbRel);
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(thumbAbs);
    } catch {
      const src = await readFileBytes(file.storagePath);
      bytes = await sharp(src)
        .resize({ width: w, withoutEnlargement: true })
        .toBuffer();
      await fs.mkdir(path.dirname(thumbAbs), { recursive: true });
      await fs.writeFile(thumbAbs, bytes);
    }
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.mimeType ?? "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // Full-resolution serve (also used for video, SVG, non-image originals).
  let bytes: Buffer;
  try {
    bytes = await readFileBytes(file.storagePath);
  } catch {
    return NextResponse.json({ error: "storage_missing" }, { status: 410 });
  }
  db.update(shareGalleries)
    .set({ downloadCount: sql`${shareGalleries.downloadCount} + 1` })
    .where(eq(shareGalleries.id, id))
    .run();
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mimeType ?? "application/octet-stream",
      "Content-Length": String(file.sizeBytes ?? bytes.length),
      "Cache-Control": "public, max-age=86400",
    },
  });
}
