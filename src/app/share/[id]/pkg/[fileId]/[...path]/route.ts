import { NextResponse, type NextRequest } from "next/server";
import { loadSharedFile } from "@/lib/share-file";
import { packageEntryResponse } from "@/lib/html5-package-response";

// An HTML5 package's entries for the public share viewer. Gated like the
// share's other files — the package must be in this share's snapshot — so
// archiving the share revokes it, which a signed /pkg link would not.

type Params = { id: string; fileId: string; path: string[] };

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const { id, fileId, path } = await ctx.params;
  const shared = await loadSharedFile(id, fileId);
  if (!shared) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Short: the share can be archived, and the entries should stop with it.
  return packageEntryResponse({
    clientKey: shared.clientKey,
    file: shared.file,
    relPath: path.join("/"),
    cacheControl: "public, max-age=300",
  });
}
