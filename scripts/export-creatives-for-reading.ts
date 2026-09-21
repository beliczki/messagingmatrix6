// Export creative files for an image-reading round, named so that every file
// can be matched back to exactly one row.
//
// The first round named files `<size>__<letter>.<ext>`, which looked tidy and
// lost information: one MC letter can hold several different pictures at one
// size (MC311's `kapu_left` and `kapu_right`, MC348's `remarketing-1` and `-2`),
// so 30 files were never written and 20 readings could not be assigned
// afterwards. The creative's own ID goes in the name now — it is the only token
// that is unique by construction.
//
//   npx tsx --env-file=.env.local scripts/export-creatives-for-reading.ts \
//     --dir round2 --missing [--mc 33,311,348] [--client erste]
//
//   --missing   only creatives with no image_text yet (the usual case)
//   --mc        restrict to these MC numbers
//   --dir       subdirectory under "problematic creatives" (default: round2)
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, creatives, uploadedFiles } from "@/db/schema";
import { readFileBytes } from "@/lib/storage";
import { parseCreativeFilename } from "@/lib/parse-creative-filename";

const BASE = join(process.env.HOME!, "ERSTE Addressable AI Agent", "problematic creatives");

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
}

async function main() {
  const args = process.argv.slice(2);
  const get = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const dir = get("--dir") ?? "round2";
  const onlyMissing = args.includes("--missing");
  const mcs = (get("--mc") ?? "").split(",").map((s) => Number(s.trim())).filter(Boolean);
  const clientKey = get("--client") ?? "erste";

  const [client] = await db.select().from(clients).where(eq(clients.key, clientKey)).limit(1);
  if (!client) throw new Error(`nincs ilyen kliens: ${clientKey}`);

  const rows = await db
    .select({
      id: creatives.id, mc: creatives.mcNumber, variant: creatives.mcVariant,
      name: creatives.fileName, dims: creatives.fileDimensions,
      path: uploadedFiles.storagePath, text: creatives.imageText,
    })
    .from(creatives)
    .innerJoin(uploadedFiles, eq(uploadedFiles.id, creatives.fileId))
    .where(and(
      eq(creatives.clientId, client.id),
      isNull(creatives.archivedAt),
      isNotNull(creatives.mcNumber),
      ...(mcs.length ? [inArray(creatives.mcNumber, mcs)] : []),
      ...(onlyMissing ? [isNull(creatives.imageText)] : []),
    ));

  const root = join(BASE, dir);
  mkdirSync(root, { recursive: true });

  let done = 0, failed = 0;
  const index: string[] = [];
  const byMc = new Map<number, typeof rows>();
  for (const r of rows) byMc.set(r.mc!, [...(byMc.get(r.mc!) ?? []), r]);

  for (const [mc, list] of [...byMc].sort((a, b) => a[0] - b[0])) {
    const kw = slug(parseCreativeFilename(list[0]!.name ?? "").keywords);
    const folder = join(root, `MC${mc}_${kw || "no_keywords"}`);
    mkdirSync(folder, { recursive: true });
    for (const r of list) {
      const p = parseCreativeFilename(r.name ?? "");
      const size = p.declaredDimensions ?? r.dims ?? "ismeretlen";
      const ver = p.version > 1 ? `_n${p.version}` : "";
      const out = join(folder, `id${r.id}__${size}__${(r.variant ?? "a").toLowerCase()}${ver}.${p.ext || "bin"}`);
      index.push(`id${r.id}\t${r.name}`);
      if (existsSync(out)) continue;
      try {
        writeFileSync(out, await readFileBytes(r.path));
        done += 1;
      } catch (e) {
        failed += 1;
        console.log(`  ! ${r.name}: ${(e as Error).message}`);
      }
    }
  }

  writeFileSync(
    join(root, "_TARTALOM.txt"),
    `Képleírásra váró kreatívok — ${dir}\n` +
      `Exportálva: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC\n\n` +
      `A fájlnév ELEJÉN álló idNNNN a kreatív azonosítója. Ez a párosítás kulcsa,\n` +
      `ezért a leltárban a teljes útvonal maradjon meg változatlanul.\n\n` +
      index.join("\n") + "\n",
  );
  console.log(`kész: ${done} fájl${failed ? `, ${failed} hiba` : ""} → ${root}`);
  process.exit(0);
}

main();
