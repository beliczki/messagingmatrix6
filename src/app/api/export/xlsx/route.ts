import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { exportClientXlsx } from "@/lib/export-xlsx";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const GET = withSession(async ({ claims }) => {
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, claims.cid))
    .limit(1);
  const clientKey = client?.key ?? `client-${claims.cid}`;

  const { buffer } = await exportClientXlsx(claims.cid);
  const filename = `${clientKey}-${todayIso()}.xlsx`;

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
