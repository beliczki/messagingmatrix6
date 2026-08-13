import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  audiences,
  clients,
  draftMessages,
  draftPreviews,
  messages,
  topics,
  uploadedFiles,
} from "@/db/schema";
import type { ShootItem } from "@/lib/preview-shooter";
import { createTestDb, type TestDb } from "../helpers/test-db";

// The chromium shoot is not vitest-testable (needs a browser and a running
// server) — shootItems is mocked; the default implementation "succeeds" by
// invoking each item's persist with a fake PNG, which exercises the real
// draft_previews insert path.
vi.mock("@/lib/preview-shooter", () => ({
  shootItems: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  writeFile: vi.fn(),
  deleteStorageFile: vi.fn(async () => {}),
}));

import { shootItems } from "@/lib/preview-shooter";
import { writeFile, deleteStorageFile } from "@/lib/storage";
import {
  DraftError,
  createDraft,
  deleteDraft,
  getDraftStatus,
  listDrafts,
  promoteDraft,
  startDraftRender,
} from "@/lib/entities/drafts";

let h: TestDb;
let erste: { id: number };
let storedCounter = 0;

function mockAllShotsSucceed() {
  vi.mocked(shootItems).mockImplementation(async (_clientId, items: ShootItem[]) => {
    const out = [];
    for (const item of items) {
      const persisted = await item.persist(Buffer.from("png"));
      out.push({ size: item.size, ok: true as const, ...persisted });
    }
    return out;
  });
}

async function seedFile(filename: string) {
  await db.insert(uploadedFiles).values({
    id: `f-${filename}`,
    clientId: erste.id,
    filename,
    originalFilename: filename,
    storagePath: `asset/${filename}`,
    category: "asset",
  });
}

function baseInput(over: Record<string, unknown> = {}) {
  return {
    template: "html",
    sizes: ["300x250", "970x250"],
    headline: "Draft headline",
    ...over,
  } as Parameters<typeof createDraft>[1];
}

beforeEach(async () => {
  vi.mocked(shootItems).mockClear();
  vi.mocked(deleteStorageFile).mockClear();
  mockAllShotsSucceed();
  storedCounter = 0;
  vi.mocked(writeFile).mockImplementation(async () => ({
    storagePath: `previews/draft-${++storedCounter}.png`,
    sha256: "test-sha",
    sizeBytes: 3,
  }));
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
});

describe("createDraft validation", () => {
  it("rejects an unknown template", async () => {
    await expect(
      createDraft(erste.id, baseInput({ template: "no-such-template" })),
    ).rejects.toThrow(/not found/);
  });

  it("rejects a non-html template", async () => {
    await expect(
      createDraft(erste.id, baseInput({ template: "figma-sample", sizes: ["300x250"] })),
    ).rejects.toThrow(/kind 'figma'/);
  });

  it("collects every problem into one error (size + tag + missing image)", async () => {
    const err = await createDraft(
      erste.id,
      baseInput({
        sizes: ["300x250", "111x111"],
        templateVariantClasses: "fullSurfaceImage notAClass",
        image1: "missing.png",
      }),
    ).catch((e: DraftError) => e);
    expect(err).toBeInstanceOf(DraftError);
    expect((err as Error).message).toMatch(/unknown size\(s\) 111x111/);
    expect((err as Error).message).toMatch(/notAClass/);
    expect((err as Error).message).toMatch(/missing\.png/);
    // valid tokens must not be flagged
    expect((err as Error).message).not.toMatch(/fullSurfaceImage —/);
    expect(await db.select().from(draftMessages)).toHaveLength(0);
  });

  it("accepts a valid draft with an existing image and fills defaults", async () => {
    await seedFile("bg.png");
    const draft = await createDraft(
      erste.id,
      baseInput({ image1: "bg.png", templateVariantClasses: "fullSurfaceImage teal" }),
    );
    expect(draft).toMatchObject({
      template: "html",
      renderStatus: "pending",
      promotedMessageId: null,
      version: 1,
      image1: "bg.png",
    });
    expect(JSON.parse(draft.sizes)).toEqual(["300x250", "970x250"]);
  });
});

describe("startDraftRender", () => {
  it("persists one draft_previews row per size and finishes 'done'", async () => {
    const draft = await createDraft(erste.id, baseInput());
    await startDraftRender(erste.id, draft);

    const previews = await db.select().from(draftPreviews);
    expect(previews).toHaveLength(2);
    expect(previews.map((p) => p.size).sort()).toEqual(["300x250", "970x250"]);

    const [after] = await db
      .select()
      .from(draftMessages)
      .where(eq(draftMessages.id, draft.id));
    expect(after).toMatchObject({ renderStatus: "done", renderError: null });
    expect(after!.renderStartedAt).toBeTruthy();
  });

  it("keeps 'done' with a per-size errors map on partial failure", async () => {
    vi.mocked(shootItems).mockImplementation(async (_c, items: ShootItem[]) => {
      const [first, ...rest] = items;
      const persisted = await first!.persist(Buffer.from("png"));
      return [
        { size: first!.size, ok: true as const, ...persisted },
        ...rest.map((it) => ({
          size: it.size,
          ok: false as const,
          error: "preloader timeout",
        })),
      ];
    });
    const draft = await createDraft(erste.id, baseInput());
    await startDraftRender(erste.id, draft);

    const [after] = await db
      .select()
      .from(draftMessages)
      .where(eq(draftMessages.id, draft.id));
    expect(after!.renderStatus).toBe("done");
    expect(JSON.parse(after!.renderError!)).toEqual({
      "970x250": "preloader timeout",
    });
  });

  it("finishes 'failed' when no size succeeded", async () => {
    vi.mocked(shootItems).mockImplementation(async (_c, items: ShootItem[]) =>
      items.map((it) => ({ size: it.size, ok: false as const, error: "boom" })),
    );
    const draft = await createDraft(erste.id, baseInput());
    await startDraftRender(erste.id, draft);

    const [after] = await db
      .select()
      .from(draftMessages)
      .where(eq(draftMessages.id, draft.id));
    expect(after!.renderStatus).toBe("failed");
    expect(Object.keys(JSON.parse(after!.renderError!))).toHaveLength(2);
  });
});

