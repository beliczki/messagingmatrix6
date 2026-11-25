// The MC version (`messages.version_no`, PMMID -n_; REBUILD_SPEC §21): set by
// hand on one audience copy (Local) or on every copy of the card on its axis
// (Global). Terms: the VERSION is version_no; `version` is the save counter.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import {
  audiences,
  auditLog,
  clients,
  config,
  messages,
  topics,
  users,
} from "@/db/schema";
import { hashPassword, signSession } from "@/lib/auth";
import {
  copyMessages,
  createMessage,
  getMessage,
  MessageError,
  moveMessages,
  setMessageVersionNo,
} from "@/lib/entities/messages";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";
import { holdRowLock, waitForLockWaiter } from "../../helpers/row-lock";

const { POST } = await import("@/app/api/messages/[id]/version/route");
const { PATCH } = await import("@/app/api/messages/[id]/route");

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

const PATTERNS = {
  pmmid: "a_{{Audience_Key}}-t_{{Topic_Key}}-m_{{Number}}-v_{{Variant}}-n_{{Version}}",
  trafficking: {
    utm_cd26: "{{PMMID}}",
    final_trafficked_url: "{{Landing_URL}}?utm_cd26={{utm_cd26}}",
  },
};
const LP = "https://erste.hu/lp";

beforeEach(async () => {
  h = await createTestDb();
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
  withActiveClientKey("erste");
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  [telekom] = await db.insert(clients).values({ key: "telekom", name: "Telekom" }).returning();
  await db.insert(config).values({
    clientId: erste.id,
    key: "patterns",
    category: "patterns",
    value: JSON.stringify(PATTERNS),
  });
  await db.insert(users).values([
    { id: "u-admin", clientId: erste.id, email: "admin@erste.test", password: await hashPassword("password123"), role: "admin" },
    { id: "u-demo", clientId: erste.id, email: "demo@erste.test", password: await hashPassword("password123"), role: "demo" },
  ]);
  await db.insert(audiences).values([
    { clientId: erste.id, key: "aud1", name: "AUD1", orderIndex: 0, product: "SZK" },
    { clientId: erste.id, key: "aud2", name: "AUD2", orderIndex: 1, product: "SZK" },
    { clientId: erste.id, key: "aud3", name: "AUD3", orderIndex: 2, product: "SZK" },
    // Agentic axis: a channel-backed audience. Its MC numbers are their own
    // space, so a card there may share number+variant with a DCO card.
    { clientId: erste.id, key: "ch_disp", name: "Display", orderIndex: 3, channel: "DISP" },
  ]);
  await db.insert(topics).values([
    { clientId: erste.id, key: "top1", name: "TOP1", orderIndex: 0, product: "SZK" },
    { clientId: erste.id, key: "nd_top", name: "ND", orderIndex: 1, product: "SZK" },
  ]);
});

afterEach(async () => {
  await h.cleanup();
});

// MC<n>a on aud1, copied to aud2 and aud3 (one card, three audience copies),
// MC<n>b next to it in the aud1 cell, and the Agentic MC<n>a namesake.
async function seedCard() {
  const primary = await createMessage(erste.id, {
    audience: "aud1",
    topic: "top1",
    status: "ACTIVE",
    landingUrl: LP,
  });
  await copyMessages(erste.id, [primary.pmmid!], ["aud2", "aud3"]);
  const otherVariant = await createMessage(erste.id, {
    audience: "aud1",
    topic: "top1",
    landingUrl: LP,
  });
  const agentic = await createMessage(
    erste.id,
    { audience: "ch_disp", topic: "nd_top", landingUrl: LP },
    { requestedNumber: primary.number },
  );
  const rows = await db.select().from(messages).where(eq(messages.clientId, erste.id));
  const copy = (aud: string) =>
    rows.find((r) => r.audience === aud && r.number === primary.number && r.variant === "a")!;
  expect(otherVariant.variant).toBe("b");
  expect(agentic.variant).toBe("a");
  return {
    primary: (await getMessage(erste.id, primary.id))!,
    copy2: copy("aud2"),
    copy3: copy("aud3"),
    otherVariant,
    agentic,
  };
}

const pmmidFor = (aud: string, top: string, n: number, v: string, ver: number) =>
  `a_${aud}-t_${top}-m_${n}-v_${v}-n_${ver}`;

async function reread(id: number) {
  return (await getMessage(erste.id, id))!;
}

