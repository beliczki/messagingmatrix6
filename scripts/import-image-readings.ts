// Load the image-reading inventory (what a model read OFF each creative) into
// `creatives.image_text` / `image_description`, with the date and the model
// that produced it.
//
// Re-runnable by design: the inventory is filled in rounds, so this skips rows
// whose text is unchanged and only writes what moved. That also makes it the
// tool for the next 850 rows, not a one-shot import.
//
// The sheet's first column is the path the export wrote
// (`<class>/MC<number>_<slug>/<size>__<letter>[_nN].<ext>`), which is how a row
// finds its creative again: MC number + variant + declared size. The original
// filename is not in the sheet, and does not need to be — those three identify
// the row, and the match is verified against the stored filename before a write.
//
//   npx tsx --env-file=.env.local scripts/import-image-readings.ts \
//     "~/ERSTE Addressable AI Agent/problematic creatives/Problematic_creatives_kepleltar.xlsx" \
//     --model "gpt-4o-mini" [--client erste] [--dry]
import xlsx from "node-xlsx";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, creatives } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { parseCreativeFilename } from "@/lib/parse-creative-filename";
import { nowUtc } from "@/db/schema";

type SheetRow = { rel: string; mc: number; size: string; letter: string; version: number; text: string; desc: string };

function parseArgs() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    file,
    model: get("--model") ?? "unknown",
    clientKey: get("--client") ?? "erste",
    dry: args.includes("--dry"),
  };
}

function readSheet(path: string): SheetRow[] {
  const rows = (xlsx.parse(path)[0]!.data as unknown[][]).slice(1);
  const out: SheetRow[] = [];
  for (const r of rows) {
    const rel = String(r[0] ?? "");
    const text = String(r[2] ?? "").trim();
    const desc = String(r[3] ?? "").trim();
    if (!text && !desc) continue; // not read yet
    const m = rel.match(/^[^/]+\/MC(\d+)[^/]*\/(.+?)__([a-z])(?:_n(\d+))?\.[a-z0-9]+$/i);
    if (!m) {
      console.log(`  ? nem értelmezhető útvonal: ${rel}`);
      continue;
    }
    // The version token matters: one (MC, letter, size) slot can hold several
    // versions, and they are different pictures — matching without it would
    // write one reading onto both.
    out.push({
      rel, mc: Number(m[1]), size: m[2]!, letter: m[3]!.toLowerCase(),
      version: m[4] ? Number(m[4]) : 1, text, desc,
    });
  }
  return out;
}

async function main() {
  const { file, model, clientKey, dry } = parseArgs();
  if (!file) throw new Error("add meg a leltár xlsx útvonalát");

  const [client] = await db.select().from(clients).where(eq(clients.key, clientKey)).limit(1);
  if (!client) throw new Error(`nincs ilyen kliens: ${clientKey}`);

  const sheet = readSheet(file.replace(/^~/, process.env.HOME ?? "~"));
  console.log(`leltár: ${sheet.length} kitöltött sor`);

  const rows = await db
    .select()
    .from(creatives)
    .where(
      and(
        eq(creatives.clientId, client.id),
        isNull(creatives.archivedAt),
        inArray(creatives.mcNumber, [...new Set(sheet.map((s) => s.mc))]),
      ),
    );

  let written = 0, unchanged = 0, missing = 0, ambiguous = 0;

  for (const s of sheet) {
    // The size in the exported name is the DECLARED one, which is what the
    // stored filename carries too — so matching on the filename containing it
    // is stricter than matching on file_dimensions (retina crops differ there).
    const hits = rows.filter(
      (c) =>
        c.mcNumber === s.mc &&
        (c.mcVariant ?? "a").toLowerCase() === s.letter &&
        (c.fileName ?? "").includes(s.size) &&
        parseCreativeFilename(c.fileName ?? "").version === s.version,
    );
    if (hits.length === 0) { missing += 1; console.log(`  – nincs találat: ${s.rel}`); continue; }
    if (hits.length > 1) { ambiguous += 1; console.log(`  ! több találat (${hits.length}): ${s.rel}`); continue; }
    const c = hits[0]!;
    if ((c.imageText ?? "") === s.text && (c.imageDescription ?? "") === s.desc) {
      unchanged += 1;
      continue;
    }
    if (!dry) {
      await db
        .update(creatives)
        .set({
          imageText: s.text || null,
          imageDescription: s.desc || null,
          // The SQL default fragment, not a JS date: every timestamp in this
          // schema is a UTC `YYYY-MM-DD HH:MM:SS` string written by the DB, and
          // a toISOString() here would sort differently ('T' > ' ').
          imageReadAt: nowUtc,
          imageReadModel: model,
          updatedAt: nowUtc,
        })
        .where(eq(creatives.id, c.id));
      await writeAudit({
        clientId: client.id,
        userId: null,
        entityType: "creatives",
        entityId: c.id,
        action: "update",
        before: { imageText: c.imageText, imageDescription: c.imageDescription },
        after: { imageText: s.text || null, imageDescription: s.desc || null, imageReadModel: model },
        silent: true,
      });
    }
    written += 1;
  }

  console.log(
    `${dry ? "[SZÁRAZ] " : ""}írva: ${written}, változatlan: ${unchanged}` +
      `${missing ? `, nincs találat: ${missing}` : ""}${ambiguous ? `, többértelmű: ${ambiguous}` : ""}`,
  );
  process.exit(0);
}

main();
