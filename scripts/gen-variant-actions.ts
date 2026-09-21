// Build "Problematic_creatives_teendok.xlsx" — one row per exported creative,
// with what to do about it: keep, rename to a version of the reference, or
// archive as a redundant export.
//
// Three witnesses decide, never one:
//   1. the TEXT read off the picture (image_text) — a THM/rate line that moved
//      while the rest is identical is a VERSION, not another variant;
//   2. the PIXELS — where two files of one size differ. A change confined to a
//      small box is a rate refresh; a difference that lives on the contours is
//      the same design exported twice; a difference spread over real area is a
//      different creative;
//   3. the UPLOAD DATE — which file came first, so the ladder is n1 → n2 in the
//      order the work actually happened.
//
// Read-only: it writes a spreadsheet, never the database. Re-runnable as the
// inventory fills.
//
//   npx tsx --env-file=.env.local scripts/gen-variant-actions.ts [clientKey]
import xlsx from "node-xlsx";
import sharp from "sharp";
import { readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, creatives, uploadedFiles } from "@/db/schema";
import { parseCreativeFilename } from "@/lib/parse-creative-filename";

const ROOT = join(process.env.HOME!, "ERSTE Addressable AI Agent", "problematic creatives");

/** Diff thresholds, calibrated on MC101 where all three cases sit side by side:
 *  b↔f (rate line only) 0.47% in one box; a↔b (re-export) 5.4% on the contours;
 *  a genuinely different creative lights up whole areas. */
const SAME_DESIGN_PCT = 9;
const SAME_DESIGN_MEAN = 12;
const LOCALISED_BOX_PCT = 18;

