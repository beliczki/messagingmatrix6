// Write what the DB now holds for a list of creatives into the "Creative export"
// sheet of an mc-export xlsx: the image-reading columns and updated_at. Every
// other byte of the file stays as it was (src/lib/xlsx-sheet-patch.ts).
//
// Why a patch and not a fresh export: the shared mc-export is an uploaded .xlsx,
// not a native Google Sheet. The Sheets API cannot edit it, a browser paste
// skips the rows a filter hides, and a fresh export would drop the filter and
// change the link people have. So the file is patched locally and copied back
// with a file operation; no cell value passes through a model.
//
//   npx tsx --env-file=.env.local scripts/patch-mc-export.ts <xlsx> --ids <file>[,<file>…] \
//     [--out <xlsx> | --in-place] [--remote <rclone path>] [--client erste]
//
// --ids: files of comma-separated creative ids, e.g. the import-id-lista.txt an
// import run leaves behind. Without --out / --in-place it only reports.
//
// It refuses to write when a target is not an active creative of the client,
// is not in the sheet, or when a target row's other creatives columns differ
// from the DB: writing updated_at claims the row is current, and it would not
// be. It reports, without refusing, sheet rows outside the targets whose
// updated_at is behind the DB, sheet rows that are no longer active creatives,
// and active creatives the sheet does not have.
//
// --in-place overwrites the input where it is: truncate and write, never a
// rename, so on the rclone Drive mount the Drive file keeps its id. Before the
// write it checks the file did not change during the run (and with --remote
// that the Drive copy is the one it read); after it, that the file reads back
// as written. The upload itself is asynchronous: the script prints the command
// that checks the Drive side. The file must be closed in every browser — that,
// nothing here can check.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import JSZip from "jszip";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, creatives } from "@/db/schema";
import { patchSheetCells, readSheet } from "@/lib/xlsx-sheet-patch";

const SHEET = "Creative export";
const KEY = "creative_id";
const PAGE_SIZE = 500; // row-cap rule: keyset pages over the client's creatives

type CreativeRow = Awaited<ReturnType<typeof fetchTargets>>[number];

// The columns this script writes, from the DB row. Same values gen-mc-export.ts writes.
const WRITTEN: Record<string, (c: CreativeRow) => string> = {
  image_text: (c) => c.imageText ?? "",
  image_description: (c) => c.imageDescription ?? "",
  image_read_at: (c) => c.imageReadAt ?? "",
  image_read_model: (c) => c.imageReadModel ?? "",
  updated_at: (c) => c.updatedAt,
};

// The other columns of a target row that come straight from `creatives`
// (matrix_status comes from messages, link is signed: neither is checked).
const CHECKED: Record<string, (c: CreativeRow) => string> = {
  mc: (c) => (c.mcNumber === null ? "" : `MC${c.mcNumber}${c.mcVariant ?? ""}`),
  mc_number: (c) => (c.mcNumber === null ? "" : String(c.mcNumber)),
  variant: (c) => c.mcVariant ?? "",
  product: (c) => c.product ?? "",
  brand: (c) => c.brand ?? "",
  type: (c) => c.type ?? "",
  visual_keyword: (c) => c.visualKeyword ?? "",
  copy_keyword: (c) => c.copyKeyword ?? "",
  banner_version: (c) => c.bannerVersion ?? "",
  file_name: (c) => c.fileName ?? "",
  format: (c) => c.fileFormat ?? "",
  dimensions: (c) => c.fileDimensions ?? "",
  file_size: (c) => c.fileSize ?? "",
  drive_folder: (c) => c.driveFolderName ?? "",
};

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const values = new Set(["--ids", "--out", "--remote", "--client"].map(get));
  const file = args.find((a) => !a.startsWith("--") && !values.has(a));
  return {
    file,
    ids: get("--ids"),
    out: get("--out"),
    inPlace: args.includes("--in-place"),
    remote: get("--remote"),
    clientKey: get("--client") ?? "erste",
  };
}

const md5 = (buf: Uint8Array) => createHash("md5").update(buf).digest("hex");

