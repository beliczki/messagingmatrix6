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
  createDraft,
  createMessage,
  deleteDraft,
  deleteMessages,
  getMessage,
  moveMessages,
  promoteDraft,
  propagateToSiblings,
  setMessageVersionNo,
  updateMessage,
} from "@/lib/entities/messages";
import { rekeyDimension } from "@/lib/entities/rekey";
import { buildMcpServer, _resetMcpRateLimitForTests } from "@/lib/mcp";
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
      moveMessages(erste.id, [{ mcLabel: primary.pmmid!, expectedVersion: primary.version }], "aud3"),
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
          { mcLabel: primary.pmmid!, expectedVersion: primary.version },
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

  it("a batch listing the higher id first meets a Global bump as a conflict, not a deadlock", async () => {
    // The bump locks the card's copies in id order. A move that wrote in the
    // order it was given took the higher id first, then waited for the lower
    // one the bump held, while the bump waited for the higher one: Postgres
    // aborted one of them with a deadlock (40P01), an error, not an answer.
    const { primary, copy2 } = await seedCard();
    expect(copy2.id).toBeGreaterThan(primary.id);
    await db.insert(audiences).values({ clientId: erste.id, key: "aud3", name: "AUD3", orderIndex: 2, product: "SZK" });
    const lock = await holdRowLock(primary.id);
    const move = db.transaction(async () =>
      moveMessages(
        erste.id,
        [
          { mcLabel: copy2.pmmid!, expectedVersion: copy2.version },
          { mcLabel: primary.pmmid!, expectedVersion: primary.version },
        ],
        "aud3",
      ),
    );
    await waitForLockWaiter();
    await lock.release(async () => {
      const bumped = await setMessageVersionNo(erste.id, primary.id, primary.version, 2, "global", null);
      expect(bumped.ok).toBe(true);
    });
    const res = await move;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("version_conflict");
    // All or nothing, and the bump landed on both copies.
    expect((await reread(primary.id)).audience).toBe("aud1");
    expect((await reread(copy2.id)).audience).toBe("aud2");
    for (const id of [primary.id, copy2.id]) {
      expect((await reread(id)).versionNo).toBe(2);
    }
  });

  it("plans the variants and returns the moved rows in the order they were given", async () => {
    // Both copies of one number land in one cell, so the second one given
    // gets the next variant. Writing in id order must not change who gets which.
    const { primary, copy2 } = await seedCard();
    await db.insert(audiences).values({ clientId: erste.id, key: "aud3", name: "AUD3", orderIndex: 2, product: "SZK" });
    const res = await moveMessages(
      erste.id,
      [
        { mcLabel: copy2.pmmid!, expectedVersion: copy2.version },
        { mcLabel: primary.pmmid!, expectedVersion: primary.version },
      ],
      "aud3",
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.updated.map((r) => r.id)).toEqual([copy2.id, primary.id]);
    expect(res.updated.map((r) => r.variant)).toEqual(["a", "b"]);
  });
});

