import { NextResponse } from "next/server";
import { getFile, getFileByFilename } from "@/lib/entities/files";
import { HTML5_PACKAGE_MIME } from "@/lib/html5-package";
import { signPackageToken } from "@/lib/public-shortcut";
import { withSession } from "@/lib/scoped";

// The playable URL of an uploaded HTML5 package, for the signed-in app. The
// secret never leaves the server: surfaces that know the file id (the library)
// or only the filename (a matrix cell's image1) ask here, and frame the answer.
export const GET = withSession(async ({ req, claims }) => {
  const url = new URL(req.url);
  const fileId = url.searchParams.get("fileId");
  const filename = url.searchParams.get("filename");
  if (!fileId === !filename) {
    return NextResponse.json({ error: "exactly_one_of_fileId_filename" }, { status: 400 });
  }
  const file = fileId
    ? await getFile(claims.cid, fileId)
    : await getFileByFilename(claims.cid, filename!);
  if (!file || file.archivedAt) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (file.mimeType !== HTML5_PACKAGE_MIME) {
    return NextResponse.json({ error: "not_a_package" }, { status: 404 });
  }
  const token = await signPackageToken(file.id);
  return NextResponse.json({
    fileId: file.id,
    url: `/pkg/${encodeURIComponent(token)}/index.html`,
    dimensions: file.dimensions,
  });
});
