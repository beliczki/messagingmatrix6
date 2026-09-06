import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, messages } from "@/db/schema";
import { createTestDb, type TestDb } from "../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  [telekom] = await db
    .insert(clients)
    .values({ key: "telekom", name: "Telekom" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
});

const SLIDES_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

// drizzle's thrown Error only says "Failed query: …"; the constraint name lives
// on the driver error underneath. Asserting the NAME (not just "it threw") is
// the point here — a bare toThrow() would also pass on an unrelated NOT NULL.
async function violatedConstraint(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const cause = (e as { cause?: { constraint_name?: string } }).cause;
    return cause?.constraint_name ?? `no constraint name on: ${String(e)}`;
  }
  throw new Error("expected the write to be rejected, but it succeeded");
}

function draftRow(over: Partial<typeof messages.$inferInsert> = {}) {
  return {
    clientId: erste.id,
    number: 700,
    variant: "a",
    status: "DRAFT",
    audience: null,
    ...over,
  };
}

function placedRow(over: Partial<typeof messages.$inferInsert> = {}) {
  return {
    clientId: erste.id,
    number: 701,
    variant: "a",
    status: "PREVIEW",
    audience: "SZK_visitors",
    topic: "SZK_brand",
    ...over,
  };
}

describe("messages.brief_slides_file_id (migration 0017)", () => {
  it("stores the deck's Drive FILE ID on the card", async () => {
    const [row] = await db
      .insert(messages)
      .values(draftRow({ briefSlidesFileId: SLIDES_ID }))
      .returning();
    expect(row!.briefSlidesFileId).toBe(SLIDES_ID);
  });

  it("lets many cards share one deck — that IS the shared-brief fact", async () => {
    // What the `briefs` table and its FK used to express. A canonical file id
    // needs no surrogate row: two cards share a deck when the string matches.
    await db.insert(messages).values(draftRow({ briefSlidesFileId: SLIDES_ID }));
    const [second] = await db
      .insert(messages)
      .values(
        draftRow({ number: 702, briefSlidesFileId: SLIDES_ID }),
      )
      .returning();
    expect(second!.briefSlidesFileId).toBe(SLIDES_ID);

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.briefSlidesFileId, SLIDES_ID));
    expect(rows).toHaveLength(2);
  });

  it("detaches one card without touching the other", async () => {
    const [a] = await db
      .insert(messages)
      .values(draftRow({ briefSlidesFileId: SLIDES_ID }))
      .returning();
    await db
      .insert(messages)
      .values(draftRow({ number: 702, briefSlidesFileId: SLIDES_ID }));

    await db
      .update(messages)
      .set({ briefSlidesFileId: null })
      .where(eq(messages.id, a!.id));

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.briefSlidesFileId, SLIDES_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.number).toBe(702);
  });

  it("defaults to NULL — matrix rows predate the column", async () => {
    const [row] = await db.insert(messages).values(placedRow()).returning();
    expect(row!.briefSlidesFileId).toBeNull();
  });
});

describe("DRAFT ⟺ no audience invariant (migration 0012)", () => {
  it("accepts a DRAFT that has only a number — no audience, no topic", async () => {
    const [row] = await db.insert(messages).values(draftRow()).returning();
    expect(row).toMatchObject({
      status: "DRAFT",
      number: 700,
      variant: "a",
      audience: null,
      topic: null,
    });
  });

  it("accepts a DRAFT carrying a suggested topic name that is not a real key", async () => {
    const [row] = await db
      .insert(messages)
      .values(draftRow({ topic: "társasház ajánlat (munkacím)" }))
      .returning();
    expect(row!.topic).toBe("társasház ajánlat (munkacím)");
    expect(row!.audience).toBeNull();
  });

  it("rejects a DRAFT that sits in a cell", async () => {
    expect(
      await violatedConstraint(
        db.insert(messages).values(draftRow({ audience: "SZK_visitors" })),
      ),
    ).toBe("messages_draft_has_no_audience");
  });

  it("rejects a placed row that lost its audience", async () => {
    expect(
      await violatedConstraint(
        db.insert(messages).values(placedRow({ audience: null })),
      ),
    ).toBe("messages_draft_has_no_audience");
  });

  it("rejects promoting a draft by status alone — the audience must land too", async () => {
    const [row] = await db.insert(messages).values(draftRow()).returning();
    expect(
      await violatedConstraint(
        db
          .update(messages)
          .set({ status: "PREVIEW" })
          .where(eq(messages.id, row!.id)),
      ),
    ).toBe("messages_draft_has_no_audience");
  });

  it("accepts promotion when audience and topic land with the status", async () => {
    const [row] = await db.insert(messages).values(draftRow()).returning();
    const [promoted] = await db
      .update(messages)
      .set({ status: "PREVIEW", audience: "SZK_visitors", topic: "SZK_brand" })
      .where(eq(messages.id, row!.id))
      .returning();
    expect(promoted).toMatchObject({
      status: "PREVIEW",
      audience: "SZK_visitors",
      topic: "SZK_brand",
      number: 700,
      variant: "a",
    });
  });
});
