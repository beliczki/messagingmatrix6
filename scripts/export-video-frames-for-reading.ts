// Cut the readable frames out of every video creative, so the image-reading
// round can treat a clip the same way it treats a banner.
//
// Measured on MC33 (10s, 60fps) before this was written: the clip carries NO
// text for its first four seconds, the end card builds at ~5s and stands intact
// to the very last frame, and all four letters' end cards say the SAME WORDS —
// only the photo and the colour differ. Two consequences shape this script:
//
//   1. one frame is enough, and it is the LAST one — not a fixed "penultimate".
//      What we want is "the last frame the creative is still on": we walk back
//      from the end past fades, black tails and held logo cards, and if the
//      whole tail is empty (MC377 spends its last four seconds on a wordmark)
//      we sweep the clip and take the latest frame that still carries it.
//   2. the real prize is not the text but the PIXEL witness. gen-variant-actions
//      opens files with sharp, which throws on mp4, so its diff() returns null
//      and the logic falls through to "same words, differs over a large area"
//      WITHOUT having measured anything. A JPEG end card restores the witness.
//
// A single frame can still lose text on a clip that SEQUENCES its copy (headline
// early, CTA late). Rather than guess with a threshold, every (MC, letter) gets
// one contact sheet of four probe frames, and the reader decides with its eyes.
// Per letter, not per size: the sizes of one letter are the same design.
//
//   npx tsx --env-file=.env.local scripts/export-video-frames-for-reading.ts \
//     --dir round3 [--missing] [--mc 33,377] [--client erste]
//
//   --missing   only videos with no image_text yet (the usual case)
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { and, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, creatives, uploadedFiles } from "@/db/schema";
import { readFileBytes } from "@/lib/storage";
import { parseCreativeFilename } from "@/lib/parse-creative-filename";

const run = promisify(execFile);
const BASE = join(process.env.HOME!, "ERSTE Addressable AI Agent", "problematic creatives");

// ffmpeg hands over lossless PNG and sharp does the JPEG encode — the same rule
// video-stills.ts follows, and for the same reason: ffmpeg's mjpeg encoder does
// not convert a BT.709 source into the BT.601 matrix JPEG is defined around, so
// a brand colour comes out visibly duller. Here the colour IS the discriminator
// between letters, so the difference is not cosmetic.
const JPEG = { quality: 92, mozjpeg: true, chromaSubsampling: "4:4:4" } as const;

/** A frame this flat carries no creative: a fade-out, a black leader, or a
 *  plain colour card. Measured against MC33, whose end card sits at stdev ~70
 *  and whose 1.0s photo-only frame still reaches ~45 — so 12 only catches
 *  frames that are genuinely near-uniform, never a text-free photo. */
const FLAT_STDEV = 12;
/** Flatness alone is not enough: MC377 ends on a LOGO card — one brand mark on
 *  a solid blue field — which is not flat and carries none of the creative.
 *  "Ink" is the share of pixels far from the frame's dominant colour, and it
 *  separates the two cases with a wide margin: measured over all 97 cards, the
 *  four logo cards sit at 4.3-5.1% and the lowest CONTENT card at 26.0%. */
const MIN_INK_PCT = 15;
/** How far back from the end we are willing to walk looking for a full frame. */
const MAX_STEPBACK_SEC = 2.5;
const STEPBACK_SEC = 0.25;
/** Where the contact sheet's probes sit, as a fraction of the clip. */
const PROBE_FRACTIONS = [0.2, 0.4, 0.6, 0.8];
const PROBE_WIDTH = 540;

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
}

async function duration(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  const n = Number(stdout.trim());
  return Number.isFinite(n) ? n : 0;
}

/** One frame as lossless PNG bytes. `fromEnd` seeks backwards from the clip's
 *  end, which is the only way to reach the true final frame — a forward seek to
 *  `duration` lands past it and returns nothing. */
async function frame(file: string, work: string, at: { sec?: number; fromEnd?: number }): Promise<Buffer | null> {
  const out = join(work, `f${Date.now()}${Math.random().toString(36).slice(2, 7)}.png`);
  const seek = at.fromEnd !== undefined ? ["-sseof", `-${at.fromEnd}`] : ["-ss", String(at.sec ?? 0)];
  try {
    await run("ffmpeg", ["-v", "error", ...seek, "-i", file, "-frames:v", "1", out, "-y"]);
    return await sharp(out).png().toBuffer();
  } catch {
    return null;
  }
}

/** The largest per-channel standard deviation — how much the frame varies at
 *  all. Near zero means one flat colour. */
async function spread(png: Buffer): Promise<number> {
  const { channels } = await sharp(png).stats();
  return Math.max(...channels.slice(0, 3).map((c) => c.stdev));
}

