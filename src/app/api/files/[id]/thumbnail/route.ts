import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { getFile } from "@/lib/entities/files";
import { readFileBytes, resolveStoragePath } from "@/lib/storage";
import { withSession } from "@/lib/scoped";
import { getActiveClient } from "@/lib/active-client";

type Params = { id: string };

const ALLOWED_WIDTHS = [80, 200, 400, 800];
const ALLOWED_OUTPUT = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Spec §4.4 — on-the-fly resize cached under storage/{clientKey}/.thumbs/.
export const GET = withSession<Params>(async ({ req, claims, params }) => {
  const row = getFile(claims.cid, params.id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!row.mimeType?.startsWith("image/")) {
    return NextResponse.json({ error: "not_an_image" }, { status: 415 });
  }

  // SVG is already vector — serve the bytes verbatim, no resize.
  if (row.mimeType === "image/svg+xml") {
    const src = await readFileBytes(row.storagePath);
    return new NextResponse(new Uint8Array(src), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Length": String(src.length),
        "Cache-Control": "private, max-age=86400",
      },
    });
  }

  if (!ALLOWED_OUTPUT.has(row.mimeType)) {
    return NextResponse.json({ error: "not_an_image" }, { status: 415 });
  }

  const url = new URL(req.url);
  const wRaw = Number(url.searchParams.get("w") ?? "200");
  const w =
    ALLOWED_WIDTHS.find((n) => n >= wRaw) ??
    ALLOWED_WIDTHS[ALLOWED_WIDTHS.length - 1];

  const client = getActiveClient();
  const ext = path.extname(row.storagePath) || ".jpg";
  const thumbRel = path.join(
    client.key,
    ".thumbs",
    `${row.id}-${w}${ext}`,
  );
  const thumbAbs = resolveStoragePath(thumbRel);

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(thumbAbs);
  } catch {
    const src = await readFileBytes(row.storagePath);
    bytes = await sharp(src)
      .resize({ width: w, withoutEnlargement: true })
      .toBuffer();
    await fs.mkdir(path.dirname(thumbAbs), { recursive: true });
    await fs.writeFile(thumbAbs, bytes);
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=86400",
    },
  });
});
