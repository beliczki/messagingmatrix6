// Preview shooting — shared by scripts/gen-previews.ts (bulk CLI), the
// on-demand callers (POST /api/previews/generate, MCP preview_generate) and
// draft renders (MCP generate_test_creative via entities/drafts.ts).
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
// batches / draft renders queue behind one Chromium instead of launching
// several.
//
// Persistence lives on the item (`persist` callback): message previews upsert
// message_previews (shootPreviews below), drafts insert draft_previews. The
// shooter itself only renders, screenshots, and hands over the PNG.
//
// `shootUrl` is the other mode: a frame of a page that already exists at a URL
// (an HTML5 package's poster), on the same mutex.
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
  | { ok: true; previewId: number; updatedAt: string }
  | { ok: false; error: string }
);

// Generic shoot unit: a message-shaped `row` renderTemplate binds against
// (template, headline, image1…, customCss — draft_messages rows qualify
// as-is), plus the persistence for the resulting PNG.
export type ShootItem = {
  template: string;
  row: Record<string, unknown>;
  size: string;
  persist: (buf: Buffer) => Promise<{ id: number; updatedAt: string }>;
};

export type ItemShotResult = { size: string } & (
  | { ok: true; id: number; updatedAt: string }
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

export function defaultBaseUrl(): string {
  return (
    process.env.PREVIEW_BASE_URL ??
    `http://127.0.0.1:${process.env.PORT ?? "6001"}`
  );
}

// Serializes shoot runs. Failures are swallowed on the chain (each caller
// still gets its own rejection through the returned promise).
let chain: Promise<unknown> = Promise.resolve();

export async function shootItems(
  clientId: number,
  items: ShootItem[],
  opts: { baseUrl?: string; onShot?: (r: ItemShotResult, index: number) => void } = {},
): Promise<ItemShotResult[]> {
  const run = chain.catch(() => {}).then(() => shootRun(clientId, items, opts));
  chain = run.catch(() => {});
  return run;
}

/**
 * One frame of an arbitrary page — an uploaded HTML5 package's poster. Runs on
 * the same mutex as the preview shoots, so a poster never launches a second
 * Chromium beside a batch. The URL must be self-authorizing (a signed /pkg
 * link): no session cookie is set, and a sandboxed package would not send one
 * for its assets anyway.
 */
export async function shootUrl(url: string, width: number, height: number): Promise<Buffer> {
  const run = chain.catch(() => {}).then(() => shootUrlRun(url, width, height));
  chain = run.catch(() => {});
  return run;
}

async function shootUrlRun(url: string, width: number, height: number): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(url, { waitUntil: "load" });
    // An mm6-built package (export:bundle) hides behind a preloader until its
    // images are in; the frame before that is the logo on a flat colour.
    if (await page.$("#preloader")) {
      await page.waitForSelector("#preloader", {
        state: "detached",
        timeout: PRELOADER_TIMEOUT_MS,
      });
    }
    // The poster is the package at rest: every finite CSS/Web animation is
    // jumped to its end state rather than waited for. Waiting cannot tell an
    // intro from a slow ambient loop (a sticker wobbling 3.5 × 10 s is finite
    // too), while finish() lands each one where its author made it stop —
    // instantly, the same frame every time. Infinite loops are left running;
    // JS-driven animation is shot as it stands.
    await page.evaluate(() => {
      for (const a of document.getAnimations()) {
        if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish();
      }
    });
    return await page.screenshot({ clip: { x: 0, y: 0, width, height } });
  } finally {
    await browser.close();
  }
}

// Message-preview shooting: wraps shootItems with the message_previews
// upsert as the persist step. Signature unchanged for the existing callers.
export async function shootPreviews(
  clientId: number,
  items: StalePreview[],
  opts: { baseUrl?: string; onShot?: (r: ShotResult) => void } = {},
): Promise<ShotResult[]> {
  const toShotResult = (item: StalePreview, r: ItemShotResult): ShotResult =>
    r.ok
      ? {
          messageId: item.message.id,
          size: r.size,
          ok: true,
          previewId: r.id,
          updatedAt: r.updatedAt,
        }
      : { messageId: item.message.id, size: r.size, ok: false, error: r.error };

  const shootList: ShootItem[] = items.map((item) => ({
    template: item.message.template!,
    row: item.message as unknown as Record<string, unknown>,
    size: item.size,
    persist: async (buf) => {
      const stored = await writeStorageFile(buf, "preview", ".png");
      if (item.existing) {
        const [updated] = await db
          .update(messagePreviews)
          .set({
            storageKey: stored.storagePath,
            messageVersion: item.message.version,
            updatedAt: nowUtc,
          })
          .where(eq(messagePreviews.id, item.existing.id))
          .returning({ updatedAt: messagePreviews.updatedAt });
        // Old object only after the row points at the new one — no orphan risk.
        await deleteStorageFile(item.existing.storageKey);
        return { id: item.existing.id, updatedAt: updated!.updatedAt };
      }
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
      return { id: row!.id, updatedAt: row!.updatedAt };
    },
  }));

  const results = await shootItems(clientId, shootList, {
    baseUrl: opts.baseUrl,
    onShot: opts.onShot
      ? (r, i) => opts.onShot!(toShotResult(items[i]!, r))
      : undefined,
  });
  return results.map((r, i) => toShotResult(items[i]!, r));
}

async function shootRun(
  clientId: number,
  items: ShootItem[],
  opts: { baseUrl?: string; onShot?: (r: ItemShotResult, index: number) => void },
): Promise<ItemShotResult[]> {
  if (items.length === 0) return [];
  const baseUrl = opts.baseUrl ?? defaultBaseUrl();
  const token = await mintPreviewToken(clientId);
  const textFormatting = await listTextFormatting(clientId);

  const browser = await chromium.launch();
  const results: ItemShotResult[] = [];
  try {
    const context = await browser.newContext();
    await context.addCookies([{ name: "auth_token", value: token, url: baseUrl }]);
    const page = await context.newPage();
    const previewUrl = `${baseUrl}/__mm6_preview__`;
    let currentHtml = "";
    await page.route(previewUrl, (route) =>
      route.fulfill({ contentType: "text/html; charset=utf-8", body: currentHtml }),
    );

    for (const [index, item] of items.entries()) {
      const [w, h] = item.size.split("x").map(Number);
      try {
        currentHtml = renderTemplate({
          templateName: item.template,
          size: item.size,
          message: item.row,
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

        const persisted = await item.persist(buf);
        const r: ItemShotResult = {
          size: item.size,
          ok: true,
          id: persisted.id,
          updatedAt: persisted.updatedAt,
        };
        results.push(r);
        opts.onShot?.(r, index);
      } catch (e) {
        const r: ItemShotResult = {
          size: item.size,
          ok: false,
          error: (e as Error).message,
        };
        results.push(r);
        opts.onShot?.(r, index);
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}
