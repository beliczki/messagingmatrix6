// Export one MC's HTML render as standalone bundles — one folder per size,
// each runnable straight from disk (file://) with its assets copied alongside.
//
//   npm run export:bundle -- MC411a --out ~/Downloads/bird
//   npm run export:bundle -- --id 36201 --out ~/Downloads/bird
//
// The HTML is the same render the editor's HTML preview shows, made standalone
// by renderBundle (src/lib/html5-bundle.ts — the share gallery's Download uses
// the same transform). External refs (Google Fonts, the commented-out Adform
// libs) stay as they are; cleanup:bundle makes the hand-off copy.
//
// One MC can live on several audience rows; then --id picks the row.
// Read-only against the DB. ACTIVE_CLIENT_KEY picks the client (npm script: erste).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { messages } from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";
import { readTemplate } from "../src/lib/templates";
import { listTextFormatting } from "../src/lib/entities/text-formatting";
import { renderBundle } from "../src/lib/html5-bundle";

function parseArgs(argv: string[]) {
  let mc: string | null = null;
  let id: number | null = null;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === "--id") id = Number(argv[++i]);
    else if (a === "--out") out = argv[++i] ?? null;
    else mc = a;
  }
  if (!out || (!mc && !id)) {
    throw new Error("usage: export-html-bundle (MC411a | --id <messageId>) --out <dir>");
  }
  return {
    mc,
    id,
    out: path.resolve(out.replace(/^~(?=\/|$)/, os.homedir())),
  };
}

async function loadMessage(clientId: number, mc: string | null, id: number | null) {
  if (id !== null) {
    const [row] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.clientId, clientId), eq(messages.id, id)));
    if (!row) throw new Error(`message id ${id} not found in this client`);
    return row;
  }
  const m = mc!.match(/^(?:MC)?(\d+)([a-z]+)$/i);
  if (!m) throw new Error(`not an MC label: ${mc} (expected e.g. MC411a)`);
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        eq(messages.number, Number(m[1])),
        eq(messages.variant, m[2]!.toLowerCase()),
      ),
    );
  if (rows.length === 0) throw new Error(`${mc} not found in this client`);
  if (rows.length > 1) {
    const list = rows.map((r) => `${r.id} (${r.audience ?? "draft"}, ${r.status})`);
    throw new Error(`${mc} has ${rows.length} rows — pick one with --id: ${list.join(", ")}`);
  }
  return rows[0]!;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = await getActiveClient();
  const message = await loadMessage(client.id, args.mc, args.id);
  const label = `MC${message.number}${message.variant}`;
  const template = message.template ? readTemplate(message.template) : null;
  if (!template) throw new Error(`${label} has no template — nothing to render`);
  const textFormatting = await listTextFormatting(client.id);

  for (const size of template.sizes) {
    const dir = path.join(args.out, size);
    fs.mkdirSync(dir, { recursive: true });
    const files = await renderBundle({ clientId: client.id, message, size, textFormatting });
    for (const [name, bytes] of files) fs.writeFileSync(path.join(dir, name), bytes);
    console.log(`${size}: ${[...files.keys()].join(", ")}`);
  }
  console.log(`wrote ${label} (${message.template}) → ${args.out}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
