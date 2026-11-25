// Set the MC's VERSION (`version_no`, the PMMID's -n_ token; REBUILD_SPEC §21)
// by hand. Its own endpoint, not a PATCH field: the PATCH contract is that the
// PMMID is never rewritten, and a writable versionNo would let a History
// restore silently take the card back to an older version.
//
// Body: { versionNo: integer ≥ 1, scope: "local" | "global" }. No default
// scope: Global reaches every audience copy of the card, and that has to be
// said, not assumed. If-Match carries the save counter (`version`).
import { NextResponse } from "next/server";
import {
  MessageError,
  setMessageVersionNo,
  type VersionScope,
} from "@/lib/entities/messages";
import { denyDemo, withSession } from "@/lib/scoped";
import {
  missingVersion,
  readClientVersion,
  versionMismatch,
} from "@/lib/optimistic";

type Params = { id: string };

function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function readScope(v: unknown): VersionScope | null {
  return v === "local" || v === "global" ? v : null;
}

export const POST = withSession<Params>(async ({ req, claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as {
    versionNo?: unknown;
    scope?: unknown;
  } | null;
  // The body's own `version` is not read as If-Match here: in this body the
  // word would be ambiguous next to versionNo, so the header is the only way.
  const expected = readClientVersion(req, null);
  if (expected === null) return missingVersion();
  const scope = readScope(body?.scope);
  if (!scope) {
    return NextResponse.json(
      { error: "bad_scope", reason: 'scope must be "local" or "global"' },
      { status: 400 },
    );
  }
  const versionNo = body?.versionNo;
  if (typeof versionNo !== "number") {
    return NextResponse.json(
      { error: "bad_version_no", reason: "versionNo must be a whole number, 1 or more" },
      { status: 400 },
    );
  }

  let result: Awaited<ReturnType<typeof setMessageVersionNo>>;
  try {
    result = await setMessageVersionNo(
      claims.cid,
      id,
      expected,
      versionNo,
      scope,
      claims.sub,
    );
  } catch (e) {
    if (e instanceof MessageError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return versionMismatch(result.current, result.current.version);
  }
  return NextResponse.json({
    message: result.row,
    siblings: result.siblings,
    changed: result.changedIds.length,
  });
});
