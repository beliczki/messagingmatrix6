import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, shareGalleries, uploadedFiles, type UploadedFile } from "@/db/schema";

// The public share viewer is unauthenticated, so a file is reachable through a
// share only when that share's frozen snapshot lists it. The share id is the
// capability: anyone holding the link sees exactly the files it was made with,
// and nothing else in the client. Every public route that serves a shared
// file's bytes — the file itself, its stills, an HTML5 package's entries — asks
// here, so the rule cannot drift between them.
export async function loadSharedFile(
  shareId: string,
  fileId: string,
): Promise<{ file: UploadedFile; clientKey: string } | null> {
  const [share] = await db
    .select()
    .from(shareGalleries)
    .where(eq(shareGalleries.id, shareId))
    .limit(1);
  if (!share || share.archivedAt !== null || !share.metadata) return null;

  let referenced = false;
  try {
    const meta = JSON.parse(share.metadata) as { files?: Array<{ id?: string }> };
    referenced = (meta.files ?? []).some((f) => f?.id === fileId);
  } catch {
    return null;
  }
  if (!referenced) return null;

  const [file] = await db
    .select()
    .from(uploadedFiles)
    .where(eq(uploadedFiles.id, fileId))
    .limit(1);
  if (!file || file.clientId !== share.clientId) return null;

  const [client] = await db
    .select({ key: clients.key })
    .from(clients)
    .where(eq(clients.id, file.clientId))
    .limit(1);
  if (!client) return null;
  return { file, clientKey: client.key };
}
