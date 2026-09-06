import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, audiences, topics, channels, messages } from "@/db/schema";
import {
  copyMessages,
  createDraft,
  createMessage,
  deleteDraft,
  promoteDraft,
  updateMessage,
  findSiblings,
  MessageError,
} from "@/lib/entities/messages";
import { createTestDb, type TestDb } from "../helpers/test-db";

let h: TestDb;
let erste: { id: number };

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  // Two DCO audiences (channel NULL) and one Agentic channel, so both number
  // axes exist in the fixture.
  await db.insert(audiences).values([
    { clientId: erste.id, key: "SZK_visitors", name: "Visitors", product: "SZK", orderIndex: 1 },
    { clientId: erste.id, key: "SZK_lookalike", name: "Lookalike", product: "SZK", orderIndex: 2 },
  ]);
  await db.insert(channels).values([
    { clientId: erste.id, key: "ch_disp", code: "DISP", label: "Display", orderIndex: 1 },
  ]);
  await db.insert(topics).values([
    { clientId: erste.id, key: "SZK_brand", name: "Brand", product: "SZK", orderIndex: 1 },
    { clientId: erste.id, key: "SZK_offer", name: "Offer", product: "SZK", orderIndex: 2 },
  ]);
});

afterEach(async () => {
  await h.cleanup();
});

describe("createDraft", () => {
  it("claims a number with no cell — the T0 state", async () => {
    const d = await createDraft(erste.id, { name: "Fresh brief" });
    expect(d).toMatchObject({
      status: "DRAFT",
      audience: null,
      topic: null,
      variant: "a",
      pmmid: null,
    });
    expect(d.number).toBeGreaterThan(0);
  });

  it("keeps a suggested topic NAME that names no real topic", async () => {
    const d = await createDraft(erste.id, { topic: "társasház (munkacím)" });
    expect(d.topic).toBe("társasház (munkacím)");
    expect(d.audience).toBeNull();
  });

  it("refuses an audience — that is what promotion is for", async () => {
    await expect(
      createDraft(erste.id, { audience: "SZK_visitors" }),
    ).rejects.toThrow(MessageError);
  });

  it("refuses a non-DRAFT status", async () => {
    await expect(
      createDraft(erste.id, { status: "ACTIVE" }),
    ).rejects.toThrow(/status is DRAFT/);
  });
});

describe("draft number reservation", () => {
  it("allocates above BOTH axes, not just one", async () => {
    // A tall Agentic number and a short DCO one: a per-axis draft allocation
    // would hand out 2 here and collide with the Agentic card on promotion.
    await createMessage(
      erste.id,
      { audience: "ch_disp", topic: "SZK_brand" },
      { requestedNumber: 500 },
    );
    await createMessage(
      erste.id,
      { audience: "SZK_visitors", topic: "SZK_offer" },
      { requestedNumber: 1 },
    );
    const d = await createDraft(erste.id);
    expect(d.number).toBe(501);
  });

  it("holds its number against a new DCO card", async () => {
    const d = await createDraft(erste.id);
    const mc = await createMessage(
      erste.id,
      { audience: "SZK_visitors", topic: "SZK_brand" },
      { requestedNumber: "new" },
    );
    expect(mc.number).toBeGreaterThan(d.number);
  });

  it("holds its number against a new Agentic card — the axis it is not on", async () => {
    const d = await createDraft(erste.id);
    const mc = await createMessage(
      erste.id,
      { audience: "ch_disp", topic: "SZK_brand" },
      { requestedNumber: "new" },
    );
    expect(mc.number).toBeGreaterThan(d.number);
  });

  it("refuses an explicit claim of a number a draft is holding, and says why", async () => {
    const d = await createDraft(erste.id);
    await expect(
      createMessage(
        erste.id,
        { audience: "SZK_visitors", topic: "SZK_brand" },
        { requestedNumber: d.number },
      ),
    ).rejects.toThrow(/reserved by a draft/);
  });

  it("has no siblings — it is on no axis and in no cell", async () => {
    const d = await createDraft(erste.id);
    expect(await findSiblings(erste.id, d)).toEqual([]);
  });
});

