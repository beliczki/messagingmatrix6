// Backfill the Agentic matrix cells for creatives whose FILENAME already names
// an MC (…_MC324_b_…) but which never got a message row — the Creative Library
// upload path writes a `creatives` row only, so every file that arrived after
// the last scripts/rebuild-creatives.ts run is invisible in the matrix.
//
// Reads the creatives table; touches no files and no object storage. Grouping,
// channel-from-size and representative-file choice mirror rebuild-creatives.ts
// step 4, so a backfilled cell is indistinguishable from a batch-imported one.
//
// Dry-run does the real work inside a transaction and rolls it back, so what it
// prints is what --commit will write, not a second guess at it.
//
//   ACTIVE_CLIENT_KEY=erste DATABASE_URL=… npx tsx scripts/backfill-orphan-mcs.ts
//   ACTIVE_CLIENT_KEY=erste DATABASE_URL=… npx tsx scripts/backfill-orphan-mcs.ts --commit

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { creatives, type Creative } from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";
import { parseCreativeFilename } from "../src/lib/parse-creative-filename";
import { channelCodeForSize, ensureAgenticMc } from "../src/lib/entities/promote";

class Rollback extends Error {}

function area(dimensions: string | null): number {
  const m = dimensions?.match(/^(\d+)x(\d+)$/i);
  return m ? parseInt(m[1]!, 10) * parseInt(m[2]!, 10) : 0;
}

// The cell's cover image: newest version, then the largest size in it —
// rebuild-creatives.ts's pickRep, over the DB rows instead of the folder.
function pickRep(group: Creative[]): Creative {
  return [...group].sort((a, b) => {
    const pa = parseCreativeFilename(a.fileName ?? "");
    const pb = parseCreativeFilename(b.fileName ?? "");
    return (
      pb.version - pa.version ||
      area(pb.declaredDimensions) - area(pa.declaredDimensions)
    );
  })[0]!;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const client = await getActiveClient();
  console.log(
    `\n=== backfill-orphan-mcs (client ${client.key}/${client.id}) ${commit ? "COMMIT" : "DRY-RUN"} ===`,
  );

  const rows = await db
    .select()
    .from(creatives)
    .where(
      and(
        eq(creatives.clientId, client.id),
        isNull(creatives.archivedAt),
        isNotNull(creatives.mcNumber),
      ),
    );
  console.log(`Numbered live creatives: ${rows.length}`);

  // One matrix cell = one (number, variant, channel).
  const groups = new Map<string, Creative[]>();
  for (const c of rows) {
    if (!c.fileName) continue;
    const parsed = parseCreativeFilename(c.fileName);
    const code = channelCodeForSize(
      parsed.declaredDimensions ?? c.fileDimensions,
    );
    const key = `${c.mcNumber}|${(c.mcVariant ?? "a").toLowerCase()}|${code}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  console.log(`Distinct (number, variant, channel) cells: ${groups.size}`);

  const created: string[] = [];
  const skipped = new Map<string, number>();
  try {
    await db.transaction(async () => {
      for (const [key, group] of [...groups.entries()].sort()) {
        const rep = pickRep(group);
        const res = await ensureAgenticMc(client.id, rep);
        if (res.created) {
          created.push(
            `MC${res.message.number}${res.message.variant} · ${res.message.audience} · topic '${res.message.topic}' · ${group.length} file(s) · cover ${rep.fileName}`,
          );
        } else {
          skipped.set(res.reason, (skipped.get(res.reason) ?? 0) + 1);
          if (res.reason === "archived-twin") {
            console.log(`  ARCHIVED TWIN, skipped: ${key}`);
          }
        }
      }
      if (!commit) throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  console.log(`\nCells to create: ${created.length}`);
  for (const line of created) console.log(`  + ${line}`);
  console.log(
    `Untouched: ${[...skipped.entries()].map(([r, n]) => `${r}=${n}`).join(" · ") || "none"}`,
  );
  console.log(
    commit ? `\n=== committed ===` : `\nDRY-RUN — rolled back, nothing written.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
