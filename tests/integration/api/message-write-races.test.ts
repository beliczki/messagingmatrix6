// Writers that race on one `messages` row. Each test fixes the order with a
// held row lock (tests/helpers/row-lock.ts): the writer under test reaches the
// row, another write lands and commits, then the writer resumes.
//
// The mechanism under test: a writer that reads a row, derives columns from
// what it read (trafficking from the PMMID, the save counter from If-Match) and
// writes them back without holding or re-checking the row. Whatever landed in
// between is overwritten, and since the version bump rewrites the PMMID, the
// overwrite can leave a row whose utm_cd26 is not its own PMMID.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, clients, config, messages, topics } from "@/db/schema";
import {
  copyMessages,
  createMessage,
  getMessage,
  propagateToSiblings,
  setMessageVersionNo,
  updateMessage,
} from "@/lib/entities/messages";
import { createTestDb, type TestDb } from "../../helpers/test-db";
import { holdRowLock, waitForLockWaiter } from "../../helpers/row-lock";

let h: TestDb;
let erste: { id: number };

const PATTERNS = {
  pmmid: "a_{{Audience_Key}}-t_{{Topic_Key}}-m_{{Number}}-v_{{Variant}}-n_{{Version}}",
  trafficking: {
    utm_cd26: "{{PMMID}}",
    final_trafficked_url: "{{Landing_URL}}?utm_cd26={{utm_cd26}}",
  },
};
const LP = "https://erste.hu/lp";
const LP2 = "https://erste.hu/lp2";

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  await db.insert(config).values({
    clientId: erste.id,
    key: "patterns",
    category: "patterns",
    value: JSON.stringify(PATTERNS),
  });
  await db.insert(audiences).values([
    { clientId: erste.id, key: "aud1", name: "AUD1", orderIndex: 0, product: "SZK" },
    { clientId: erste.id, key: "aud2", name: "AUD2", orderIndex: 1, product: "SZK" },
  ]);
  await db.insert(topics).values({ clientId: erste.id, key: "top1", name: "TOP1", orderIndex: 0, product: "SZK" });
});

afterEach(async () => {
  await h.cleanup();
});

async function seedCard() {
  const primary = await createMessage(erste.id, {
    audience: "aud1",
    topic: "top1",
    headline: "original",
    landingUrl: LP,
  });
  await copyMessages(erste.id, [primary.pmmid!], ["aud2"]);
  const [copy2] = await db
    .select()
    .from(messages)
    .where(eq(messages.audience, "aud2"));
  return { primary: (await getMessage(erste.id, primary.id))!, copy2 };
}

const reread = async (id: number) => (await getMessage(erste.id, id))!;

describe("updateMessage — the If-Match holds until the write", () => {
  it("a save that waited for the row loses to the save that landed first", async () => {
    // Two saves with the same If-Match: exactly one may win. Checking the
    // counter on a read and then writing unconditionally let both through,
    // the later one silently overwriting the earlier.
    const { primary } = await seedCard();
    const lock = await holdRowLock(primary.id);
    const late = updateMessage(erste.id, primary.id, primary.version, { headline: "late" });
    await waitForLockWaiter();
    await lock.release(async () => {
      await db
        .update(messages)
        .set({ headline: "first", version: primary.version + 1 })
        .where(eq(messages.id, primary.id));
    });
    const res = await late;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.current?.version).toBe(primary.version + 1);
    expect((await reread(primary.id)).headline).toBe("first");
  });

  it("a save that waited through a version bump does not write the old PMMID back into utm_cd26", async () => {
    const { primary } = await seedCard();
    const lock = await holdRowLock(primary.id);
    const save = updateMessage(erste.id, primary.id, primary.version, { landingUrl: LP2 });
    await waitForLockWaiter();
    await lock.release(async () => {
      const bumped = await setMessageVersionNo(erste.id, primary.id, primary.version, 2, "local", null);
      expect(bumped.ok).toBe(true);
    });
    const res = await save;
    expect(res.ok).toBe(false);
    const after = await reread(primary.id);
    expect(after.pmmid).toBe(`a_aud1-t_top1-m_${primary.number}-v_a-n_2`);
    expect(after.utmCd26).toBe(after.pmmid);
    expect(after.finalTraffickedUrl).toBe(`${LP}?utm_cd26=${after.pmmid}`);
  });
});

describe("propagateToSiblings — a Global save reads each copy under its lock", () => {
  it("rebuilds a copy's trafficking from the PMMID it has at write time", async () => {
    // A Global landing-URL save fans out while that copy's version is being
    // bumped. The copy's trafficking must come from its NEW PMMID.
    const { primary, copy2 } = await seedCard();
    const lock = await holdRowLock(copy2.id);
    const fanOut = propagateToSiblings(erste.id, primary, { landingUrl: LP2 });
    await waitForLockWaiter();
    await lock.release(async () => {
      const bumped = await setMessageVersionNo(erste.id, copy2.id, copy2.version, 2, "local", null);
      expect(bumped.ok).toBe(true);
    });
    const changes = await fanOut;
    expect(changes).toHaveLength(1);
    const after = await reread(copy2.id);
    expect(after.pmmid).toBe(`a_aud2-t_top1-m_${primary.number}-v_a-n_2`);
    expect(after.landingUrl).toBe(LP2);
    expect(after.utmCd26).toBe(after.pmmid);
    expect(after.finalTraffickedUrl).toBe(`${LP2}?utm_cd26=${after.pmmid}`);
    // The audit's `before` is the row as it was when the fan-out wrote it.
    expect(changes[0].before.versionNo).toBe(2);
  });
});
