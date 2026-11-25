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
  moveMessages,
  propagateToSiblings,
  setMessageVersionNo,
  updateMessage,
} from "@/lib/entities/messages";
import { rekeyDimension } from "@/lib/entities/rekey";
import { createTestDb, type TestDb } from "../../helpers/test-db";
import { holdRowLock, waitForLockWaiter } from "../../helpers/row-lock";

let h: TestDb;
let erste: { id: number };

const PATTERNS = {
  // The seeded topic's key ("top1") is not what this pattern produces, so a
  // rekey of it always has something to do.
  topicKey: "{{product}}_{{tag4}}",
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

describe("rekeyDimension — the cascade reads each MC under its lock", () => {
  it("a rekey that waited through a version bump keeps the bumped -n_ in the PMMID and utm_cd26", async () => {
    // The cascade rebuilds every MC's PMMID from the row it read. Read without
    // the row lock, that row is the one before a concurrent bump, and the
    // rekey writes the old -n_ back while version_no stays at the new value.
    const { primary } = await seedCard();
    const [topic] = await db
      .update(topics)
      .set({ tag4: "150e" })
      .where(eq(topics.key, "top1"))
      .returning();
    const lock = await holdRowLock(primary.id);
    const rekey = rekeyDimension(erste.id, "topic", topic.id, topic.version, null);
    await waitForLockWaiter();
    await lock.release(async () => {
      const bumped = await setMessageVersionNo(erste.id, primary.id, primary.version, 2, "local", null);
      expect(bumped.ok).toBe(true);
    });
    const res = await rekey;
    expect(res.ok).toBe(true);
    const after = await reread(primary.id);
    expect(after.topic).toBe("SZK_150e");
    expect(after.versionNo).toBe(2);
    expect(after.pmmid).toBe(`a_aud1-t_SZK_150e-m_${primary.number}-v_a-n_2`);
    expect(after.utmCd26).toBe(after.pmmid);
    expect(after.finalTraffickedUrl).toBe(`${LP}?utm_cd26=${after.pmmid}`);
  });
});

describe("moveMessages — the If-Match holds until the write", () => {
  it("a move that waited through a version bump is refused and leaves the bumped card as it is", async () => {
    // The move checks the If-Match on a read, then rebuilds the PMMID from that
    // read. A bump landing in between must make the move a version conflict,
    // not a write of the old -n_ onto the moved card.
    const { primary } = await seedCard();
    await db.insert(audiences).values({ clientId: erste.id, key: "aud3", name: "AUD3", orderIndex: 2, product: "SZK" });
    const lock = await holdRowLock(primary.id);
    const move = db.transaction(async () =>
      moveMessages(erste.id, [{ mcLabel: primary.pmmid, expectedVersion: primary.version }], "aud3"),
    );
    await waitForLockWaiter();
    await lock.release(async () => {
      const bumped = await setMessageVersionNo(erste.id, primary.id, primary.version, 2, "local", null);
      expect(bumped.ok).toBe(true);
    });
    const res = await move;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("version_conflict");
      expect(res.current?.version).toBe(primary.version + 1);
    }
    const after = await reread(primary.id);
    expect(after.audience).toBe("aud1");
    expect(after.pmmid).toBe(`a_aud1-t_top1-m_${primary.number}-v_a-n_2`);
    expect(after.utmCd26).toBe(after.pmmid);
  });

  it("a conflict on a later item rolls back the items already moved", async () => {
    // All or nothing, as the bulk-move route and mc_move_batch promise.
    const { primary } = await seedCard();
    const second = await createMessage(erste.id, { audience: "aud1", topic: "top1", landingUrl: LP });
    await db.insert(audiences).values({ clientId: erste.id, key: "aud3", name: "AUD3", orderIndex: 2, product: "SZK" });
    const lock = await holdRowLock(second.id);
    const move = db.transaction(async () =>
      moveMessages(
        erste.id,
        [
          { mcLabel: primary.pmmid, expectedVersion: primary.version },
          { mcLabel: second.pmmid!, expectedVersion: second.version },
        ],
        "aud3",
      ),
    );
    await waitForLockWaiter();
    await lock.release(async () => {
      const bumped = await setMessageVersionNo(erste.id, second.id, second.version, 2, "local", null);
      expect(bumped.ok).toBe(true);
    });
    const res = await move;
    expect(res.ok).toBe(false);
    expect((await reread(primary.id)).audience).toBe("aud1");
    expect((await reread(primary.id)).version).toBe(primary.version);
    expect((await reread(second.id)).audience).toBe("aud1");
  });
});
