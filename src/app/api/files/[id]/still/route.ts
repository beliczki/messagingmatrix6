import { NextResponse } from "next/server";
import { getFile } from "@/lib/entities/files";
import { withSession } from "@/lib/scoped";
import { getActiveClient } from "@/lib/active-client";
import {
  StillsUnavailableError,
  ensureStills,
  normalizeStillWidth,
  readStillResized,
} from "@/lib/video-stills";

type Params = { id: string };

// The still strip behind the Creative Library's hover scrub.
//   GET /api/files/{id}/still        → manifest { count, intervalSec, durationSec }
//   GET /api/files/{id}/still?i=3&w=400 → the 4th still as a JPEG
// Both generate the strip on a cache miss, which is why the caller shows a
// "processing" state until the first response lands.
export const GET = withSession<Params>(async ({ req, claims, params }) => {
  const row = await getFile(claims.cid, params.id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!row.mimeType?.startsWith("video/")) {
    return NextResponse.json({ error: "not_a_video" }, { status: 415 });
  }

  const url = new URL(req.url);
  const iRaw = url.searchParams.get("i");
  const client = await getActiveClient();

  try {
    if (iRaw === null) {
      const manifest = await ensureStills(client.key, row.id, row.storagePath);
      // The manifest is the one thing that CANNOT be versioned in its own URL —
      // it is what announces the version. Cached for a day it would keep a
      // browser on a strip shape that no longer exists: after the end-frame
      // change, a browser holding the old `count: 2` drew two scrub zones and
      // could never reach the closing frame, with nothing on screen to explain
      // why. It revalidates instead; it is a few dozen bytes.
      return NextResponse.json(manifest, {
        headers: { "Cache-Control": "private, no-cache" },
      });
    }

    const index = Number(iRaw);
    if (!Number.isInteger(index) || index < 0) {
      return NextResponse.json({ error: "bad_index" }, { status: 400 });
    }
    const w = normalizeStillWidth(Number(url.searchParams.get("w") ?? "400"));
    const bytes = await readStillResized(
      client.key,
      row.id,
      row.storagePath,
      index,
      w,
    );
    if (!bytes) return NextResponse.json({ error: "not_found" }, { status: 404 });
    // Safe to cache hard: the caller carries the strip's version in the query
    // (`&v=`), so a regenerated strip is a different URL rather than a stale hit.
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (e) {
    if (e instanceof StillsUnavailableError) {
      return NextResponse.json(
        { error: "still_unavailable", reason: e.message },
        { status: 503 },
      );
    }
    throw e;
  }
});
