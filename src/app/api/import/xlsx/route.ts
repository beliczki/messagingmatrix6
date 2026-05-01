import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import {
  importErsteXlsx,
  type ImportCounts,
  type ImportResult,
} from "@/lib/import-xlsx";

const MAX_BYTES = 50 * 1024 * 1024; // 50MB
const ALLOWED_EXT = /\.xlsx$/i;
const ALLOWED_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
  "",
]);

const ENTITY_TYPES: Array<keyof ImportCounts> = [
  "audiences",
  "topics",
  "messages",
  "creatives",
  "assets",
  "text_formatting",
  "reporting",
];

export const POST = withAdmin(async ({ req, claims }) => {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const wipeFirst = url.searchParams.get("wipe") !== "0";

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "multipart_required" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "file_too_large", maxBytes: MAX_BYTES },
      { status: 413 },
    );
  }
  const filename = (file as File).name ?? "upload.xlsx";
  const mime = (file as File).type ?? "";
  if (!ALLOWED_EXT.test(filename) && !ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: "not_xlsx" }, { status: 415 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let result: ImportResult;
  try {
    result = importErsteXlsx(buffer, {
      clientId: claims.cid,
      wipeFirst,
      dryRun,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "import_failed";
    return NextResponse.json({ error: "import_failed", detail: msg }, { status: 500 });
  }

  if (!dryRun) {
    for (const entity of ENTITY_TYPES) {
      const count = result.inserted[entity];
      if (count > 0) {
        writeAudit({
          clientId: claims.cid,
          userId: claims.sub,
          entityType: entity,
          entityId: `bulk:${claims.cid}`,
          action: "bulk_create",
          after: {
            inserted: count,
            skipped: result.skipped[entity],
            wipeFirst,
            source: filename,
          },
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    wipeFirst,
    filename,
    inserted: result.inserted,
    skipped: result.skipped,
    errors: result.errors,
  });
});
