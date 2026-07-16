import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { exportMatrixXlsx } from "@/lib/export-xlsx";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Filtered matrix export: per-product matrix tabs + Audiences/Topics/MCs
// sheets, scoped by comma-joined ?products= and ?statuses= (absent = all).
export const GET = withSession(async ({ req, claims }) => {
  const parseList = (key: string) =>
    (req.nextUrl.searchParams.get(key) ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, claims.cid))
    .limit(1);
  const clientKey = client?.key ?? `client-${claims.cid}`;

  const buffer = await exportMatrixXlsx(claims.cid, {
    products: parseList("products"),
    statuses: parseList("statuses"),
  });
  const filename = `${clientKey}-matrix-${todayIso()}.xlsx`;

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
});
