// Preview shooting — shared by scripts/gen-previews.ts (bulk CLI) and the
// on-demand callers (POST /api/previews/generate, MCP preview_generate).
//
// Renders in-process via renderTemplate (the same function POST /api/render
// calls), then screenshots in headless Chromium. The page is served on the
// app's own origin so the injected <base href="/api/templates/…"> and
// /api/drive/proxy image URLs resolve, authenticated by a minted session
// cookie. The screenshot is gated on #preloader DETACHING from the DOM (the
// template hides it, restores the saved ad-container classes, then removes it
// 400ms later) — snapping on `load` would capture the preloader overlay.
//
// Runs are serialized by a module-level mutex: concurrent editor clicks / MCP
// batches queue behind one Chromium instead of launching several.
import { and, eq, isNull } from "drizzle-orm";
import { chromium } from "playwright";
import { db } from "@/db";
import { messagePreviews, users, nowUtc } from "@/db/schema";
import { signSession } from "@/lib/auth";
import { listTextFormatting } from "@/lib/entities/text-formatting";
import { renderTemplate } from "@/lib/render";
import type { StalePreview } from "@/lib/previews";
import { writeFile as writeStorageFile, deleteStorageFile } from "@/lib/storage";

const PRELOADER_TIMEOUT_MS = 15_000;

export type ShotResult = { messageId: number; size: string } & (
  | { ok: true; previewId: number }
  | { ok: false; error: string }
);

// The page's subresource requests (/api/templates/…, /api/drive/proxy/…) go
// through withSession — mint a JWT from the first live user of the client.
export async function mintPreviewToken(clientId: number): Promise<string> {
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

function defaultBaseUrl(): string {
  return (
    process.env.PREVIEW_BASE_URL ??
    `http://127.0.0.1:${process.env.PORT ?? "6001"}`
  );
}

// Serializes shootPreviews runs. Failures are swallowed on the chain (each
// caller still gets its own rejection through the returned promise).
let chain: Promise<unknown> = Promise.resolve();

export async function shootPreviews(
  clientId: number,
  items: StalePreview[],
  opts: { baseUrl?: string; onShot?: (r: ShotResult) => void } = {},
): Promise<ShotResult[]> {
  const run = chain.catch(() => {}).then(() => shootRun(clientId, items, opts));
  chain = run.catch(() => {});
  return run;
}

async function shootRun(
  clientId: number,
  items: StalePreview[],
  opts: { baseUrl?: string; onShot?: (r: ShotResult) => void },
): Promise<ShotResult[]> {
  if (items.length === 0) return [];
  const baseUrl = opts.baseUrl ?? defaultBaseUrl();
  const token = await mintPreviewToken(clientId);
  const textFormatting = await listTextFormatting(clientId);

  const browser = await chromium.launch();
  const results: ShotResult[] = [];
  try {
    const context = await browser.newContext();
    await context.addCookies([{ name: "auth_token", value: token, url: baseUrl }]);
    const page = await context.newPage();
    const previewUrl = `${baseUrl}/__mm6_preview__`;
    let currentHtml = "";
    await page.route(previewUrl, (route) =>
      route.fulfill({ contentType: "text/html; charset=utf-8", body: currentHtml }),
    );

    for (const item of items) {
      const [w, h] = item.size.split("x").map(Number);
      try {
        currentHtml = renderTemplate({
          templateName: item.message.template!,
          size: item.size,
          message: item.message as unknown as Record<string, unknown>,
          textFormatting,
          inline: true,
          skipAnimations: true,
        }).html;
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
        let previewId: number;
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
          previewId = item.existing.id;
        } else {
          const [row] = await db
            .insert(messagePreviews)
            .values({
              clientId,
              messageId: item.message.id,
              size: item.size,
              storageKey: stored.storagePath,
              messageVersion: item.message.version,
            })
            .returning();
          previewId = row!.id;
        }
        const r: ShotResult = { messageId: item.message.id, size: item.size, ok: true, previewId };
        results.push(r);
        opts.onShot?.(r);
      } catch (e) {
        const r: ShotResult = {
          messageId: item.message.id,
          size: item.size,
          ok: false,
          error: (e as Error).message,
        };
        results.push(r);
        opts.onShot?.(r);
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}
