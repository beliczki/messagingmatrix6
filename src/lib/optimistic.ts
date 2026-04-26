import { NextRequest, NextResponse } from "next/server";

// Spec §4 — write endpoints require If-Match: <version> header (or version in
// body); mismatch returns 409 with the current row + version.

export function readClientVersion(
  req: NextRequest,
  body: unknown,
): number | null {
  const header = req.headers.get("if-match");
  if (header) {
    const n = Number(header);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof body === "object" && body !== null && "version" in body) {
    const v = (body as { version?: unknown }).version;
    if (typeof v === "number") return v;
  }
  return null;
}

export function versionMismatch(currentRow: unknown, currentVersion: number) {
  return NextResponse.json(
    {
      error: "version_mismatch",
      currentVersion,
      currentRow,
    },
    { status: 409 },
  );
}

export function missingVersion() {
  return NextResponse.json(
    { error: "missing_version", hint: "Send If-Match: <version> header." },
    { status: 428 },
  );
}
