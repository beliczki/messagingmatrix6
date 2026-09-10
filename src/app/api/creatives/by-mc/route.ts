import { NextResponse } from "next/server";
import {
  listCreativeMatchesForMcs,
  listCreativesByMc,
} from "@/lib/entities/creatives";
import { withSession } from "@/lib/scoped";

// Sibling creatives for a matrix cell: GET /api/creatives/by-mc?number=282&variant=a
// Returns the distinct sizes of the same-named creative (one row per stored
// file), so the Agentic static-MC preview can offer a size switcher. Scoped to
// the session's client.
//
// `sizes` is left exactly as it was — its one consumer maps a dimension to a
// filename for the size switcher, and widening it would change a surface
// nobody asked about. `match` is the sibling answer: every delivered file,
// videos included (they have no measured size, so `sizes` never saw them), with
// the fileId a thumbnail needs.
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
  const matches = await listCreativeMatchesForMcs(claims.cid, [
    { number, variant },
  ]);
  const match = matches.get(`${number}|${variant}`) ?? {
    total: 0,
    videoCount: 0,
    cover: null,
    items: [],
  };
  return NextResponse.json({ sizes, match });
});