function remoteMd5(remote: string): string {
  const out = execFileSync("rclone", ["md5sum", remote], { encoding: "utf8" }).trim();
  const hash = out.split(/\s+/)[0];
  if (!hash || !/^[0-9a-f]{32}$/.test(hash)) throw new Error(`rclone md5sum: nem értelmezhető válasz: ${out}`);
  return hash;
}

async function fetchTargets(clientId: number, ids: number[]) {
  const out = [];
  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    out.push(
      ...(await db
        .select({
          id: creatives.id,
          mcNumber: creatives.mcNumber,
          mcVariant: creatives.mcVariant,
          brand: creatives.brand,
          product: creatives.product,
          type: creatives.type,
          visualKeyword: creatives.visualKeyword,
          copyKeyword: creatives.copyKeyword,
          bannerVersion: creatives.bannerVersion,
          fileName: creatives.fileName,
          fileFormat: creatives.fileFormat,
          fileDimensions: creatives.fileDimensions,
          fileSize: creatives.fileSize,
          driveFolderName: creatives.driveFolderName,
          imageText: creatives.imageText,
          imageDescription: creatives.imageDescription,
          imageReadAt: creatives.imageReadAt,
          imageReadModel: creatives.imageReadModel,
          updatedAt: creatives.updatedAt,
        })
        .from(creatives)
        .where(
          and(
            eq(creatives.clientId, clientId),
            isNull(creatives.archivedAt),
            inArray(creatives.id, ids.slice(i, i + PAGE_SIZE)),
          ),
        )),
    );
  }
  return out;
}

async function fetchActiveUpdatedAt(clientId: number): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  let lastId = 0;
  for (;;) {
    const page = await db
      .select({ id: creatives.id, updatedAt: creatives.updatedAt })
      .from(creatives)
      .where(and(eq(creatives.clientId, clientId), isNull(creatives.archivedAt), gt(creatives.id, lastId)))
      .orderBy(creatives.id)
      .limit(PAGE_SIZE);
    for (const c of page) out.set(c.id, c.updatedAt);
    if (page.length < PAGE_SIZE) break;
    lastId = page[page.length - 1]!.id;
  }
  return out;
}

const sample = (xs: Iterable<unknown>) => [...xs].slice(0, 10).join(", ");

/** Every zip member but the sheet, the text outside <sheetData> and every <row> tag must be unchanged. */
async function structureUnchanged(before: Uint8Array, after: Uint8Array): Promise<string[]> {
  const problems: string[] = [];
  const [zb, za] = await Promise.all([JSZip.loadAsync(before), JSZip.loadAsync(after)]);
  // Name, order and date of every entry (the unix mode bits JSZip cannot keep: see xlsx-sheet-patch.ts).
  const entries = (z: JSZip) => Object.values(z.files).map((f) => `${f.name} ${f.date.toISOString()}`);
  const [eb, ea] = [entries(zb), entries(za)];
  const firstDiff = eb.findIndex((e, i) => e !== ea[i]);
  if (eb.length !== ea.length || firstDiff >= 0)
    problems.push(`a zip-tagok listája, sorrendje vagy dátuma változott: "${eb[firstDiff]}" → "${ea[firstDiff]}" (${eb.length} → ${ea.length} tag)`);
  const names = (z: JSZip) => Object.values(z.files).filter((f) => !f.dir).map((f) => f.name);
  const sheetXml = (x: string) => x.match(/<sheetData>[\s\S]*<\/sheetData>/)?.[0] ?? "";
  let changedParts = 0;
  for (const name of names(zb)) {
    const [b, a] = await Promise.all([zb.file(name)!.async("string"), za.file(name)?.async("string")]);
    if (a === b) continue;
    changedParts += 1;
    const isSheet = b.includes("<sheetData>") && b.includes("<row") && a !== undefined;
    if (!isSheet) {
      problems.push(`változott: ${name}`);
      continue;
    }
    if (b.replace(sheetXml(b), "") !== a.replace(sheetXml(a), "")) problems.push(`${name}: a <sheetData>-n kívüli rész változott`);
    const tags = (x: string) => x.match(/<row\b[^>]*>/g) ?? [];
    if (tags(b).join("") !== tags(a).join("")) problems.push(`${name}: a sor-attribútumok (rejtett, magasság) változtak`);
    const formulas = (x: string) => (x.match(/<f[ >]/g) ?? []).length;
    if (formulas(b) !== formulas(a)) problems.push(`${name}: a képletek száma ${formulas(b)} → ${formulas(a)}`);
  }
  if (changedParts > 1) problems.push(`${changedParts} zip-tag változott, csak egynek szabad`);
  return problems;
}

