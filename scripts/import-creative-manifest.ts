// Fill a client's creatives from a Codex delivery's manifest.json: the text on
// the picture, its description, and the copy / visual keywords. Only empty
// fields are written; the rules and the form are in src/lib/creative-manifest.ts
// and src/lib/creative-manifest.md.
//
//   npx tsx --env-file=.env.local scripts/import-creative-manifest.ts <manifest.json> [--client erste] [--dry]
//
// Run it --dry first: it lists, file by file, the fields it would fill, the
// filled ones it leaves alone, and every file it will not write (no match,
// several matches, another MC or variant). A live run is one transaction; it
// leaves the rollback list next to the manifest, as comma-separated creative
// ids (the form patch-mc-export.ts --ids reads), named after the run's start
// time on the DB clock. Each write's before-values are in audit_log.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, nowUtc } from "@/db/schema";
import { applyCreativeManifest, type ManifestFileResult } from "@/lib/creative-manifest";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const values = new Set([get("--client")]);
  return {
    file: args.find((a) => !a.startsWith("--") && !values.has(a)),
    clientKey: get("--client") ?? "erste",
    dry: args.includes("--dry"),
  };
}

function line(r: ManifestFileResult): string {
  const at = `MC${r.mc}${r.variant} ${r.file}`;
  switch (r.status) {
    case "fill":
      return `  + ${at} (id ${r.creativeId}): tölt: ${r.fill.join(", ")}${r.kept.length ? `; marad: ${r.kept.join(", ")}` : ""}`;
    case "nothing_to_fill":
      return `  = ${at} (id ${r.creativeId}): minden kitöltve`;
    case "not_found":
      return `  – ${at}: nincs aktív kreatív ezzel a fájlnévvel`;
    case "ambiguous":
      return `  ! ${at}: több aktív kreatív ezzel a fájlnévvel (id ${r.creativeIds.join(", ")})`;
    case "mc_mismatch":
      return `  ! ${at} (id ${r.creativeId}): a kreatív ${r.found.mc === null ? "MC-szám nélküli" : `MC${r.found.mc}${r.found.variant}`}, NEM írom`;
  }
}

async function main() {
  const { file, clientKey, dry } = parseArgs();
  if (!file) throw new Error("használat: import-creative-manifest.ts <manifest.json> [--client erste] [--dry]");
  const manifestPath = path.resolve(file.replace(/^~(?=\/|$)/, os.homedir()));
  const input: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const [client] = await db.select().from(clients).where(eq(clients.key, clientKey)).limit(1);
  if (!client) throw new Error(`nincs ilyen kliens: ${clientKey}`);

  // The DB clock, before the first write: audit rows carry the same clock.
  const [{ now: startedAt }] = (await db.execute(sql`select ${nowUtc} as now`)) as unknown as [{ now: string }];

  const report = await applyCreativeManifest(db, client.id, input, { dry });

  console.log(`manifest: ${manifestPath}\nkliens: ${client.key}${dry ? "\n[SZÁRAZ] nem ír semmit" : `\nkezdés (UTC): ${startedAt}`}`);
  for (const r of report.results) console.log(line(r));

  const count = (s: ManifestFileResult["status"]) => report.results.filter((r) => r.status === s).length;
  console.log(
    `${dry ? "[SZÁRAZ] írandó" : "írva"}: ${count("fill")}, nincs mit tölteni: ${count("nothing_to_fill")}, ` +
      `nincs találat: ${count("not_found")}, többértelmű: ${count("ambiguous")}, MC-eltérés: ${count("mc_mismatch")}`,
  );

  if (report.writtenIds.length > 0) {
    const stamp = startedAt.replace(/[-:]/g, "").replace(" ", "-");
    const idsPath = manifestPath.replace(/\.json$/i, "") + `.import-${stamp}.id-lista.txt`;
    fs.writeFileSync(idsPath, report.writtenIds.join(",") + "\n");
    console.log(`rollback-lista: ${idsPath} (${report.writtenIds.length} id; az előtte-értékek az audit_log-ban)`);
  }
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e instanceof z.ZodError ? `a manifest nem felel meg a sémának:\n${z.prettifyError(e)}` : e);
  process.exit(1);
});
