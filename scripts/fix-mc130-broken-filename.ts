// MC130: repair the one thing that is objectively broken, and leave the rest.
//
// THE DECISION (2026-09-23). MC130 carries two designs — `a` is the one with a
// solid text panel, `b` writes its copy straight onto the footage — and that is
// what letters are FOR, so the letters stay. The variant plan wanted to rename
// `b_n5` into `a_n2`, which would have filed the newest delivery below two
// older ones (the `a` family already holds n3 and n4); it was excluded from the
// run and the version guard in apply-variant-actions now refuses that shape
// permanently. Creative 14981 (`a_n4`) is a text-on-footage file sitting in the
// `a` family, so by today's reading it is lettered wrong — but it has been live
// for months in a family that receives no new versions, and rewriting an old
// live row to tidy a closed ladder buys nothing.
//
// What IS broken is a filename. `..._n5_1080x1080_1.mp4` ends in a stray `_1`,
// which the parser reads as part of the size token: declaredDimensions comes
// back null and the family key swallows the junk
// (`..._fuggoagy_videoAndColor_1080x1080_1`). That is why this creative shows an
// empty `file_dimensions` and `family_key`, and why the video export called its
// size "ismeretlen". Dropping the `_1` fixes all three at once.
//
// The message that names the file moves with it — image1 is matched by name, so
// renaming only the creative would leave the matrix cell pointing at nothing.
//
//   npx tsx --env-file=.env.local scripts/fix-mc130-broken-filename.ts [--apply]
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, creatives, messages, nowUtc } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { parseCreativeFilename } from "@/lib/parse-creative-filename";

const CREATIVE_ID = 17829;
const MESSAGE_ID = 36103;
const OLD = "ERSTE_SZK_MC130_a_fuggoagy_videoAndColor_n5_1080x1080_1.mp4";
const NEW = "ERSTE_SZK_MC130_a_fuggoagy_videoAndColor_n5_1080x1080.mp4";

async function main() {
  const apply = process.argv.includes("--apply");
  const [client] = await db.select().from(clients).where(eq(clients.key, "erste")).limit(1);
  if (!client) throw new Error("nincs erste kliens");

  const [c] = await db.select().from(creatives).where(eq(creatives.id, CREATIVE_ID));
  const [m] = await db.select().from(messages).where(eq(messages.id, MESSAGE_ID));
  if (!c || !m) throw new Error("nincs meg a kreatív vagy az üzenet");
  if (c.fileName !== OLD) throw new Error(`a kreatív neve nem a várt: ${c.fileName}`);
  if (m.image1 !== OLD) throw new Error(`az üzenet image1-e nem a várt: ${m.image1}`);

  const taken = await db
    .select({ id: creatives.id })
    .from(creatives)
    .where(and(eq(creatives.clientId, client.id), eq(creatives.fileName, NEW)));
  if (taken.length) throw new Error(`a célnevet már viseli: id${taken[0]!.id}`);

  const parsed = parseCreativeFilename(NEW);
  const set = {
    fileName: NEW,
    fileDimensions: parsed.declaredDimensions,
    familyKey: parsed.familyKey,
  };
  console.log("kreatív előtte:", {
    fileName: c.fileName, fileDimensions: c.fileDimensions || "(üres)", familyKey: c.familyKey || "(üres)",
  });
  console.log("kreatív utána: ", set);
  console.log("üzenet image1:  ", m.image1, "→", NEW);

  if (!apply) {
    console.log("\n[SZÁRAZ] semmi nem lett írva. Éles: --apply");
    process.exit(0);
  }

  await db
    .update(creatives)
    .set({ ...set, version: sql`${creatives.version} + 1`, updatedAt: c.updatedAt })
    .where(and(eq(creatives.clientId, client.id), eq(creatives.id, CREATIVE_ID)));
  await writeAudit({
    clientId: client.id, userId: null, entityType: "creatives", entityId: CREATIVE_ID,
    action: "update",
    before: { fileName: c.fileName, fileDimensions: c.fileDimensions, familyKey: c.familyKey },
    after: set,
    silent: true,
  });

  await db
    .update(messages)
    .set({
      image1: NEW,
      ...(m.name === OLD ? { name: NEW } : {}),
      version: sql`${messages.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(messages.clientId, client.id), eq(messages.id, MESSAGE_ID)));
  await writeAudit({
    clientId: client.id, userId: null, entityType: "messages", entityId: MESSAGE_ID,
    action: "update",
    before: { image1: m.image1 },
    after: { image1: NEW },
    silent: true,
  });

  console.log("\nkész");
  process.exit(0);
}

main();