type Row = {
  rel: string; mc: number; size: string; letter: string; version: number;
  id?: number; name?: string; sha?: string; uploaded?: string;
  text?: string; desc?: string; thm?: string;
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const thmOf = (t: string) => t.match(/THM:?\s*([\d,]+\s*%)/i)?.[1]?.replace(/\s/g, "") ?? "";
const textSansThm = (t: string) => norm(t).replace(/thm:?\s*[\d,]+\s*%(\s*-\s*[\d,]+\s*%)?/g, "«thm»");

async function diff(a: string, b: string) {
  try {
    const A = await sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const B = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (A.info.width !== B.info.width || A.info.height !== B.info.height) return null;
    const { width: w, height: h, channels: ch } = A.info;
    let n = 0, sum = 0, minX = w, minY = h, maxX = 0, maxY = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const d = Math.max(
        Math.abs(A.data[i] - B.data[i]),
        Math.abs(A.data[i + 1] - B.data[i + 1]),
        Math.abs(A.data[i + 2] - B.data[i + 2]),
      );
      sum += d;
      if (d > 8) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    return {
      pct: (100 * n) / (w * h),
      mean: sum / (w * h),
      boxPct: n === 0 ? 0 : (100 * (maxX - minX + 1) * (maxY - minY + 1)) / (w * h),
      box: n ? `x${minX}-${maxX} y${minY}-${maxY}` : "",
    };
  } catch {
    return null;
  }
}

function scanExport(): Row[] {
  const out: Row[] = [];
  for (const cls of readdirSync(ROOT)) {
    const clsPath = join(ROOT, cls);
    let mcDirs: string[];
    try { mcDirs = readdirSync(clsPath); } catch { continue; }
    for (const dir of mcDirs) {
      const mc = Number(dir.match(/^MC(\d+)/)?.[1]);
      if (!mc) continue;
      for (const f of readdirSync(join(clsPath, dir))) {
        if (f.startsWith("_")) continue;
        const m = f.match(/^(.+?)__([a-z])(?:_n(\d+))?\.([a-z0-9]+)$/i);
        if (!m) continue;
        out.push({
          rel: `${cls}/${dir}/${f}`, mc, size: m[1]!, letter: m[2]!.toLowerCase(),
          version: m[3] ? Number(m[3]) : 1,
        });
      }
    }
  }
  return out;
}

async function main() {
  const clientKey = process.argv[2] ?? "erste";
  const [client] = await db.select().from(clients).where(eq(clients.key, clientKey)).limit(1);
  if (!client) throw new Error(`nincs ilyen kliens: ${clientKey}`);

  const rows = scanExport();
  const dbRows = await db
    .select({
      id: creatives.id, mc: creatives.mcNumber, variant: creatives.mcVariant,
      name: creatives.fileName, sha: uploadedFiles.sha256, created: creatives.createdAt,
      text: creatives.imageText, desc: creatives.imageDescription,
    })
    .from(creatives)
    .innerJoin(uploadedFiles, eq(uploadedFiles.id, creatives.fileId))
    .where(and(
      eq(creatives.clientId, client.id),
      isNull(creatives.archivedAt),
      inArray(creatives.mcNumber, [...new Set(rows.map((r) => r.mc))]),
    ));

  for (const r of rows) {
    const hits = dbRows.filter((c) =>
      c.mc === r.mc &&
      (c.variant ?? "a").toLowerCase() === r.letter &&
      (c.name ?? "").includes(r.size) &&
      parseCreativeFilename(c.name ?? "").version === r.version);
    const hit = hits.length === 1 ? hits[0] : undefined;
    if (!hit) continue;
    r.id = hit.id; r.name = hit.name ?? undefined; r.sha = hit.sha ?? undefined;
    r.uploaded = hit.created.slice(0, 10);
    r.text = hit.text ?? undefined; r.desc = hit.desc ?? undefined;
    r.thm = thmOf(hit.text ?? "");
  }

  const out: (string | number)[][] = [[
    "Fájl (almappával)", "MC", "Méret", "Betű", "Verzió", "THM", "Feltöltve",
    "Teendő", "Új név / cél", "Miért", "Diff a referenciához",
  ]];

  for (const mc of [...new Set(rows.map((r) => r.mc))].sort((a, b) => a - b)) {
    const mine = rows.filter((r) => r.mc === mc);
    const byLetter = new Map<string, Row[]>();
    for (const r of mine) byLetter.set(r.letter, [...(byLetter.get(r.letter) ?? []), r]);
    // Reference letter: the one covering the most sizes, ties to the earliest upload.
    const primary = [...byLetter.entries()].sort((a, b) =>
      new Set(b[1].map((r) => r.size)).size - new Set(a[1].map((r) => r.size)).size ||
      (a[1][0]!.uploaded ?? "9").localeCompare(b[1][0]!.uploaded ?? "9") ||
      a[0].localeCompare(b[0]))[0]![0];

    for (const size of [...new Set(mine.map((r) => r.size))].sort()) {
      const group = mine.filter((r) => r.size === size);
      const ref =
        group.find((r) => r.letter === primary && r.text) ??
        group.find((r) => r.letter === primary) ??
        [...group].sort((a, b) => (a.uploaded ?? "").localeCompare(b.uploaded ?? ""))[0]!;
      // Version ladder inside this size: distinct THMs, oldest upload first.
      const thms = [...new Set(group.map((r) => r.thm).filter(Boolean))].sort((x, y) =>
        (group.find((r) => r.thm === x)!.uploaded ?? "").localeCompare(
          group.find((r) => r.thm === y)!.uploaded ?? ""));

      for (const r of group) {
        let todo: string, target = "", why = "", dtxt = "";
        if (!r.id) {
          todo = "NINCS PÁROSÍTVA";
          why = "az exportban több kreatív osztozik ezen a néven — újraexport kell egyedi névvel";
        } else if (r === ref) {
          todo = "MARAD"; target = r.name ?? "";
          why = `ez a referencia ebben a méretben (betű: ${primary})`;
        } else {
          const d = await diff(join(ROOT, ref.rel), join(ROOT, r.rel));
          dtxt = d ? `${d.pct.toFixed(2)}% · átlag ${d.mean.toFixed(1)}${d.box ? ` · ${d.box}` : ""}` : "eltérő felbontás";
          const sameWords = r.text && ref.text ? textSansThm(r.text) === textSansThm(ref.text) : null;
          const thmMoved = !!(r.thm && ref.thm && r.thm !== ref.thm);
          const vIdx = thms.indexOf(r.thm ?? "");

          if (r.sha && ref.sha && r.sha === ref.sha) {
            todo = "ARCHIVÁL";
            why = "bájtra azonos a referenciával, csak a betű más";
          } else if (sameWords && thmMoved) {
            todo = "ÁTNEVEZ";
            target = (ref.name ?? "")
              .replace(/_n\d+_/, `_n${vIdx + 1}_`)
              .replace(new RegExp(`_${r.letter}_`), `_${primary}_`);
            why = `ugyanaz a kreatív, más kamatsorral (${ref.thm} → ${r.thm}) → ${vIdx + 1}. verzió`;
          } else if (sameWords && d && d.pct < SAME_DESIGN_PCT && d.mean < SAME_DESIGN_MEAN) {
            todo = "ARCHIVÁL";
            why = "azonos szöveg, azonos THM; az eltérés a kontúrokon → ugyanaz a design újraexportálva";
          } else if (sameWords && d && d.boxPct > 0 && d.boxPct < LOCALISED_BOX_PCT) {
            todo = "ELLENŐRIZ";
            why = "azonos szöveg, de az eltérés egy kis területre szorul — verzió vagy apró retus?";
          } else if (sameWords === null) {
            todo = "ELLENŐRIZ";
            why = "nincs képleírás az egyik oldalon — a szöveg nem tudott dönteni";
          } else {
            todo = "MARAD (külön kreatív)"; target = r.name ?? "";
            why = sameWords
              ? "azonos szöveg, de nagy felületen tér el → másik kép ugyanazzal a copyval"
              : "a kreatív szövege is más → másik üzenet";
          }
        }
        out.push([r.rel, r.mc, r.size, r.letter, r.version, r.thm || "—", r.uploaded ?? "—", todo, target, why, dtxt]);
      }
    }
  }

  const dest = join(ROOT, "Problematic_creatives_teendok.xlsx");
  writeFileSync(dest, xlsx.build([{ name: "Teendők", data: out, options: {} }]));
  const tally = new Map<string, number>();
  for (const r of out.slice(1)) tally.set(String(r[7]), (tally.get(String(r[7])) ?? 0) + 1);
  console.log(`${out.length - 1} sor → ${dest}`);
  for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
  process.exit(0);
}

main();