function req(opts: {
  token?: string;
  ifMatch?: number;
  body?: unknown;
  url?: string;
}): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  if (opts.ifMatch !== undefined) headers.set("if-match", String(opts.ifMatch));
  return {
    url: opts.url ?? "http://localhost/api/messages/x/version",
    headers,
    cookies: { get: () => undefined },
    json: async () => opts.body ?? null,
  } as unknown as NextRequest;
}

async function tokenFor(userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  return signSession(u);
}

describe("setMessageVersionNo — Local", () => {
  it("sets the version on the open copy only and rebuilds its PMMID and trafficking", async () => {
    const { primary, copy2 } = await seedCard();
    expect(primary.versionNo).toBe(1);

    const res = await setMessageVersionNo(erste.id, primary.id, primary.version, 2, "local", "u-admin");
    expect(res.ok).toBe(true);

    const after = await reread(primary.id);
    const expected = pmmidFor("aud1", "top1", primary.number, "a", 2);
    expect(after.versionNo).toBe(2);
    expect(after.pmmid).toBe(expected);
    expect(after.utmCd26).toBe(expected);
    expect(after.finalTraffickedUrl).toBe(`${LP}?utm_cd26=${expected}`);
    // The save counter moves by one; it is not the version.
    expect(after.version).toBe(primary.version + 1);

    const sib = await reread(copy2.id);
    expect(sib.versionNo).toBe(1);
    expect(sib.pmmid).toBe(pmmidFor("aud2", "top1", primary.number, "a", 1));
    expect(sib.version).toBe(copy2.version);
  });

  it("accepts a lower value too, to correct a version or match a delivered _nN file", async () => {
    const { primary } = await seedCard();
    await setMessageVersionNo(erste.id, primary.id, primary.version, 5, "local", "u-admin");
    const mid = await reread(primary.id);
    const res = await setMessageVersionNo(erste.id, primary.id, mid.version, 3, "local", "u-admin");
    expect(res.ok).toBe(true);
    expect((await reread(primary.id)).pmmid).toBe(pmmidFor("aud1", "top1", primary.number, "a", 3));
  });

  it("writes nothing when the copy already has that version", async () => {
    const { primary } = await seedCard();
    const res = await setMessageVersionNo(erste.id, primary.id, primary.version, 1, "local", "u-admin");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.changedIds).toEqual([]);
    expect((await reread(primary.id)).version).toBe(primary.version);
  });
});

describe("setMessageVersionNo — Global", () => {
  it("sets it on every audience copy of the card on the same axis, and nowhere else", async () => {
    const { primary, copy2, copy3, otherVariant, agentic } = await seedCard();
    const res = await setMessageVersionNo(erste.id, primary.id, primary.version, 2, "global", "u-admin");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changedIds.sort()).toEqual([primary.id, copy2.id, copy3.id].sort());
      expect(res.siblings.map((s) => s.id).sort()).toEqual([copy2.id, copy3.id].sort());
    }

    for (const [row, aud] of [[primary, "aud1"], [copy2, "aud2"], [copy3, "aud3"]] as const) {
      const after = await reread(row.id);
      const expected = pmmidFor(aud, "top1", primary.number, "a", 2);
      expect(after.versionNo).toBe(2);
      expect(after.pmmid).toBe(expected);
      expect(after.utmCd26).toBe(expected);
      expect(after.finalTraffickedUrl).toBe(`${LP}?utm_cd26=${expected}`);
      expect(after.version).toBe(row.version + 1);
    }
    // Another variant of the number is a parallel card, not this card.
    const b = await reread(otherVariant.id);
    expect(b.versionNo).toBe(1);
    expect(b.pmmid).toBe(otherVariant.pmmid);
    // The Agentic namesake shares number+variant but is a different card.
    const ag = await reread(agentic.id);
    expect(ag.versionNo).toBe(1);
    expect(ag.pmmid).toBe(agentic.pmmid);
  });

  it("skips archived copies", async () => {
    const { primary, copy3 } = await seedCard();
    await db.update(messages).set({ archivedAt: "2026-11-01 10:00:00" }).where(eq(messages.id, copy3.id));
    await setMessageVersionNo(erste.id, primary.id, primary.version, 2, "global", "u-admin");
    expect((await reread(copy3.id)).versionNo).toBe(1);
  });

  it("writes one audit entry per changed copy, so each keeps its history", async () => {
    const { primary, copy2, copy3 } = await seedCard();
    await setMessageVersionNo(erste.id, primary.id, primary.version, 2, "global", "u-admin");
    for (const id of [primary.id, copy2.id, copy3.id]) {
      const entries = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "messages"), eq(auditLog.entityId, String(id)), eq(auditLog.action, "update")));
      expect(entries).toHaveLength(1);
      expect(entries[0].userId).toBe("u-admin");
      expect(JSON.parse(entries[0].after!).versionNo).toBe(2);
      expect(JSON.parse(entries[0].before!).versionNo).toBe(1);
    }
  });
});