/** The share of pixels far from the frame's dominant colour. */
async function ink(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png).resize({ width: 240 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const bins = new Map<string, number>();
  for (let i = 0; i < data.length; i += ch) {
    const k = `${data[i]! >> 4},${data[i + 1]! >> 4},${data[i + 2]! >> 4}`;
    bins.set(k, (bins.get(k) ?? 0) + 1);
  }
  const bg = [...bins].sort((a, b) => b[1] - a[1])[0]![0].split(",").map((n) => (Number(n) << 4) + 8);
  let far = 0;
  for (let i = 0; i < data.length; i += ch) {
    if (Math.hypot(data[i]! - bg[0]!, data[i + 1]! - bg[1]!, data[i + 2]! - bg[2]!) > 60) far += 1;
  }
  return (100 * far) / (w * h);
}

const carriesCreative = async (png: Buffer) =>
  (await spread(png)) >= FLAT_STDEV && (await ink(png)) >= MIN_INK_PCT;

/** The LAST frame the creative is still on.
 *
 *  Walking back from the end covers the common shapes — a fade-out, a black
 *  tail, a logo held for a beat. It is not enough on its own: MC377 is a 6s
 *  clip whose content card sits at ~1.5s and whose last four seconds are a
 *  wordmark, so the content is further back than any sane step-back window.
 *  When the walk comes up empty we therefore sweep the whole clip and take the
 *  latest frame that still carries the creative — latest, not richest, because
 *  an ad's closing card is the one that holds the legal line. */
async function endCard(file: string, work: string, dur: number): Promise<Buffer | null> {
  for (let back = 0.08; back <= MAX_STEPBACK_SEC; back += STEPBACK_SEC) {
    const png = await frame(file, work, { fromEnd: back });
    if (png && (await carriesCreative(png))) return png;
  }
  if (dur > 0) {
    for (const f of [0.85, 0.7, 0.55, 0.4, 0.25, 0.12]) {
      const png = await frame(file, work, { sec: Number((dur * f).toFixed(2)) });
      if (png && (await carriesCreative(png))) return png;
    }
  }
  // Nothing anywhere passed — hand back the last frame rather than silently
  // exporting nothing, so the row is still visible in the inventory.
  return frame(file, work, { fromEnd: 0.08 });
}

/** Four probes across the clip, tiled 2x2, so a reader can see at a glance
 *  whether any copy appears earlier than the end card. */
async function contactSheet(file: string, work: string, dur: number): Promise<Buffer | null> {
  const tiles: Buffer[] = [];
  for (const f of PROBE_FRACTIONS) {
    const png = await frame(file, work, { sec: Number((dur * f).toFixed(2)) });
    if (png) tiles.push(await sharp(png).resize({ width: PROBE_WIDTH }).toBuffer());
  }
  if (tiles.length < 2) return null;
  const metas = await Promise.all(tiles.map((t) => sharp(t).metadata()));
  const w = Math.max(...metas.map((m) => m.width ?? PROBE_WIDTH));
  const h = Math.max(...metas.map((m) => m.height ?? PROBE_WIDTH));
  return sharp({
    create: { width: w * 2, height: h * 2, channels: 3, background: { r: 20, g: 20, b: 20 } },
  })
    .composite(tiles.map((input, i) => ({ input, left: (i % 2) * w, top: Math.floor(i / 2) * h })))
    .jpeg(JPEG)
    .toBuffer();
}

async function main() {
  const args = process.argv.slice(2);
  const get = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const dir = get("--dir") ?? "round3";
  const onlyMissing = args.includes("--missing");
  const mcs = (get("--mc") ?? "").split(",").map((s) => Number(s.trim())).filter(Boolean);
  const clientKey = get("--client") ?? "erste";

  const [client] = await db.select().from(clients).where(eq(clients.key, clientKey)).limit(1);
  if (!client) throw new Error(`nincs ilyen kliens: ${clientKey}`);

  const rows = await db
    .select({
      id: creatives.id, mc: creatives.mcNumber, variant: creatives.mcVariant,
      name: creatives.fileName, dims: creatives.fileDimensions, path: uploadedFiles.storagePath,
    })
    .from(creatives)
    .innerJoin(uploadedFiles, eq(uploadedFiles.id, creatives.fileId))
    .where(and(
      eq(creatives.clientId, client.id),
      isNull(creatives.archivedAt),
      isNotNull(creatives.mcNumber),
      sql`${creatives.fileName} ~* '\\.(mp4|mov|webm)$'`,
      ...(mcs.length ? [inArray(creatives.mcNumber, mcs)] : []),
      ...(onlyMissing ? [isNull(creatives.imageText)] : []),
    ));

  const root = join(BASE, dir);
  mkdirSync(root, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "mm6-vframes-"));

  // One contact sheet per (MC, letter) — the sizes of one letter are the same
  // design, so the representative is simply the biggest file of the letter.
  const repOf = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.mc}/${(r.variant ?? "a").toLowerCase()}`;
    const area = (d: string | null) => {
      const m = (d ?? "").match(/(\d+)x(\d+)/);
      return m ? Number(m[1]) * Number(m[2]) : 0;
    };
    const best = repOf.get(key);
    if (!best || area(r.dims) > area(rows.find((x) => x.id === best)?.dims ?? null)) repOf.set(key, r.id);
  }

  const byMc = new Map<number, typeof rows>();
  for (const r of rows) byMc.set(r.mc!, [...(byMc.get(r.mc!) ?? []), r]);

  let cards = 0, sheets = 0, failed = 0;
  const index: string[] = [];

  for (const [mc, list] of [...byMc].sort((a, b) => a[0] - b[0])) {
    const kw = slug(parseCreativeFilename(list[0]!.name ?? "").keywords);
    const folder = join(root, `MC${mc}_${kw || "no_keywords"}`);
    mkdirSync(folder, { recursive: true });

    for (const r of list) {
      const p = parseCreativeFilename(r.name ?? "");
      const size = p.declaredDimensions ?? r.dims ?? "ismeretlen";
      const ver = p.version > 1 ? `_n${p.version}` : "";
      const stem = `id${r.id}__${size}__${(r.variant ?? "a").toLowerCase()}${ver}`;
      const card = join(folder, `${stem}.jpg`);
      const sheet = join(folder, `${stem}__idosav.jpg`);
      const wantsSheet = repOf.get(`${r.mc}/${(r.variant ?? "a").toLowerCase()}`) === r.id;
      index.push(`id${r.id}\t${r.name}`);
      if (existsSync(card) && (!wantsSheet || existsSync(sheet))) continue;

      const clip = join(work, `${r.id}.bin`);
      try {
        await writeFile(clip, await readFileBytes(r.path));
        const dur = await duration(clip);
        const png = await endCard(clip, work, dur);
        if (!png) throw new Error("nem sikerült kockát kivágni");
        if (!existsSync(card)) {
          writeFileSync(card, await sharp(png).jpeg(JPEG).toBuffer());
          cards += 1;
        }
        if (wantsSheet && !existsSync(sheet) && dur > 0) {
          const cs = await contactSheet(clip, work, dur);
          if (cs) { writeFileSync(sheet, cs); sheets += 1; }
        }
      } catch (e) {
        failed += 1;
        console.log(`  ! ${r.name}: ${(e as Error).message}`);
      } finally {
        await rm(clip, { force: true });
      }
    }
  }

  // The index MERGES with what is already listed. A partial re-run (`--mc 377`)
  // that simply overwrote it would leave a file claiming the round holds four
  // creatives when it holds 97 — and anything reading the index downstream
  // would then quietly work on a fraction of the round.
  const indexPath = join(root, "_TARTALOM.txt");
  const known = new Map<string, string>();
  if (existsSync(indexPath)) {
    for (const line of readFileSync(indexPath, "utf8").split("\n")) {
      const m = line.match(/^(id\d+)\t(.*)$/);
      if (m) known.set(m[1]!, m[2]!);
    }
  }
  for (const line of index) {
    const [id, name] = line.split("\t");
    known.set(id!, name ?? "");
  }

  writeFileSync(
    indexPath,
    `Videó-kreatívok olvasásra — ${dir}\n` +
      `Exportálva: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC\n\n` +
      `A <stem>.jpg a klip ZÁRÓ KÁRTYÁJA (az utolsó kocka, amin még rajta van a kreatív).\n` +
      `A <stem>__idosav.jpg 2x2 kontaktlap a klip 20/40/60/80%-áról — (MC, betű)-nként EGY,\n` +
      `azért, hogy látszódjon, ha a klip lépcsőzi a szöveget. Az idosav NEM külön leltársor.\n\n` +
      `A fájlnév elején álló idNNNN a kreatív azonosítója, ez a párosítás kulcsa.\n\n` +
      [...known].sort((a, b) => Number(a[0].slice(2)) - Number(b[0].slice(2)))
        .map(([id, name]) => `${id}\t${name}`).join("\n") + "\n",
  );
  await rm(work, { recursive: true, force: true });
  console.log(`kész: ${cards} záró kártya, ${sheets} kontaktlap${failed ? `, ${failed} hiba` : ""} → ${root}`);
  process.exit(0);
}

main();
