// Export one MC's HTML render as standalone bundles — one folder per size,
// each runnable straight from disk (file://) with its assets copied alongside.
//
//   npm run export:bundle -- MC411a --out ~/Downloads/bird
//   npm run export:bundle -- --id 36201 --out ~/Downloads/bird
//
// The HTML is the same render the editor's HTML preview shows (renderTemplate,
// inline mode: main.css + the size CSS inlined, the client's text_formatting
// applied, the message's custom CSS in). Two things make it standalone:
//   - the <base href> inline mode injects (an absolute /api/templates/<name>/
//     URL, so srcDoc can resolve relative refs) is dropped — the template's
//     own files (dynamic.content.js, thm.json, …) are copied next to it;
//   - /api/drive/proxy/<file> refs become plain relative <file>, and the bytes
//     come from storage (the same lookup the proxy route does).
// External refs (Google Fonts, the commented-out Adform libs) stay as they are.
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
import { renderTemplate } from "../src/lib/render";
import { listTemplateFiles, readTemplate, readTemplateFile } from "../src/lib/templates";
import { listTextFormatting } from "../src/lib/entities/text-formatting";
import { getFileByFilename } from "../src/lib/entities/files";
import { readFileBytes } from "../src/lib/storage";

const PROXY_PREFIX = "/api/drive/proxy/";

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
  if (!message.template) throw new Error(`${label} has no template — nothing to render`);
  const template = readTemplate(message.template);
  if (!template || template.kind !== "html") {
    throw new Error(`template "${message.template}" is missing or not an html template`);
  }
  // main.css and the size CSS are inlined by the render; index.html and
  // template.json are inputs, not part of the bundle.
  const templateFiles = listTemplateFiles(message.template)!.filter(
    (f) =>
      !f.size &&
      f.name !== "index.html" &&
      f.name !== "template.json" &&
      f.name !== "main.css",
  );
  const textFormatting = await listTextFormatting(client.id);

  for (const size of template.sizes) {
    const dir = path.join(args.out, size);
    fs.mkdirSync(dir, { recursive: true });

    let { html } = renderTemplate({
      templateName: message.template,
      size,
      message: message as unknown as Record<string, unknown>,
      textFormatting,
      inline: true,
    });
    html = html.replace(/<base\s+href="[^"]*\/api\/templates\/[^"]*">\s*/i, "");

    for (const f of templateFiles) {
      fs.writeFileSync(path.join(dir, f.name), readTemplateFile(message.template, f.name)!);
    }

    // Every proxied creative file the render references — collected from the
    // HTML itself, so whatever placeholder emitted it is covered.
    const proxied = new Set<string>();
    html = html.replace(/\/api\/drive\/proxy\/([^"'()\s]+)/g, (_, enc: string) => {
      const name = decodeURIComponent(enc);
      proxied.add(name);
      return encodeURI(name);
    });
    for (const name of proxied) {
      const file = await getFileByFilename(client.id, name);
      if (!file) throw new Error(`${label} ${size}: ${name} is not an uploaded file in this client`);
      fs.writeFileSync(path.join(dir, name), await readFileBytes(file.storagePath));
    }
    if (html.includes(PROXY_PREFIX)) {
      throw new Error(`${label} ${size}: a ${PROXY_PREFIX} ref survived the rewrite`);
    }

    fs.writeFileSync(path.join(dir, "index.html"), html);
    console.log(
      `${size}: index.html + ${templateFiles.length} template file(s) + ${proxied.size} creative file(s)`,
    );
  }
  console.log(`wrote ${label} (${message.template}) → ${args.out}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
