import { NextResponse } from "next/server";
import sharp from "sharp";
import { uploadFile } from "@/lib/entities/files";
import { writeAudit } from "@/lib/audit";
import { denyDemo, withSession } from "@/lib/scoped";
import type { StorageCategory } from "@/lib/storage";

const ALLOWED_CATEGORIES: StorageCategory[] = [
  "asset",
  "creative",
  "template-file",
  "share-file",
];

const MAX_BYTES = 50 * 1024 * 1024; // 50MB

export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;

  const form = await req.formData();
  const file = form.get("file");
  const categoryRaw = form.get("category");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  const category =
    typeof categoryRaw === "string" &&
    (ALLOWED_CATEGORIES as string[]).includes(categoryRaw)
      ? (categoryRaw as StorageCategory)
      : null;
  if (!category) {
    return NextResponse.json({ error: "bad_category" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "file_too_large", maxBytes: MAX_BYTES },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const originalFilename =
    (file as File).name ?? form.get("filename")?.toString() ?? "unnamed";
  const mimeType = (file as File).type || "application/octet-stream";

  let dimensions: string | undefined;
  if (mimeType.startsWith("image/")) {
    try {
      const meta = await sharp(buffer).metadata();
      if (meta.width && meta.height) {
        dimensions = `${meta.width}x${meta.height}`;
      }
    } catch {
      // Non-image or corrupt image — leave dimensions undefined.
    }
  }

  const row = await uploadFile(claims.cid, {
    buffer,
    originalFilename,
    mimeType,
    category,
    uploadedBy: claims.sub,
    dimensions,
  });

  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "uploaded_files",
    entityId: row.id,
    action: "create",
    after: {
      id: row.id,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      category: row.category,
    },
  });

  return NextResponse.json({ file: row }, { status: 201 });
});
