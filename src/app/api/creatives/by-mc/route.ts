import { NextResponse } from "next/server";
import { listCreativesByMc } from "@/lib/entities/creatives";
import { withSession } from "@/lib/scoped";

// Sibling creatives for a matrix cell: GET /api/creatives/by-mc?number=282&variant=a
// Returns the distinct sizes of the same-named creative (one row per stored
// file), so the nonDCO static-MC preview can offer a size switcher. Scoped to
// the session's client.
export const GET = withSession(async ({ req, claims }) => {
  const sp = new URL(req.url).searchParams;
  const number = Number(sp.get("number"));
  const variant = sp.get("variant") ?? "";
  if (!Number.isFinite(number) || !variant) {
    return NextResponse.json({ error: "number and variant required" }, { status: 400 });
  }
  const rows = await listCreativesByMc(claims.cid, number, variant);
  const sizes = rows
    .filter((r) => r.fileDimensions && r.fileName)
    .map((r) => ({
      dimensions: r.fileDimensions as string,
      fileName: r.fileName as string,
      type: r.type,
    }));
  return NextResponse.json({ sizes });
});