describe("setMessageVersionNo — refusals", () => {
  it("refuses a stale save counter and writes nothing", async () => {
    const { primary, copy2 } = await seedCard();
    const res = await setMessageVersionNo(erste.id, primary.id, primary.version - 1, 2, "global", "u-admin");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("version_mismatch");
    expect((await reread(primary.id)).versionNo).toBe(1);
    expect((await reread(copy2.id)).versionNo).toBe(1);
  });

  it("loses to a write that lands while it waits for the row (no lost update)", async () => {
    const { primary, copy2 } = await seedCard();
    const lock = await holdRowLock(primary.id);
    const bump = setMessageVersionNo(erste.id, primary.id, primary.version, 2, "global", "u-admin");
    await waitForLockWaiter();
    await lock.release(async () => {
      await db.update(messages).set({ headline: "peer edit", version: primary.version + 1 }).where(eq(messages.id, primary.id));
    });
    const res = await bump;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("version_mismatch");
    // All or nothing: the siblings were not bumped either.
    expect((await reread(primary.id)).versionNo).toBe(1);
    expect((await reread(copy2.id)).versionNo).toBe(1);
  });

  it("does not reach another client's card", async () => {
    const { primary } = await seedCard();
    const res = await setMessageVersionNo(telekom.id, primary.id, primary.version, 2, "local", "u-admin");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("not_found");
    expect((await reread(primary.id)).versionNo).toBe(1);
  });

  // 2147483647 is the top of Postgres `integer`, the version_no column's type.
  it("accepts the largest version the column holds", async () => {
    const { primary } = await seedCard();
    const res = await setMessageVersionNo(erste.id, primary.id, primary.version, 2147483647, "local", "u-admin");
    expect(res.ok).toBe(true);
    expect((await reread(primary.id)).pmmid).toBe(pmmidFor("aud1", "top1", primary.number, "a", 2147483647));
  });

  it("a Global bump that waited through a move off its variant answers a conflict, not not-found", async () => {
    // A move into a cell where number+variant is taken gives the mover the
    // next free variant. The bump located the card before the move and locks
    // by number+variant, so the moved card is no longer among the locked rows.
    // The card still exists and its save counter moved: that is a conflict.
    // (A move refuses ACTIVE/INACTIVE cards, so this one is APPROVED.)
    const seeded = await seedCard();
    await db.update(messages).set({ status: "APPROVED" }).where(eq(messages.id, seeded.primary.id));
    const primary = await reread(seeded.primary.id);
    const lock = await holdRowLock(primary.id);
    const bump = setMessageVersionNo(erste.id, primary.id, primary.version, 2, "global", "u-admin");
    await waitForLockWaiter();
    await lock.release(async () => {
      const moved = await moveMessages(erste.id, [{ mcLabel: primary.pmmid!, expectedVersion: primary.version }], "aud2");
      expect(moved.ok).toBe(true);
    });
    const res = await bump;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("version_mismatch");
      if (res.reason === "version_mismatch") {
        expect(res.current.id).toBe(primary.id);
        expect(res.current.version).toBe(primary.version + 1);
        expect(res.current.variant).toBe("b");
      }
    }
    expect((await reread(primary.id)).versionNo).toBe(1);
  });

  it.each([0, -1, 1.5, Number.NaN, 2147483648])("refuses %s as a version", async (bad) => {
    const { primary } = await seedCard();
    await expect(
      setMessageVersionNo(erste.id, primary.id, primary.version, bad, "local", "u-admin"),
    ).rejects.toBeInstanceOf(MessageError);
  });

  it("refuses a draft: it has no cell and no PMMID yet", async () => {
    const [draft] = await db
      .insert(messages)
      .values({ clientId: erste.id, number: 900, variant: "a", status: "DRAFT", audience: null, topic: null })
      .returning();
    await expect(
      setMessageVersionNo(erste.id, draft.id, draft.version, 2, "local", "u-admin"),
    ).rejects.toThrow(/draft/i);
  });

  it("refuses an archived card", async () => {
    const { primary } = await seedCard();
    await db.update(messages).set({ archivedAt: "2026-11-01 10:00:00" }).where(eq(messages.id, primary.id));
    const row = await reread(primary.id);
    await expect(
      setMessageVersionNo(erste.id, row.id, row.version, 2, "local", "u-admin"),
    ).rejects.toThrow(/archived/i);
  });
});

