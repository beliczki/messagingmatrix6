import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { uploadedFiles } from "@/db/schema";
import { getActiveClient } from "@/lib/active-client";
import { verifyPackageToken } from "@/lib/public-shortcut";
import { packageEntryResponse } from "@/lib/html5-package-response";

// An HTML5 package's entries for the signed-in app (Creative Library, drafts,
// the matrix). Not session-gated on purpose: the package runs sandboxed, and a
// sandboxed document's own asset requests carry no cookie — the signed token in
// the path is the capability instead (see signPackageToken). Links are handed
// out only by /api/files/package-url, behind the session.

type Params = { token: string; path: string[] };

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const { token, path } = await ctx.params;
  const fileId = await verifyPackageToken(token);
  if (!fileId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const client = await getActiveClient();
  const [file] = await db
    .select()
    .from(uploadedFiles)
    .where(
      and(
        eq(uploadedFiles.id, fileId),
        eq(uploadedFiles.clientId, client.id),
        isNull(uploadedFiles.archivedAt),
      ),
    )
    .limit(1);
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // A file id names immutable bytes, so an entry never changes under its URL.
  return packageEntryResponse({
    clientKey: client.key,
    file,
    relPath: path.join("/"),
    cacheControl: "public, max-age=86400",
  });
}