describe("getDraftStatus", () => {
  it("derives percent and done count from draft_previews rows", async () => {
    const draft = await createDraft(erste.id, baseInput());
    await db.insert(draftPreviews).values({
      clientId: erste.id,
      draftId: draft.id,
      size: "300x250",
      storageKey: "previews/one.png",
    });
    const status = (await getDraftStatus(erste.id, draft.id))!;
    expect(status).toMatchObject({
      totalSizes: 2,
      doneSizes: 1,
      percent: 50,
      status: "pending",
    });
  });

  it("reports 'stalled' when rendering exceeded the threshold with sizes missing", async () => {
    const draft = await createDraft(erste.id, baseInput());
    const oldTs = new Date(Date.now() - 11 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    await db
      .update(draftMessages)
      .set({ renderStatus: "rendering", renderStartedAt: oldTs })
      .where(eq(draftMessages.id, draft.id));
    const status = (await getDraftStatus(erste.id, draft.id))!;
    expect(status.status).toBe("stalled");
    expect(status.elapsedSeconds).toBeGreaterThan(600);
  });

  it("returns null for an unknown draft", async () => {
    expect(await getDraftStatus(erste.id, 99999)).toBeNull();
  });
});

describe("listDrafts / deleteDraft", () => {
  it("hides promoted drafts by default, shows them with includePromoted", async () => {
    const a = await createDraft(erste.id, baseInput());
    const b = await createDraft(erste.id, baseInput());
    const [msg] = await db
      .insert(messages)
      .values({ clientId: erste.id, number: 1, variant: "a", audience: "x", topic: "y" })
      .returning();
    await db
      .update(draftMessages)
      .set({ promotedMessageId: msg!.id })
      .where(eq(draftMessages.id, a.id));

    const plain = await listDrafts(erste.id);
    expect(plain.map((d) => d.id)).toEqual([b.id]);
    const all = await listDrafts(erste.id, { includePromoted: true });
    expect(all.map((d) => d.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("refuses a stale version and reports the current row", async () => {
    const draft = await createDraft(erste.id, baseInput());
    const res = await deleteDraft(erste.id, draft.id, draft.version + 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.current?.id).toBe(draft.id);
  });

  it("deletes the row, cascades previews, and purges storage objects", async () => {
    const draft = await createDraft(erste.id, baseInput());
    await startDraftRender(erste.id, draft);
    const res = await deleteDraft(erste.id, draft.id, draft.version);
    expect(res.ok).toBe(true);
    expect(await db.select().from(draftMessages)).toHaveLength(0);
    expect(await db.select().from(draftPreviews)).toHaveLength(0);
    expect(vi.mocked(deleteStorageFile).mock.calls.map((c) => c[0]).sort()).toEqual([
      "previews/draft-1.png",
      "previews/draft-2.png",
    ]);
  });
});

describe("promoteDraft", () => {
  async function seedCell() {
    await db.insert(audiences).values({
      clientId: erste.id,
      key: "VAL_x",
      name: "Val X",
      orderIndex: 1,
    });
    await db.insert(topics).values({
      clientId: erste.id,
      key: "topic_one",
      name: "Topic One",
      orderIndex: 1,
    });
  }

  it("creates a matrix message with the draft's fields and back-links it", async () => {
    await seedCell();
    await seedFile("bg.png");
    const draft = await createDraft(
      erste.id,
      baseInput({
        image1: "bg.png",
        cta: "Érdekel",
        templateVariantClasses: "fullSurfaceImage teal",
        customCss: ".x{color:red}",
      }),
    );
    const { message, draft: updated } = await promoteDraft(erste.id, draft.id, {
      audienceKey: "VAL_x",
      topicKey: "topic_one",
    });
    expect(message).toMatchObject({
      audience: "VAL_x",
      topic: "topic_one",
      template: "html",
      headline: "Draft headline",
      cta: "Érdekel",
      image1: "bg.png",
      templateVariantClasses: "fullSurfaceImage teal",
      customCss: ".x{color:red}",
      number: 1,
      variant: "a",
    });
    expect(updated.promotedMessageId).toBe(message.id);
    expect(updated.version).toBe(draft.version + 1);
  });

  it("refuses a second promotion", async () => {
    await seedCell();
    const draft = await createDraft(erste.id, baseInput());
    await promoteDraft(erste.id, draft.id, {
      audienceKey: "VAL_x",
      topicKey: "topic_one",
    });
    await expect(
      promoteDraft(erste.id, draft.id, {
        audienceKey: "VAL_x",
        topicKey: "topic_one",
      }),
    ).rejects.toThrow(/already promoted/);
  });

  it("rejects unknown audience/topic through createMessage", async () => {
    const draft = await createDraft(erste.id, baseInput());
    await expect(
      promoteDraft(erste.id, draft.id, {
        audienceKey: "nope",
        topicKey: "nope",
      }),
    ).rejects.toThrow(/audience 'nope' not found/);
  });
});
