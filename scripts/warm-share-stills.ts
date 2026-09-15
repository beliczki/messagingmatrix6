/**
 * Cut the video still strips for every live share gallery.
 *
 * Shares warm their own strips as they are created (see the POST handler in
 * api/share-galleries), so this exists for the one case that cannot: strips
 * already on disk under an OLDER cache version. Bumping STILLS_CACHE_VERSION
 * invalidates them all, and without a pass like this the person who reopens an
 * existing share is the one who waits for the recut.
 *
 * Run it on the box after any deploy that bumps the version:
 *   ACTIVE_CLIENT_KEY=<tenant> npx tsx scripts/warm-share-stills.ts
 *
 * Idempotent: a strip already cut at the current version is a manifest read.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, shareGalleries, uploadedFiles } from "@/db/schema";
import { ensureStills } from "@/lib/video-stills";
import { getActiveClient } from "@/lib/active-client";

type SnapshotFile = { id?: string };

async function main() {
  const client = await getActiveClient();
  const [row] = await db
    .select({ id: clients.id, key: clients.key })
    .from(clients)
    .where(eq(clients.id, client.id))
    .limit(1);
  if (!row) throw new Error(`no client for key ${client.key}`);

  const shares = await db
    .select({ id: shareGalleries.id, metadata: shareGalleries.metadata })
    .from(shareGalleries)
    .where(
      and(
        eq(shareGalleries.clientId, row.id),
        isNull(shareGalleries.archivedAt),
      ),
    );

  const fileIds = new Set<string>();
  for (const s of shares) {
    if (!s.metadata) continue;
    try {
      const meta = JSON.parse(s.metadata) as { files?: SnapshotFile[] };
      for (const f of meta.files ?? []) if (f?.id) fileIds.add(f.id);
    } catch {
      console.error(`[warm] share ${s.id} has unreadable metadata, skipped`);
    }
  }
  if (fileIds.size === 0) {
    console.log(`[warm] ${client.key}: ${shares.length} shares, no files`);
    return;
  }

  const files = await db
    .select({
      id: uploadedFiles.id,
      storagePath: uploadedFiles.storagePath,
      mimeType: uploadedFiles.mimeType,
    })
    .from(uploadedFiles)
    .where(
      and(
        eq(uploadedFiles.clientId, row.id),
        inArray(uploadedFiles.id, [...fileIds]),
      ),
    );
  const videos = files.filter((f) => f.mimeType?.startsWith("video/"));
  console.log(
    `[warm] ${client.key}: ${shares.length} shares, ${files.length} files, ${videos.length} videos`,
  );

  let done = 0;
  let failed = 0;
  for (const v of videos) {
    const t0 = Date.now();
    try {
      const m = await ensureStills(row.key, v.id, v.storagePath);
      done += 1;
      console.log(
        `[warm] ${v.id}: ${m.count} stills, ${m.durationSec}s (${Date.now() - t0}ms)`,
      );
    } catch (e) {
      failed += 1;
      console.error(`[warm] ${v.id}: FAILED — ${(e as Error).message}`);
    }
  }
  console.log(`[warm] done: ${done} warmed, ${failed} failed`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
