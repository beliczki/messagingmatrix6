import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, audiences, topics, messages, briefs } from "@/db/schema";
import {
  attachBriefByLink,
  archiveBrief,
  BriefError,
  listBriefs,
  listBriefsWithProgress,
} from "@/lib/entities/briefs";
import { createDraft, promoteDraft } from "@/lib/entities/messages";
import { createTestDb, type TestDb } from "../helpers/test-db";

let h: TestDb;
let erste: { id: number };

const DECK = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const OTHER = "1ZzYyXxWwVvUuTtSsRrQqPpOoNnMmLlKkJj";

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  await db.insert(audiences).values({
    clientId: erste.id,
    key: "SZK_visitors",
    name: "Visitors",
    product: "SZK",
    orderIndex: 1,
  });
  await db.insert(topics).values({
    clientId: erste.id,
    key: "SZK_brand",
    name: "Brand",
    product: "SZK",
    orderIndex: 1,
  });
});

afterEach(async () => {
  await h.cleanup();
});

describe("attachBriefByLink", () => {
  it("stores the file id, not the link that was pasted", async () => {
    const b = await attachBriefByLink(
      erste.id,
      `https://docs.google.com/presentation/d/${DECK}/edit#slide=id.g1`,
      "Q4 always-on",
    );
    expect(b.slidesFileId).toBe(DECK);
    expect(b.label).toBe("Q4 always-on");
  });

  it("is idempotent — the editor link and the Drive link are ONE brief", async () => {
    const a = await attachBriefByLink(
      erste.id,
      `https://docs.google.com/presentation/d/${DECK}/edit`,
    );
    const b = await attachBriefByLink(
      erste.id,
      `https://drive.google.com/file/d/${DECK}/view?usp=sharing`,
    );
    expect(b.id).toBe(a.id);
    expect(await listBriefs(erste.id)).toHaveLength(1);
  });

  it("updates the label when re-attached with a new one", async () => {
    const a = await attachBriefByLink(erste.id, DECK, "First guess");
    const b = await attachBriefByLink(erste.id, DECK, "What it really is");
    expect(b.id).toBe(a.id);
    expect(b.label).toBe("What it really is");
  });

  it("brings an archived brief back — pasting it again means it is in use", async () => {
    const a = await attachBriefByLink(erste.id, DECK);
    await archiveBrief(erste.id, a.id);
    expect(await listBriefs(erste.id)).toHaveLength(0);
    const again = await attachBriefByLink(erste.id, DECK);
    expect(again.id).toBe(a.id);
    expect(again.archivedAt).toBeNull();
    expect(await listBriefs(erste.id)).toHaveLength(1);
  });

  it("refuses a folder link and says what to paste instead", async () => {
    await expect(
      attachBriefByLink(
        erste.id,
        "https://drive.google.com/drive/folders/1idXHYJYnXRNEW6jmhZ7RW8XCzT269xbe",
      ),
    ).rejects.toThrow(/FOLDER link/);
  });

  it("refuses something that is not a link to a file", async () => {
    await expect(attachBriefByLink(erste.id, "no idea")).rejects.toThrow(
      BriefError,
    );
  });
});

describe("listBriefsWithProgress", () => {
  it("counts open drafts and promoted cards — the close check without a state machine", async () => {
    const brief = await attachBriefByLink(erste.id, DECK, "Deck");
    const d1 = await createDraft(erste.id, { briefId: brief.id });
    await createDraft(erste.id, { briefId: brief.id });
    await createDraft(erste.id, { briefId: brief.id });

    let [row] = await listBriefsWithProgress(erste.id);
    expect(row).toMatchObject({ openDrafts: 3, promoted: 0 });

    await promoteDraft(erste.id, d1.id, {
      audienceKey: "SZK_visitors",
      topicKey: "SZK_brand",
    });

    [row] = await listBriefsWithProgress(erste.id);
    expect(row).toMatchObject({ openDrafts: 2, promoted: 1 });
  });

  it("keeps each brief's counts to itself", async () => {
    const a = await attachBriefByLink(erste.id, DECK, "A");
    const b = await attachBriefByLink(erste.id, OTHER, "B");
    await createDraft(erste.id, { briefId: a.id });
    await createDraft(erste.id, { briefId: b.id });
    await createDraft(erste.id, { briefId: b.id });
    const rows = await listBriefsWithProgress(erste.id);
    const byLabel = new Map(rows.map((r) => [r.label, r]));
    expect(byLabel.get("A")).toMatchObject({ openDrafts: 1 });
    expect(byLabel.get("B")).toMatchObject({ openDrafts: 2 });
  });

  it("ignores drafts that have no brief", async () => {
    const brief = await attachBriefByLink(erste.id, DECK, "Deck");
    await createDraft(erste.id, { briefId: brief.id });
    await createDraft(erste.id); // loose work, no deck behind it
    const [row] = await listBriefsWithProgress(erste.id);
    expect(row).toMatchObject({ openDrafts: 1 });
  });
});

describe("a brief is a pointer, not an owner", () => {
  it("archiving it leaves the drafts alone", async () => {
    const brief = await attachBriefByLink(erste.id, DECK);
    const d = await createDraft(erste.id, { briefId: brief.id });
    await archiveBrief(erste.id, brief.id);
    const [row] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, d.id));
    expect(row!.briefId).toBe(brief.id);
    expect(row!.status).toBe("DRAFT");
  });

  it("deleting it cuts the link but keeps the work", async () => {
    const brief = await attachBriefByLink(erste.id, DECK);
    const d = await createDraft(erste.id, { briefId: brief.id });
    await db.delete(briefs).where(eq(briefs.id, brief.id));
    const [row] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, d.id));
    expect(row).toBeDefined();
    expect(row!.briefId).toBeNull();
  });
});