describe("deleteDraft", () => {
  it("removes the row and GIVES THE NUMBER BACK", async () => {
    // The whole reason this exists next to archive. An archived card keeps its
    // number retired, which is right for work that happened; a draft created by
    // mistake never happened, and burning a number to record that is the bug.
    const d = await createDraft(erste.id);
    const claimed = d.number;

    const res = await deleteDraft(erste.id, d.id, d.version);
    expect(res.ok).toBe(true);
    expect(await db.select().from(messages).where(eq(messages.id, d.id))).toHaveLength(0);

    const next = await createDraft(erste.id);
    expect(next.number).toBe(claimed);
  });

  it("refuses a card that has a cell — that one gets archived", async () => {
    const mc = await createMessage(erste.id, {
      audience: "SZK_visitors",
      topic: "SZK_brand",
    });
    const res = await deleteDraft(erste.id, mc.id, mc.version);
    expect(res).toMatchObject({ ok: false, reason: "not_a_draft" });
    expect(await db.select().from(messages).where(eq(messages.id, mc.id))).toHaveLength(1);
  });

  it("refuses a stale version instead of deleting the wrong state", async () => {
    const d = await createDraft(erste.id);
    const res = await deleteDraft(erste.id, d.id, d.version + 1);
    expect(res).toMatchObject({ ok: false, reason: "version_conflict" });
    expect(await db.select().from(messages).where(eq(messages.id, d.id))).toHaveLength(1);
  });

  it("is scoped to the client", async () => {
    const [telekom] = await db
      .insert(clients)
      .values({ key: "telekom", name: "Telekom" })
      .returning();
    const d = await createDraft(erste.id);
    const res = await deleteDraft(telekom!.id, d.id, d.version);
    expect(res).toMatchObject({ ok: false, reason: "not_found" });
    expect(await db.select().from(messages).where(eq(messages.id, d.id))).toHaveLength(1);
  });
});

describe("promoteDraft", () => {
  it("keeps the number, gains a cell, an identity and a status", async () => {
    const d = await createDraft(erste.id, { headline: "Hello" });
    const promoted = await promoteDraft(erste.id, d.id, {
      audienceKey: "SZK_visitors",
      topicKey: "SZK_brand",
    });
    expect(promoted).toMatchObject({
      id: d.id, // the same row — promotion is not a re-creation
      number: d.number, // the promise made at intake
      status: "PREVIEW",
      audience: "SZK_visitors",
      topic: "SZK_brand",
      headline: "Hello",
    });
    expect(promoted.pmmid).toBeTruthy();
  });

  it("frees the number afterwards — the reservation was for this card only", async () => {
    const d = await createDraft(erste.id);
    await promoteDraft(erste.id, d.id, {
      audienceKey: "SZK_visitors",
      topicKey: "SZK_brand",
    });
    // Claiming the same number in the same cell now attaches as a new variant,
    // rather than being refused as draft-reserved.
    const twin = await createMessage(
      erste.id,
      { audience: "SZK_visitors", topic: "SZK_brand" },
      { requestedNumber: d.number },
    );
    expect(twin.number).toBe(d.number);
    expect(twin.variant).toBe("b");
  });

  it("bumps the variant when the target cell already holds the number", async () => {
    const d = await createDraft(erste.id);
    await createMessage(
      erste.id,
      { audience: "SZK_visitors", topic: "SZK_brand" },
      { requestedNumber: d.number + 1 },
    );
    // Same cell, same number as the draft → the draft takes the next letter.
    await db
      .update(messages)
      .set({ number: d.number + 1 })
      .where(eq(messages.id, d.id));
    const promoted = await promoteDraft(erste.id, d.id, {
      audienceKey: "SZK_visitors",
      topicKey: "SZK_brand",
    });
    expect(promoted.variant).toBe("b");
  });

  it("refuses a topic that does not exist — promotion may not mint topics", async () => {
    const d = await createDraft(erste.id, { topic: "made up working title" });
    await expect(
      promoteDraft(erste.id, d.id, {
        audienceKey: "SZK_visitors",
        topicKey: "made up working title",
      }),
    ).rejects.toThrow(/create the topic first/);
  });

  it("refuses an unknown audience", async () => {
    const d = await createDraft(erste.id);
    await expect(
      promoteDraft(erste.id, d.id, {
        audienceKey: "nope",
        topicKey: "SZK_brand",
      }),
    ).rejects.toThrow(/audience 'nope' not found/);
  });

  // The user's "image AND DCO feed row" case. One draft becomes ONE card; the
  // second axis is a COPY of it, which is how the two stay one card rather than
  // two unrelated ones that happen to share a number.
  it("reaches both axes under one number: promote, then copy across", async () => {
    const d = await createDraft(erste.id, { headline: "Both axes" });
    const dco = await promoteDraft(erste.id, d.id, {
      audienceKey: "SZK_visitors",
      topicKey: "SZK_brand",
    });
    const { created } = await copyMessages(
      erste.id,
      [dco.pmmid!],
      ["ch_disp"],
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      number: dco.number, // cross-axis number reuse is deliberate
      audience: "ch_disp",
      topic: "SZK_brand",
      headline: "Both axes",
    });
    // Different axes, so they are different cards with their own identities.
    expect(created[0]!.pmmid).not.toBe(dco.pmmid);
    expect(created[0]!.id).not.toBe(dco.id);
  });

  it("refuses to promote something that is already in the matrix", async () => {
    const mc = await createMessage(erste.id, {
      audience: "SZK_visitors",
      topic: "SZK_brand",
    });
    await expect(
      promoteDraft(erste.id, mc.id, {
        audienceKey: "SZK_lookalike",
        topicKey: "SZK_brand",
      }),
    ).rejects.toThrow(/is not a draft/);
  });
});