describe("the PATCH path cannot touch the version", () => {
  it("a History restore of a pre-bump entry keeps the version and the PMMID", async () => {
    // The History drawer PATCHes a whole audit `after` back, version_no and
    // pmmid included. If versionNo were a writable field, that would silently
    // take the card back to n1.
    const { primary } = await seedCard();
    await setMessageVersionNo(erste.id, primary.id, primary.version, 2, "local", "u-admin");
    const bumped = await reread(primary.id);
    const res = await PATCH(
      req({
        token: await tokenFor("u-admin"),
        ifMatch: bumped.version,
        body: { ...primary, headline: "restored" },
        url: `http://localhost/api/messages/${primary.id}`,
      }),
      { params: Promise.resolve({ id: String(primary.id) }) },
    );
    expect(res.status).toBe(200);
    const after = await reread(primary.id);
    expect(after.headline).toBe("restored");
    expect(after.versionNo).toBe(2);
    expect(after.pmmid).toBe(pmmidFor("aud1", "top1", primary.number, "a", 2));
    expect(after.utmCd26).toBe(after.pmmid);
  });
});

describe("POST /api/messages/[id]/version", () => {
  async function call(id: number, opts: Parameters<typeof req>[0]) {
    return POST(req(opts), { params: Promise.resolve({ id: String(id) }) });
  }

  it("sets the version and returns the card and its changed copies", async () => {
    const { primary, copy2, copy3 } = await seedCard();
    const res = await call(primary.id, {
      token: await tokenFor("u-admin"),
      ifMatch: primary.version,
      body: { versionNo: 2, scope: "global" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      message: { id: number; versionNo: number; pmmid: string };
      siblings: Array<{ id: number }>;
      changed: number;
    };
    expect(body.message.versionNo).toBe(2);
    expect(body.message.pmmid).toBe(pmmidFor("aud1", "top1", primary.number, "a", 2));
    expect(body.siblings.map((s) => s.id).sort()).toEqual([copy2.id, copy3.id].sort());
    expect(body.changed).toBe(3);
  });

  it("answers 409 with the current row on a stale If-Match", async () => {
    const { primary } = await seedCard();
    const res = await call(primary.id, {
      token: await tokenFor("u-admin"),
      ifMatch: primary.version + 7,
      body: { versionNo: 2, scope: "local" },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { currentRow: { id: number } };
    expect(body.currentRow.id).toBe(primary.id);
  });

  it("needs If-Match", async () => {
    const { primary } = await seedCard();
    const res = await call(primary.id, {
      token: await tokenFor("u-admin"),
      body: { versionNo: 2, scope: "local" },
    });
    expect(res.status).toBe(428);
  });

  it.each([
    [{ versionNo: 2 }, "missing scope"],
    [{ versionNo: 2, scope: "everywhere" }, "unknown scope"],
    [{ versionNo: 0, scope: "local" }, "version below 1"],
    [{ versionNo: "2", scope: "local" }, "version as a string"],
    [{ versionNo: 2147483648, scope: "local" }, "version above the integer column"],
  ] as Array<[unknown, string]>)("answers 400 for %j (%s)", async (body) => {
    const { primary } = await seedCard();
    const res = await call(primary.id, {
      token: await tokenFor("u-admin"),
      ifMatch: primary.version,
      body,
    });
    expect(res.status).toBe(400);
    expect((await reread(primary.id)).versionNo).toBe(1);
  });

  it("answers 401 without a session and 403 for a demo user", async () => {
    const { primary } = await seedCard();
    const anon = await call(primary.id, { ifMatch: primary.version, body: { versionNo: 2, scope: "local" } });
    expect(anon.status).toBe(401);
    const demo = await call(primary.id, {
      token: await tokenFor("u-demo"),
      ifMatch: primary.version,
      body: { versionNo: 2, scope: "local" },
    });
    expect(demo.status).toBe(403);
    expect((await reread(primary.id)).versionNo).toBe(1);
  });

  it("answers 404 for another client's card", async () => {
    const [foreign] = await db
      .insert(messages)
      .values({ clientId: telekom.id, number: 5, variant: "a", audience: "x", topic: "y", pmmid: "p" })
      .returning();
    const res = await call(foreign.id, {
      token: await tokenFor("u-admin"),
      ifMatch: foreign.version,
      body: { versionNo: 2, scope: "local" },
    });
    expect(res.status).toBe(404);
  });
});
