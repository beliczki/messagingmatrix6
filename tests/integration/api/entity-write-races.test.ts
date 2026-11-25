// Writers that race on one asset, creative or text-formatting row. Each test
// fixes the order with a held row lock (tests/helpers/row-lock.ts): the writer
// under test has read the row and reached its UPDATE, another write lands and
// commits, then the writer resumes.
//
// The mechanism under test: the writer checks If-Match on a row it read
// without a lock, then writes by id alone, so whatever committed in between is
// overwritten. The contract (REBUILD_SPEC §4, §8.2): two writes with the same
// If-Match, one wins and the other gets a 409 with the current row.
//
// Every expected value is what the competing write put there (a literal in
// the test), never something the code under test computes.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  channels,
  clients,
  creatives,
  messages,
  textFormatting,
  topics,
} from "@/db/schema";
import { updateAsset } from "@/lib/entities/assets";
import { updateCreative } from "@/lib/entities/creatives";
import { updateTextFormatting } from "@/lib/entities/text-formatting";
import { promoteCreative } from "@/lib/entities/promote";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";
import { holdRowLock, waitForLockWaiter } from "../../helpers/row-lock";

let h: TestDb;
let erste: { id: number };

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  withActiveClientKey("erste");
});

afterEach(async () => {
  await h.cleanup();
});

describe("updateAsset — the If-Match holds until the write", () => {
  it("a save that waited for the row loses to the save that landed first", async () => {
    const [asset] = await db
      .insert(assets)
      .values({ clientId: erste.id, comment: "orig", version: 1 })
      .returning();
    const lock = await holdRowLock(asset.id, "assets");
    const late = updateAsset(erste.id, asset.id, 1, { comment: "late" });
    await waitForLockWaiter();
    await lock.release(async () => {
      await db
        .update(assets)
        .set({ comment: "first", version: 2 })
        .where(eq(assets.id, asset.id));
    });
    const res = await late;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.current?.version).toBe(2);
      expect(res.current?.comment).toBe("first");
    }
    const [after] = await db.select().from(assets).where(eq(assets.id, asset.id));
    expect(after.comment).toBe("first");
    expect(after.version).toBe(2);
  });
});

describe("updateCreative — the If-Match holds until the write", () => {
  it("a save that waited for the row loses to the save that landed first", async () => {
    const [creative] = await db
      .insert(creatives)
      .values({ clientId: erste.id, comment: "orig", version: 1 })
      .returning();
    const lock = await holdRowLock(creative.id, "creatives");
    const late = updateCreative(erste.id, creative.id, 1, { comment: "late" });
    await waitForLockWaiter();
    await lock.release(async () => {
      await db
        .update(creatives)
        .set({ comment: "first", version: 2 })
        .where(eq(creatives.id, creative.id));
    });
    const res = await late;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.current?.version).toBe(2);
      expect(res.current?.comment).toBe("first");
    }
    const [after] = await db
      .select()
      .from(creatives)
      .where(eq(creatives.id, creative.id));
    expect(after.comment).toBe("first");
  });

  it("promoteCreative that loses the link to a concurrent promote leaves no MC behind", async () => {
    // Two promotes of one creative: each creates an MC, then links the
    // creative to it. Without the check at the write both links went through,
    // the creative pointed at the second MC and the first stayed in the
    // matrix as an ACTIVE card with no creative. The loser must fail with the
    // promote's own "changed concurrently" error, and its transaction must
    // take its MC (and the auto-topic it created) with it.
    await db.insert(channels).values({
      clientId: erste.id,
      key: "ch_disp",
      code: "DISP",
      label: "DISP",
      orderIndex: 0,
    });
    const [creative] = await db
      .insert(creatives)
      .values({
        clientId: erste.id,
        fileName: "ERSTE_SZA_MC289_a_diakszamla_2026Q1_640x360.jpg",
        version: 1,
      })
      .returning();
    const lock = await holdRowLock(creative.id, "creatives");
    const late = promoteCreative(erste.id, creative.id, { channel: "DISP" });
    // Swallow the rejection until we await it below, so it cannot surface as
    // an unhandled rejection while the lock is still held.
    late.catch(() => {});
    await waitForLockWaiter();
    await lock.release(async () => {
      // What the winning promote's link writes.
      await db
        .update(creatives)
        .set({ mcNumber: 900, mcVariant: "a", version: 2 })
        .where(eq(creatives.id, creative.id));
    });
    await expect(late).rejects.toThrow(/changed concurrently during promotion/);
    const [after] = await db
      .select()
      .from(creatives)
      .where(eq(creatives.id, creative.id));
    expect(after.mcNumber).toBe(900);
    expect(after.mcVariant).toBe("a");
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(topics)).toHaveLength(0);
  });
});

describe("updateTextFormatting — the If-Match holds until the write", () => {
  it("a save that waited for the row loses to the save that landed first", async () => {
    const [rule] = await db
      .insert(textFormatting)
      .values({
        clientId: erste.id,
        textOriginal: "Erste",
        textFormatted: "ERSTE",
        version: 1,
      })
      .returning();
    const lock = await holdRowLock(rule.id, "text_formatting");
    const late = updateTextFormatting(erste.id, rule.id, 1, {
      textFormatted: "Erste Bank (late)",
    });
    await waitForLockWaiter();
    await lock.release(async () => {
      await db
        .update(textFormatting)
        .set({ textFormatted: "Erste Bank", version: 2 })
        .where(eq(textFormatting.id, rule.id));
    });
    const res = await late;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.current?.version).toBe(2);
      expect(res.current?.textFormatted).toBe("Erste Bank");
    }
    const [after] = await db
      .select()
      .from(textFormatting)
      .where(eq(textFormatting.id, rule.id));
    expect(after.textFormatted).toBe("Erste Bank");
  });
});
