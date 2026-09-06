import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { clients, audiences, topics } from "@/db/schema";
import {
  briefFileIdFromLink,
  BriefError,
  listBriefDecks,
} from "@/lib/entities/briefs";
import {
  createDraft,
  promoteDraft,
  updateMessage,
} from "@/lib/entities/messages";
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

async function draftOnDeck(fileId: string | null) {
  const draft = await createDraft(erste.id, {});
  if (fileId === null) return draft;
  const res = await updateMessage(erste.id, draft.id, draft.version, {
    briefSlidesFileId: fileId,
  });
  if (!res.ok) throw new Error("unexpected version conflict");
  return res.row;
}

describe("briefFileIdFromLink", () => {
  it("takes the file id, not the link that was pasted", () => {
    expect(
      briefFileIdFromLink(
        `https://docs.google.com/presentation/d/${DECK}/edit#slide=id.g1`,
      ),
    ).toBe(DECK);
  });

  it("reads one deck out of every spelling of its link", () => {
    // This is what makes the column enough on its own: the value is canonical
    // BEFORE it is stored, so equality on it is the shared-deck fact. A row
    // with a surrogate id was buying an identity this string already had.
    const spellings = [
      `https://docs.google.com/presentation/d/${DECK}/edit`,
      `https://docs.google.com/presentation/d/${DECK}/edit?usp=sharing`,
      `https://docs.google.com/presentation/u/0/d/${DECK}/edit#slide=id.g7f_0_1`,
      `https://drive.google.com/file/d/${DECK}/view`,
    ];
    expect(new Set(spellings.map(briefFileIdFromLink))).toEqual(new Set([DECK]));
  });

  it("refuses a folder link by name", () => {
    expect(() =>
      briefFileIdFromLink("https://drive.google.com/drive/folders/1FliAbc"),
    ).toThrow(BriefError);
    expect(() =>
      briefFileIdFromLink("https://drive.google.com/drive/folders/1FliAbc"),
    ).toThrow(/FOLDER link/);
  });

  it("refuses a link with no file id in it", () => {
    expect(() => briefFileIdFromLink("https://example.com/deck")).toThrow(
      BriefError,
    );
  });
});

describe("listBriefDecks", () => {
  it("groups the cards by deck and counts open vs promoted", async () => {
    const open1 = await draftOnDeck(DECK);
    await draftOnDeck(DECK);
    await draftOnDeck(OTHER);

    // One of the DECK drafts gets a cell — it stops being open and starts
    // counting as promoted, with no state anywhere to update.
    await promoteDraft(erste.id, open1.id, {
      audienceKey: "SZK_visitors",
      topicKey: "SZK_brand",
      expectedVersion: open1.version,
    });

    const decks = await listBriefDecks(erste.id);
    expect(decks).toHaveLength(2);
    expect(decks.find((d) => d.slidesFileId === DECK)).toMatchObject({
      openDrafts: 1,
      promoted: 1,
    });
    expect(decks.find((d) => d.slidesFileId === OTHER)).toMatchObject({
      openDrafts: 1,
      promoted: 0,
    });
  });

  it("does not list a deck no card points at any more", async () => {
    const draft = await draftOnDeck(DECK);
    expect(await listBriefDecks(erste.id)).toHaveLength(1);

    // Clearing the link is the whole of detaching. There is no row left behind
    // for nothing to point at — which is the orphan the table used to leave.
    const cleared = await updateMessage(erste.id, draft.id, draft.version, {
      briefSlidesFileId: null,
    });
    expect(cleared.ok).toBe(true);
    expect(await listBriefDecks(erste.id)).toHaveLength(0);
  });

  it("ignores cards with no brief at all", async () => {
    await draftOnDeck(null);
    expect(await listBriefDecks(erste.id)).toHaveLength(0);
  });

  it("is scoped to the client", async () => {
    const [telekom] = await db
      .insert(clients)
      .values({ key: "telekom", name: "Telekom" })
      .returning();
    await draftOnDeck(DECK);
    expect(await listBriefDecks(telekom!.id)).toHaveLength(0);
  });
});
