// Fill in the Drive links of already-imported creatives from the delivery
// folder links you paste. Folder -> children is the only direction the Drive
// API key can walk (a file never reveals its parent), so the folders are the
// input: every file inside one is matched against creatives.file_name.
//
// Dry run by default — nothing is written until you pass --apply.
//
// Usage:
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/drive-backfill.ts <folder-link> [...]
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/drive-backfill.ts --file links.txt --apply
//   ... --overwrite   also repoint creatives that already claim another folder

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { readFileSync } from "node:fs";
import { getActiveClient } from "../src/lib/active-client";
import { parseDriveFolderId, driveFolderUrl } from "../src/lib/drive-link";
import { linkCreativesFromFolders } from "../src/lib/drive-resolve";

type Args = { links: string[]; apply: boolean; overwrite: boolean };

function parseArgs(argv: string[]): Args {
  const out: Args = { links: [], apply: false, overwrite: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--apply") out.apply = true;
    else if (a === "--overwrite") out.overwrite = true;
    else if (a === "--file") {
      const content = readFileSync(argv[++i]!, "utf8");
      out.links.push(...content.split(/\r?\n/));
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: ACTIVE_CLIENT_KEY=erste npx tsx scripts/drive-backfill.ts <folder-link> [...] [--file links.txt] [--apply] [--overwrite]",
      );
      process.exit(0);
    } else if (a.startsWith("--")) {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    } else {
      out.links.push(a);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const folderIds: string[] = [];
  const rejected: string[] = [];
  for (const raw of args.links) {
    const line = raw.trim();
    if (line === "") continue;
    const id = parseDriveFolderId(line);
    if (id) {
      if (!folderIds.includes(id)) folderIds.push(id);
    } else {
      rejected.push(line);
    }
  }
  if (rejected.length > 0) {
    console.error(`Not Drive folder links (${rejected.length}):`);
    for (const r of rejected) console.error(`  ${r}`);
    process.exit(2);
  }
  if (folderIds.length === 0) {
    console.error("No folder links given. Pass links as arguments or via --file.");
    process.exit(2);
  }

  const client = await getActiveClient();
  console.log(
    `Client: ${client.key} (id=${client.id}) · folders: ${folderIds.length} · ${args.apply ? "APPLY" : "dry run"}${args.overwrite ? " · overwrite" : ""}`,
  );

  const report = await linkCreativesFromFolders(client.id, folderIds, {
    apply: args.apply,
    overwrite: args.overwrite,
  });

  for (const folderId of report.unreachableFolders) {
    console.error(
      `UNREACHABLE ${driveFolderUrl(folderId)} — not shared "anyone with the link" (a share viewer would get a request-access page).`,
    );
  }
  for (const r of report.results) {
    if (r.outcome === "unchanged") continue;
    console.log(
      `${r.outcome.padEnd(18)} ${r.fileName}${r.creativeId ? ` -> creative ${r.creativeId}` : ""}`,
    );
  }
  console.log(
    `\n${args.apply ? "written" : "would write"}: ${report.counts.linked} · unchanged: ${report.counts.unchanged} · conflict: ${report.counts.conflict} · ambiguous creative: ${report.counts.ambiguous_creative} · no creative: ${report.counts.no_creative} · unreachable folders: ${report.unreachableFolders.length}`,
  );
  if (!args.apply && report.counts.linked > 0) {
    console.log("Dry run — re-run with --apply to write these.");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
