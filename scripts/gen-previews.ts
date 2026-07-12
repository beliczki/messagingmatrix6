// Preview generator — one static PNG per (html message, template size).
// Run locally with the dev server up: `npm run dev` then `npm run gen:previews`.
// Writes PNGs to the shared object store (MinIO over the tunnel) and upserts
// message_previews rows, so prod sees images immediately with no box infra.
//
// Version-keyed regen: a (message, size) is shot only when it has no row or
// row.message_version != messages.version (the optimistic-lock int any edit bumps).
//
// Fidelity: renders through the SAME POST /api/render (inline:true,
// skipAnimations:true) the editor iframe uses, on the app origin so the
// injected <base href="/api/templates/…"> and /api/drive/proxy image URLs
// resolve with an authenticated session cookie. The screenshot is gated on
// #preloader DETACHING from the DOM (the template hides it, restores the
// saved ad-container classes, then removes it 400ms later) — snapping on
// `load` would capture the preloader overlay.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { and, eq, isNull } from "drizzle-orm";
import { chromium } from "playwright";
import { db } from "../src/db";
import { messagePreviews, users, nowUtc } from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";
import { signSession } from "../src/lib/auth";
import { mcLabelFor } from "../src/lib/mc-label";
import { collectStalePreviews, type StalePreview } from "../src/lib/previews";
import { writeFile as writeStorageFile, deleteStorageFile } from "../src/lib/storage";

const BASE_URL = process.env.PREVIEW_BASE_URL ?? "http://localhost:6001";
const PRELOADER_TIMEOUT_MS = 15_000;

async function findLiveUserToken(clientId: number): Promise<string> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.clientId, clientId), isNull(users.archivedAt)))
    .limit(1);
  if (!user) {
    throw new Error("no live user for the active client — cannot mint a session");
  }
  return signSession(user);
}

async function renderHtml(token: string, item: StalePreview): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/render`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      templateName: item.message.template,
      size: item.size,
      message: item.message,
      inline: true,
      skipAnimations: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`render ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.text();
}

async function main() {
  const client = await getActiveClient();
  console.log(`Active client: ${client.key} (id=${client.id}), app: ${BASE_URL}`);

  // Fail fast when the dev server isn't up.
  const ping = await fetch(BASE_URL, { redirect: "manual" }).catch(() => null);
  if (!ping) {
    throw new Error(`app not reachable at ${BASE_URL} — start it with \`npm run dev\``);
  }

  const force = process.argv.includes("--force");
  const token = await findLiveUserToken(client.id);
  const { stale, fresh } = await collectStalePreviews(client.id, { force });
  console.log(
    `Previews up to date: ${fresh}. To generate: ${stale.length}${force ? " (--force)" : ""}.`,
  );
  if (stale.length === 0) return;

  const browser = await chromium.launch();
  const context = await browser.newContext();
  // Session cookie so the page's subresource requests (/api/templates/…,
  // /api/drive/proxy/…) pass withSession.
  await context.addCookies([
    { name: "auth_token", value: token, url: BASE_URL },
  ]);

  let shot = 0;
  const failed: string[] = [];
  const previewUrl = `${BASE_URL}/__mm6_preview__`;
  let currentHtml = "";
  const page = await context.newPage();
  await page.route(previewUrl, (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: currentHtml }),
  );

  for (const item of stale) {
    const label = `${mcLabelFor(item.message)} ${item.size}`;
    const [w, h] = item.size.split("x").map(Number);
    try {
      currentHtml = await renderHtml(token, item);
      await page.setViewportSize({ width: w!, height: h! });
      await page.goto(previewUrl, { waitUntil: "load" });
      await page.waitForSelector("#preloader", {
        state: "detached",
        timeout: PRELOADER_TIMEOUT_MS,
      });
      const buf = await page.screenshot({
        clip: { x: 0, y: 0, width: w!, height: h! },
      });

      const stored = await writeStorageFile(buf, "preview", ".png");
      if (item.existing) {
        await db
          .update(messagePreviews)
          .set({
            storageKey: stored.storagePath,
            messageVersion: item.message.version,
            updatedAt: nowUtc,
          })
          .where(eq(messagePreviews.id, item.existing.id));
        // Old object only after the row points at the new one — no orphan risk.
        await deleteStorageFile(item.existing.storageKey);
      } else {
        await db.insert(messagePreviews).values({
          clientId: client.id,
          messageId: item.message.id,
          size: item.size,
          storageKey: stored.storagePath,
          messageVersion: item.message.version,
        });
      }
      shot++;
      console.log(`  ✓ ${label}`);
    } catch (e) {
      failed.push(label);
      console.error(`  ✗ ${label}: ${(e as Error).message}`);
    }
  }

  await browser.close();
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