describe("mc_update_batch — writes in id order, like the Global bump and the Global save", () => {
  type Tool = { handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }> };
  const batchTool = () =>
    (buildMcpServer({ clientId: erste.id, userId: "u-agent", scope: "full" }) as unknown as {
      _registeredTools: Record<string, Tool>;
    })._registeredTools.mc_update_batch;

  it("a batch listing the higher id first meets a Global bump as a conflict, not a deadlock", async () => {
    // The bump locks the card's copies in id order. A batch that wrote in the
    // order it was given took the higher id first, then waited for the lower
    // one the bump held, while the bump waited for the higher one: Postgres
    // aborted one of them with a deadlock (40P01), an error, not an answer.
    const { primary, copy2 } = await seedCard();
    expect(copy2.id).toBeGreaterThan(primary.id);
    const lock = await holdRowLock(primary.id);
    const batch = batchTool().handler({
      updates: [
        { mc_label: copy2.pmmid, version: copy2.version, fields: { headline: "batch" } },
        { mc_label: primary.pmmid, version: primary.version, fields: { headline: "batch" } },
      ],
    });
    await waitForLockWaiter();
    await lock.release(async () => {
      const bumped = await setMessageVersionNo(erste.id, primary.id, primary.version, 2, "global", null);
      expect(bumped.ok).toBe(true);
    });
    const res = await batch;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/version_conflict/);
    // All or nothing, and the bump landed on both copies.
    for (const id of [primary.id, copy2.id]) {
      const after = await reread(id);
      expect(after.headline).toBe("original");
      expect(after.versionNo).toBe(2);
    }
  });

  it("returns the updated rows in the order they were given", async () => {
    const { primary, copy2 } = await seedCard();
    const res = await batchTool().handler({
      updates: [
        { mc_label: copy2.pmmid, version: copy2.version, fields: { headline: "second copy" } },
        { mc_label: primary.pmmid, version: primary.version, fields: { headline: "first copy" } },
      ],
    });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0].text) as { updated: { id: number }[] };
    expect(body.updated.map((r) => r.id)).toEqual([copy2.id, primary.id]);
  });
});

// A draft is decided on before it is written: promote checks it is still a
// draft and builds its trafficking from the landing URL it read; delete and
// draft_archive check it is still a draft. A promote (or an edit) that lands in
// between makes that decision false, so the write must hold on the version the
// decision was made on.
type McpTool = {
  handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
};
const seedDraft = () => createDraft(erste.id, { headline: "draft", landingUrl: LP });
// The PMMID a draft gets when promoted into aud1/top1, worked out by hand from
// the pattern a_{{Audience_Key}}-t_{{Topic_Key}}-m_{{Number}}-v_{{Variant}}-n_{{Version}}.
const pmmidInAud1 = (d: { number: number; variant: string }) =>
  `a_aud1-t_top1-m_${d.number}-v_${d.variant}-n_1`;

describe("promoteDraft — the decision holds until the write", () => {
  it("a promote that waited through a landing-URL edit is refused, not written with the old URL", async () => {
    // The promote builds final_trafficked_url from the landing URL it read. An
    // edit that landed in between left a card whose trafficked URL sends
    // traffic to the old page while landing_url names the new one.
    const draft = await seedDraft();
    const lock = await holdRowLock(draft.id);
    const late = promoteDraft(erste.id, draft.id, {
      audienceKey: "aud1",
      topicKey: "top1",
      expectedVersion: draft.version,
    });
    late.catch(() => {});
    await waitForLockWaiter();
    await lock.release(async () => {
      await db
        .update(messages)
        .set({ landingUrl: LP2, version: draft.version + 1 })
        .where(eq(messages.id, draft.id));
    });
    await expect(late).rejects.toThrow(/changed since you loaded it/);
    const after = await reread(draft.id);
    expect(after.status).toBe("DRAFT");
    expect(after.audience).toBeNull();
    expect(after.landingUrl).toBe(LP2);
    expect(after.finalTraffickedUrl).toBeNull();
  });

  it("of two promotes of one draft without If-Match, the one that waited is refused", async () => {
    // The If-Match is optional (MCP draft_promote may omit it). Both promotes
    // passed the DRAFT check on their read, both returned 200, and the later
    // one moved the card out of the cell the first had just reported.
    const draft = await seedDraft();
    const lock = await holdRowLock(draft.id);
    const late = promoteDraft(erste.id, draft.id, { audienceKey: "aud1", topicKey: "top1" });
    late.catch(() => {});
    await waitForLockWaiter();
    await lock.release(async () => {
      await promoteDraft(erste.id, draft.id, { audienceKey: "aud2", topicKey: "top1" });
    });
    await expect(late).rejects.toThrow(/changed since you loaded it/);
    const after = await reread(draft.id);
    expect(after.audience).toBe("aud2");
    expect(after.pmmid).toBe(`a_aud2-t_top1-m_${draft.number}-v_${draft.variant}-n_1`);
  });
});

