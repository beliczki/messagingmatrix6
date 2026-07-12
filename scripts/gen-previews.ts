// Preview generator CLI — one static PNG per (html message, template size).
// Run locally with the dev server up: `npm run dev` then `npm run gen:previews`.
// Writes PNGs to the shared object store (MinIO over the tunnel) and upserts
// message_previews rows, so prod sees images immediately.
//
// Version-keyed regen: a (message, size) is shot only when it has no row or
// row.message_version != messages.version; `-- --force` reshoots everything
// (render/template changes and THM copy drift don't bump versions).
//
// All shooting logic lives in src/lib/preview-shooter.ts — shared with the
// on-demand callers (POST /api/previews/generate, MCP preview_generate).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { getActiveClient } from "../src/lib/active-client";
import { mcLabelFor } from "../src/lib/mc-label";
import { collectStalePreviews } from "../src/lib/previews";
import { shootPreviews } from "../src/lib/preview-shooter";

const BASE_URL = process.env.PREVIEW_BASE_URL ?? "http://localhost:6001";

async function main() {
  const client = await getActiveClient();
  console.log(`Active client: ${client.key} (id=${client.id}), app: ${BASE_URL}`);

  // Fail fast when the dev server isn't up (the page's subresources need it).
  const ping = await fetch(BASE_URL, { redirect: "manual" }).catch(() => null);
  if (!ping) {
    throw new Error(`app not reachable at ${BASE_URL} — start it with \`npm run dev\``);
  }

  const force = process.argv.includes("--force");
  const { stale, fresh } = await collectStalePreviews(client.id, { force });
  console.log(
    `Previews up to date: ${fresh}. To generate: ${stale.length}${force ? " (--force)" : ""}.`,
  );
  if (stale.length === 0) return;

  const labelById = new Map(
    stale.map((it) => [it.message.id, mcLabelFor(it.message)]),
  );
  const failed: string[] = [];
  let shot = 0;
  await shootPreviews(client.id, stale, {
    baseUrl: BASE_URL,
    onShot: (r) => {
      const label = `${labelById.get(r.messageId)} ${r.size}`;
      if (r.ok) {
        shot++;
        console.log(`  ✓ ${label}`);
      } else {
        failed.push(label);
        console.error(`  ✗ ${label}: ${r.error}`);
      }
    },
  });

  console.log(
    `Done. Shot ${shot}, skipped ${fresh} (fresh), failed ${failed.length}${
      failed.length ? `:\n  ${failed.join("\n  ")}` : "."
    }`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