describe("the birth status of a matrix card", () => {
  // By the time a card is placed it has a template and content, so the earlier
  // statuses only ever described a moment that had already passed — the
  // operator flipped every new card to PREVIEW by hand.
  it("is PREVIEW, not a pre-content status", async () => {
    const mc = await createMessage(erste.id, {
      audience: "SZK_visitors",
      topic: "SZK_brand",
    });
    expect(mc.status).toBe("PREVIEW");
  });

  it("still yields to an explicit status from the caller", async () => {
    const mc = await createMessage(erste.id, {
      audience: "SZK_visitors",
      topic: "SZK_brand",
      status: "ACTIVE",
    });
    expect(mc.status).toBe("ACTIVE");
  });
});

describe("updateMessage keeps the DRAFT invariant", () => {
  it("edits a draft's content without minting a PMMID for it", async () => {
    const d = await createDraft(erste.id);
    const r = await updateMessage(erste.id, d.id, d.version, {
      headline: "Second thought",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.headline).toBe("Second thought");
    expect(r.row.pmmid).toBeNull();
    expect(r.row.status).toBe("DRAFT");
  });

  it("refuses to give a draft an audience without promoting it", async () => {
    const d = await createDraft(erste.id);
    await expect(
      updateMessage(erste.id, d.id, d.version, { audience: "SZK_visitors" }),
    ).rejects.toThrow(/DRAFT cannot sit in a cell/);
  });

  it("refuses to strip a placed card's audience", async () => {
    const mc = await createMessage(erste.id, {
      audience: "SZK_visitors",
      topic: "SZK_brand",
    });
    await expect(
      updateMessage(erste.id, mc.id, mc.version, { audience: null }),
    ).rejects.toThrow(/needs an audience/);
  });

  it("refuses to turn a placed card back into a draft by status alone", async () => {
    const mc = await createMessage(erste.id, {
      audience: "SZK_visitors",
      topic: "SZK_brand",
    });
    await expect(
      updateMessage(erste.id, mc.id, mc.version, { status: "DRAFT" }),
    ).rejects.toThrow(/DRAFT cannot sit in a cell/);
  });
});