describe("deleteDraft — the delete holds on the version it checked", () => {
  it("a delete that waited through a promote leaves the placed card alone", async () => {
    // The not-a-draft guard ran on the read; the DELETE went by id alone. A
    // promote in between made it a card with a PMMID, and the delete removed
    // it for good.
    const draft = await seedDraft();
    const lock = await holdRowLock(draft.id);
    const late = deleteDraft(erste.id, draft.id, draft.version);
    await waitForLockWaiter();
    await lock.release(async () => {
      await promoteDraft(erste.id, draft.id, {
        audienceKey: "aud1",
        topicKey: "top1",
        expectedVersion: draft.version,
      });
    });
    const res = await late;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("not_a_draft");
    const after = await getMessage(erste.id, draft.id);
    expect(after).not.toBeNull();
    expect(after!.audience).toBe("aud1");
    expect(after!.pmmid).toBe(pmmidInAud1(draft));
  });

  it("a delete that waited through an edit is a version conflict, and the edit survives", async () => {
    const draft = await seedDraft();
    const lock = await holdRowLock(draft.id);
    const late = deleteDraft(erste.id, draft.id, draft.version);
    await waitForLockWaiter();
    await lock.release(async () => {
      await db
        .update(messages)
        .set({ headline: "edited", version: draft.version + 1 })
        .where(eq(messages.id, draft.id));
    });
    const res = await late;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("version_conflict");
      expect(res.current?.headline).toBe("edited");
    }
    expect((await reread(draft.id)).headline).toBe("edited");
  });
});

describe("draft_archive (archiveMessage) — the archive holds on the version it checked", () => {
  it("a draft-scope draft_archive that waited through a promote does not archive the placed card", async () => {
    // draft_archive checks status DRAFT on its read; a draft-scope token is
    // not meant to reach a card in a cell (only `full` may promote). A promote
    // in between let it archive a card that had just been placed.
    _resetMcpRateLimitForTests();
    const draft = await seedDraft();
    const tool = (buildMcpServer({ clientId: erste.id, userId: "u-agent", scope: "draft" }) as unknown as {
      _registeredTools: Record<string, McpTool>;
    })._registeredTools.draft_archive;
    const lock = await holdRowLock(draft.id);
    const late = tool.handler({ draft_id: draft.id });
    await waitForLockWaiter();
    await lock.release(async () => {
      await promoteDraft(erste.id, draft.id, {
        audienceKey: "aud1",
        topicKey: "top1",
        expectedVersion: draft.version,
      });
    });
    const res = await late;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/version_conflict/);
    const after = await reread(draft.id);
    expect(after.archivedAt).toBeNull();
    expect(after.audience).toBe("aud1");
  });
});

describe("deleteMessages — the bulk purge holds on the versions it checked", () => {
  it("a purge that waited while one card went ACTIVE deletes nothing", async () => {
    // The measurement-lock guard read the status before the DELETE, which went
    // by id alone: a card that became ACTIVE in between (its PMMID now anchors
    // reporting joins) was deleted for good. The route runs the purge in one
    // transaction, so a miss must also roll back the rows already deleted.
    const { primary, copy2 } = await seedCard();
    const lock = await holdRowLock(primary.id);
    const purge = db.transaction(() =>
      deleteMessages(erste.id, [
        { mcLabel: primary.pmmid!, expectedVersion: primary.version },
        { mcLabel: copy2.pmmid!, expectedVersion: copy2.version },
      ]),
    );
    await waitForLockWaiter();
    await lock.release(async () => {
      await db
        .update(messages)
        .set({ status: "ACTIVE", version: primary.version + 1 })
        .where(eq(messages.id, primary.id));
    });
    const res = await purge;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("version_conflict");
      expect(res.mcLabel).toBe(primary.pmmid);
      expect(res.current?.status).toBe("ACTIVE");
    }
    expect(await getMessage(erste.id, primary.id)).not.toBeNull();
    expect(await getMessage(erste.id, copy2.id)).not.toBeNull();
  });
});
