import { NextResponse } from "next/server";
import sharp from "sharp";
import { uploadFile } from "@/lib/entities/files";
import { writeAudit } from "@/lib/audit";
import {
  HTML5_PACKAGE_MIME,
  Html5PackageError,
  inspectHtml5Package,
  isHtml5PackageUpload,
} from "@/lib/html5-package";
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
  let mimeType = (file as File).type || "application/octet-stream";

  let dimensions: string | undefined;
  // An HTML5 package is validated before anything is stored: a zip with no
  // index.html, or one that climbs out of its folder, is refused here instead
  // of landing in the library as a creative nothing can play.
  let pkg: { sizeSource: string | null; warnings: string[] } | undefined;
  if (category === "creative" && isHtml5PackageUpload(originalFilename, mimeType)) {
    try {
      const info = await inspectHtml5Package(buffer, originalFilename);
      mimeType = HTML5_PACKAGE_MIME;
      if (info.width && info.height) dimensions = `${info.width}x${info.height}`;
      pkg = { sizeSource: info.sizeSource, warnings: info.warnings };
    } catch (e) {
      if (!(e instanceof Html5PackageError)) throw e;
      return NextResponse.json(
        { error: "invalid_html5_package", code: e.code, message: e.message },
        { status: 400 },
      );
    }
  } else if (mimeType.startsWith("image/")) {
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

  return NextResponse.json({ file: row, package: pkg }, { status: 201 });
});
