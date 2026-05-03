import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, feedExports } from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import {
  buildXlsxBuffer,
  deserializePayload,
} from "@/lib/feed-export";

type Params = { id: string };

function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function loadRow(clientId: number, id: number) {
  return db
    .select()
    .from(feedExports)
    .where(and(eq(feedExports.clientId, clientId), eq(feedExports.id, id)))
    .get();
}

export const GET = withSession<Params>(({ req, claims, params }) => {
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const row = loadRow(claims.cid, id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const url = new URL(req.url);
  if (url.searchParams.get("download") === "1") {
    const payload = deserializePayload(row.payloadJson);
    if (!payload) {
      return NextResponse.json({ error: "invalid_payload" }, { status: 500 });
    }
    const buffer = buildXlsxBuffer(payload);
    const client = db
      .select()
      .from(clients)
      .where(eq(clients.id, claims.cid))
      .get();
    const clientKey = client?.key ?? `client-${claims.cid}`;
    const filename = `${clientKey}-${row.product}-feed-v${row.feedVersion}-${row.id}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  }

  const payload = deserializePayload(row.payloadJson);
  return NextResponse.json({
    feedExport: {
      id: row.id,
      product: row.product,
      feedVersion: row.feedVersion,
      exportedAt: row.exportedAt,
      exportedBy: row.exportedBy,
      uploadedToAdformAt: row.uploadedToAdformAt,
      uploadedBy: row.uploadedBy,
      defaultMessageId: row.defaultMessageId,
      defaultLabel: row.defaultLabel,
      rowCount: row.rowCount,
      notes: row.notes,
      payload,
    },
  });
});

export const DELETE = withSession<Params>(({ claims, params }) => {
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const row = loadRow(claims.cid, id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.uploadedToAdformAt) {
    return NextResponse.json(
      {
        error: "uploaded_immutable",
        reason: "exports already uploaded to AdForm cannot be deleted",
      },
      { status: 409 },
    );
  }
  db.delete(feedExports)
    .where(and(eq(feedExports.clientId, claims.cid), eq(feedExports.id, id)))
    .run();
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "feed_exports",
    entityId: id,
    action: "delete",
    before: {
      id: row.id,
      product: row.product,
      feedVersion: row.feedVersion,
    },
  });
  return NextResponse.json({ ok: true });
});