async function main() {
  const { file, ids: idFiles, out, inPlace, remote, clientKey } = parseArgs();
  if (!file || !idFiles) throw new Error("használat: patch-mc-export.ts <xlsx> --ids <fájl>[,<fájl>…] [--out <xlsx> | --in-place] [--remote <rclone-útvonal>]");
  if (out && inPlace) throw new Error("--out vagy --in-place, nem mindkettő");
  if (!process.env.DATABASE_URL) throw new Error("nincs DATABASE_URL (futtasd --env-file=.env.local-lal)");

  const ids = [...new Set(idFiles.split(",").flatMap((f) => (fs.readFileSync(f, "utf8").match(/\d+/g) ?? []).map(Number)))];
  const [client] = await db.select().from(clients).where(eq(clients.key, clientKey)).limit(1);
  if (!client) throw new Error(`nincs ilyen kliens: ${clientKey}`);

  const original = fs.readFileSync(file);
  const originalMd5 = md5(original);
  console.log(`tábla: ${file}\n  md5 ${originalMd5}, ${original.length} bájt; célok: ${ids.length} id`);
  if (remote) {
    const r = remoteMd5(remote);
    if (r !== originalMd5) throw new Error(`a Drive-példány (${r}) nem az, amit olvastam (${originalMd5}): a mount le van maradva, vagy valaki most írta`);
    console.log("  a Drive-példány md5-je azonos");
  }

  const table = await readSheet(original, SHEET);
  for (const h of [KEY, ...Object.keys(WRITTEN)]) if (!table.columns.has(h)) throw new Error(`a "${SHEET}" lapon nincs "${h}" oszlop`);
  const sheetRows = new Map<number, Map<string, string>>();
  for (const r of table.rows) {
    const key = r.values.get(KEY);
    if (key) sheetRows.set(Number(key), r.values);
  }

  // Refusals: anything that would make a written row lie.
  const targets = await fetchTargets(client.id, ids);
  const found = new Set(targets.map((c) => c.id));
  const notActive = ids.filter((id) => !found.has(id));
  const notInSheet = targets.filter((c) => !sheetRows.has(c.id)).map((c) => c.id);
  const drift: string[] = [];
  for (const c of targets) {
    const row = sheetRows.get(c.id);
    if (!row) continue;
    for (const [header, dbValue] of Object.entries(CHECKED)) {
      if (!table.columns.has(header)) continue;
      const sheetValue = row.get(header) ?? "";
      if (sheetValue !== dbValue(c)) drift.push(`${c.id} ${header}: tábla "${sheetValue}" ≠ DB "${dbValue(c)}"`);
    }
  }

  // Warnings: rows the patch leaves as they are.
  const active = await fetchActiveUpdatedAt(client.id);
  const targetSet = new Set(ids);
  const stale: number[] = [];
  const gone: number[] = [];
  for (const [id, row] of sheetRows) {
    const dbUpdated = active.get(id);
    if (dbUpdated === undefined) gone.push(id);
    else if (!targetSet.has(id) && (row.get("updated_at") ?? "") !== dbUpdated) stale.push(id);
  }
  const missingFromSheet = [...active.keys()].filter((id) => !sheetRows.has(id));

  console.log(`ellenőrzés a DB ellen (${client.key}, ${active.size} aktív kreatív, a táblában ${sheetRows.size} sor):`);
  console.log(`  célsor nem aktív kreatív: ${notActive.length}${notActive.length ? ` (${sample(notActive)})` : ""}`);
  console.log(`  célsor nincs a táblában: ${notInSheet.length}${notInSheet.length ? ` (${sample(notInSheet)})` : ""}`);
  console.log(`  célsor más oszlopa eltér a DB-től: ${drift.length}`);
  for (const d of drift.slice(0, 10)) console.log(`    ${d}`);
  console.log(`  [jelzés] nem célsor, a DB frissebb: ${stale.length}${stale.length ? ` (${sample(stale)})` : ""}`);
  console.log(`  [jelzés] a táblában van, de már nem aktív: ${gone.length}${gone.length ? ` (${sample(gone)})` : ""}`);
  console.log(`  [jelzés] aktív, de nincs a táblában: ${missingFromSheet.length}${missingFromSheet.length ? ` (${sample(missingFromSheet)})` : ""}`);
  if (notActive.length || notInSheet.length || drift.length) {
    console.log("NEM írok: a fenti célsor-hibák előbb javítandók.");
    process.exit(1);
  }

  const updates = new Map(
    targets.map((c) => [String(c.id), Object.fromEntries(Object.entries(WRITTEN).map(([h, f]) => [h, f(c)]))]),
  );
  const patched = await patchSheetCells(original, { sheet: SHEET, keyHeader: KEY, updates });
  if (patched.missingKeys.length) throw new Error(`a patch nem talált sort: ${sample(patched.missingKeys)}`);

  // Verify the result: the target cells say what the DB says, nothing else moved.
  const problems = await structureUnchanged(original, patched.xlsx);
  const after = await readSheet(patched.xlsx, SHEET);
  const byRow = new Map(table.rows.map((r) => [r.rowNumber, r.values]));
  let otherChanged = 0;
  let targetOk = 0;
  for (const r of after.rows) {
    const before = byRow.get(r.rowNumber);
    const id = Number(r.values.get(KEY) ?? NaN);
    const isTarget = updates.has(String(id));
    for (const header of after.columns.keys()) {
      const a = r.values.get(header) ?? "";
      const b = before?.get(header) ?? "";
      if (isTarget && header in WRITTEN) continue;
      if (a !== b) otherChanged += 1;
    }
    if (isTarget && Object.entries(updates.get(String(id))!).every(([h, v]) => (r.values.get(h) ?? "") === v)) targetOk += 1;
  }
  if (after.rows.length !== table.rows.length) problems.push(`sorok száma ${table.rows.length} → ${after.rows.length}`);
  if (otherChanged) problems.push(`${otherChanged} nem célcella változott`);
  if (targetOk !== updates.size) problems.push(`célsor = DB: ${targetOk} / ${updates.size}`);
  const patchedMd5 = md5(patched.xlsx);
  console.log(`patch: ${patched.written.length} sor × ${Object.keys(WRITTEN).length} cella; célsor = DB: ${targetOk} / ${updates.size}; md5 ${patchedMd5}, ${patched.xlsx.length} bájt`);
  if (problems.length) {
    for (const p of problems) console.log(`  HIBA: ${p}`);
    console.log("NEM írok.");
    process.exit(1);
  }
  console.log("  a többi zip-tag, a <sheetData>-n kívüli rész, a sor-attribútumok és a képletek változatlanok");

  if (out) {
    fs.writeFileSync(out, patched.xlsx);
    console.log(`kiírva: ${out}`);
  }
  if (inPlace) {
    if (md5(fs.readFileSync(file)) !== originalMd5) throw new Error("a tábla változott a futás közben: nem írok");
    if (remote && remoteMd5(remote) !== originalMd5) throw new Error("a Drive-példány változott a futás közben: nem írok");
    // Truncate and write the same path — a rename would give Drive a new file.
    fs.writeFileSync(file, patched.xlsx);
    const back = md5(fs.readFileSync(file));
    if (back !== patchedMd5) throw new Error(`visszaolvasva ${back}, írva ${patchedMd5}`);
    console.log(`helyben felülírva: ${file}`);
    console.log(
      remote
        ? `a feltöltés után ellenőrizd: rclone md5sum "${remote}"  →  ${patchedMd5}`
        : `a feltöltés után ellenőrizd a Drive-on: md5 ${patchedMd5}`,
    );
  }
  if (!out && !inPlace) console.log("csak jelentés (--out vagy --in-place nélkül nem írok)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
