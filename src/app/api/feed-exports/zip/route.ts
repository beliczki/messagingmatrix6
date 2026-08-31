import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import JSZip from "jszip";
import { db } from "@/db";
import { clients, feedExports } from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { buildXlsxBuffer, deserializePayload } from "@/lib/feed-export";
import { feedExportFilename } from "@/lib/feed-filename";

// A split export writes one feed per platform in a single action. Handing the
// browser several downloads in a row gets throttled or prompted; one zip is a
// single user-visible artifact for a single user action.
const MAX_IDS = 10;

export const GET = withSession(async ({ req, claims }) => {
  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: "too_many_ids", reason: `at most ${MAX_IDS} exports per zip` },
      { status: 400 },
    );
  }

  const rows = await db
    .select()
    .from(feedExports)
    .where(
      and(eq(feedExports.clientId, claims.cid), inArray(feedExports.id, ids)),
    );
  // Every requested id must resolve inside this client, otherwise the zip would
  // quietly contain fewer feeds than asked for.
  if (rows.length !== ids.length) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [client] = await db
    .select({ key: clients.key })
    .from(clients)
    .where(eq(clients.id, claims.cid))
    .limit(1);
  const clientKey = client?.key ?? `client-${claims.cid}`;

  const zip = new JSZip();
  // Follow the requested order, not the database's: the caller lists the legs
  // in the order it showed them.
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const row = byId.get(id)!;
    const payload = deserializePayload(row.payloadJson);
    if (!payload) {
      return NextResponse.json(
        { error: "invalid_payload", reason: `export ${id} has no usable payload` },
        { status: 500 },
      );
    }
    zip.file(
      feedExportFilename(
        clientKey,
        row.product,
        row.platform,
        row.feedVersion,
        row.id,
      ),
      buildXlsxBuffer(payload),
    );
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const products = [...new Set(rows.map((r) => r.product))].join("-");
  const filename = `${clientKey}-${products}-feeds-${ids.join("-")}.zip`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "no-store",
    },
  });
});
