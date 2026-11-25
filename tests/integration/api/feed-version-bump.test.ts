// A version bump on a card that already went out in an uploaded feed.
//
// The bump happens in place (REBUILD_SPEC §21, D1): the row keeps its id and
// gets a new PMMID. The feed keys rows by PMMID, so on the next export the old
// PMMID is "a baseline row MM6 no longer builds", and rule 7 of the feed
// carry-forward (feed-export.ts; project_adform_export_invariants) re-emits it
// verbatim with IsActive=FALSE. These tests guard that this keeps holding for a
// bump, so a bumped live card APPENDS instead of forcing a new feed version.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import {
  audiences,
  clients,
  config,
  feedExports,
  messages,
  topics,
  users,
} from "@/db/schema";
import { hashPassword, signSession } from "@/lib/auth";
import { deserializePayload, serializePayload } from "@/lib/feed-export";
import {
  copyMessages,
  createMessage,
  getMessage,
  setMessageVersionNo,
} from "@/lib/entities/messages";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";

const { POST } = await import("@/app/api/feed-exports/route");

let h: TestDb;
let erste: { id: number };

// The shape of Erste's live feed (config read 2026-11-25): advert_id is the MM6
// message id, and the ReportingLabel embeds the PMMID.
const FEED_STRUCTURE = "Text:advert_id, Text:pmmid, ReportingLabel, IsDefault, IsActive";
const ERSTE_FEED = {
  "Text:advert_id": "{{id}}",
  "Text:pmmid": "{{pmmid}}",
  ReportingLabel: "{{pmmid}}-l_{{audiences[audience].lineitem_id}}",
  IsDefault: "FALSE",
  IsActive: "{{status}}=ACTIVE?TRUE:FALSE",
};
const PMMID_PATTERN =
  "p_adform-a_{{Audience_Key}}-m_{{Number}}-t_{{Topic_Key}}-v_{{Variant}}-n_{{Version}}";

async function writeConfig(feed: Record<string, string>) {
  await db.insert(config).values([
    { clientId: erste.id, key: "feedStructure", value: FEED_STRUCTURE },
    {
      clientId: erste.id,
      key: "patterns",
      category: "patterns",
      value: JSON.stringify({ pmmid: PMMID_PATTERN, feed, trafficking: { utm_cd26: "{{PMMID}}" } }),
    },
  ]);
}

beforeEach(async () => {
  h = await createTestDb();
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
  withActiveClientKey("erste");
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  await db.insert(users).values({
    id: "u-admin",
    clientId: erste.id,
    email: "admin@erste.test",
    password: await hashPassword("password123"),
    role: "admin",
  });
  await db.insert(audiences).values([
    { clientId: erste.id, key: "aud1", name: "AUD1", orderIndex: 0, product: "SZK", lineitemId: "111" },
    { clientId: erste.id, key: "aud2", name: "AUD2", orderIndex: 1, product: "SZK", lineitemId: "222" },
  ]);
  await db.insert(topics).values({ clientId: erste.id, key: "top1", name: "TOP1", orderIndex: 0, product: "SZK" });
});

afterEach(async () => {
  await h.cleanup();
});

type ExportBody = {
  feedExport: { id: number } | null;
  decision: { action: string; feedVersion: number; reasons: string[] };
  diff: { added: number; removed: number; changed: number; unchangedCount: number };
  rowSet?: { rows: Record<string, string>[] };
};

async function exportFeed(opts: { dryRun: boolean; defaultMessageId: number | null; messageIds: number[] }) {
  const [u] = await db.select().from(users).limit(1);
  const res = await POST(
    {
      url: "http://localhost/api/feed-exports",
      headers: new Headers({ authorization: `Bearer ${await signSession(u)}` }),
      cookies: { get: () => undefined },
      json: async () => ({ product: "SZK", ...opts }),
    } as unknown as NextRequest,
    { params: Promise.resolve({}) },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as ExportBody;
}

async function seedLiveCard() {
  const card = await createMessage(erste.id, { audience: "aud1", topic: "top1", status: "ACTIVE" });
  await copyMessages(erste.id, [card.pmmid!], ["aud2"]);
  const [copy2] = await db.select().from(messages).where(eq(messages.audience, "aud2"));
  const ids = [card.id, copy2.id];
  // The feed that went out: exported, then marked uploaded by a person.
  const first = await exportFeed({ dryRun: false, defaultMessageId: card.id, messageIds: ids });
  await db
    .update(feedExports)
    .set({ uploadedToAdformAt: "2026-11-20 10:00:00" })
    .where(eq(feedExports.id, first.feedExport!.id));
  const [baselineRow] = await db.select().from(feedExports).where(eq(feedExports.id, first.feedExport!.id));
  const baseline = deserializePayload(baselineRow.payloadJson)!;
  return { card: (await getMessage(erste.id, card.id))!, copy2, ids, baseline };
}

const byPmmid = (rows: Record<string, string>[]) =>
  new Map(rows.map((r) => [r["Text:pmmid"], r] as const));

async function committedRows(ids: number[], defaultMessageId: number) {
  const out = await exportFeed({ dryRun: false, defaultMessageId, messageIds: ids });
  const [row] = await db.select().from(feedExports).where(eq(feedExports.id, out.feedExport!.id));
  return { out, payload: deserializePayload(row.payloadJson)! };
}

describe("feed export after a version bump on a live card (MM6 export baseline)", () => {
  beforeEach(async () => {
    await writeConfig(ERSTE_FEED);
  });

  it("Local: appends one row and keeps the old PMMID row verbatim, switched off", async () => {
    const { card, ids, baseline } = await seedLiveCard();
    const oldPmmid = card.pmmid!;
    const res = await setMessageVersionNo(erste.id, card.id, card.version, 2, "local", "u-admin");
    expect(res.ok).toBe(true);
    const newPmmid = `p_adform-a_aud1-m_${card.number}-t_top1-v_a-n_2`;

    const dry = await exportFeed({ dryRun: true, defaultMessageId: card.id, messageIds: ids });
    expect(dry.decision.action).toBe("append");
    expect(dry.diff.removed).toBe(0);
    expect(dry.diff.added).toBe(1);

    const { payload } = await committedRows(ids, card.id);
    const rows = byPmmid(payload.rows);
    expect(rows.get(newPmmid)?.IsActive).toBe("TRUE");
    // Verbatim: every column as it went out, except that it no longer serves.
    const before = byPmmid(baseline.rows).get(oldPmmid)!;
    expect(rows.get(oldPmmid)).toEqual({ ...before, IsActive: "FALSE" });
  });

  it("Global: one new row per audience copy, every old row kept switched off", async () => {
    const { card, ids, baseline } = await seedLiveCard();
    const res = await setMessageVersionNo(erste.id, card.id, card.version, 2, "global", "u-admin");
    expect(res.ok).toBe(true);

    const dry = await exportFeed({ dryRun: true, defaultMessageId: card.id, messageIds: ids });
    expect(dry.decision.action).toBe("append");
    expect(dry.diff.removed).toBe(0);
    expect(dry.diff.added).toBe(2);

    const { payload } = await committedRows(ids, card.id);
    const rows = byPmmid(payload.rows);
    for (const aud of ["aud1", "aud2"]) {
      const oldKey = `p_adform-a_${aud}-m_${card.number}-t_top1-v_a-n_1`;
      const newKey = `p_adform-a_${aud}-m_${card.number}-t_top1-v_a-n_2`;
      expect(rows.get(newKey)?.IsActive).toBe("TRUE");
      expect(rows.get(oldKey)).toEqual({ ...byPmmid(baseline.rows).get(oldKey)!, IsActive: "FALSE" });
    }
  });

  it("carries the DEFAULT row across unchanged, old -n_ and all (invariant 8)", async () => {
    const { card, ids, baseline } = await seedLiveCard();
    await setMessageVersionNo(erste.id, card.id, card.version, 2, "global", "u-admin");
    const { payload } = await committedRows(ids, card.id);
    expect(payload.rows[payload.defaultRowIndex]).toEqual(baseline.rows[baseline.defaultRowIndex]);
  });
});

describe("feed export after a version bump (AdForm reference baseline)", () => {
  beforeEach(async () => {
    await writeConfig(ERSTE_FEED);
  });

  it("matches by PMMID and appends, keeping the old row switched off", async () => {
    const { card, ids, baseline } = await seedLiveCard();
    // What AdForm holds, uploaded after the export: same rows, no MM6 ids.
    await db.insert(feedExports).values({
      clientId: erste.id,
      product: "SZK",
      platform: "adform",
      source: "adform_snapshot",
      feedVersion: 0,
      exportedBy: null,
      uploadedToAdformAt: "2026-11-21 10:00:00",
      rowCount: baseline.rows.length,
      notes: "Uploaded from AdForm: szk.xlsx",
      payloadJson: serializePayload({ ...baseline, messageIds: baseline.rows.map(() => -1) }),
    });
    await setMessageVersionNo(erste.id, card.id, card.version, 2, "local", "u-admin");

    const dry = await exportFeed({ dryRun: true, defaultMessageId: card.id, messageIds: ids });
    expect(dry.decision.action).toBe("append");
    expect(dry.diff.removed).toBe(0);
    expect(dry.diff.added).toBe(1);
  });
});

describe("precondition: the feed's row key must contain the PMMID", () => {
  it("documents today's behaviour when the ReportingLabel does not embed it", async () => {
    // Not a supported configuration (REBUILD_SPEC §21 states the precondition),
    // pinned so a change to it is noticed. An MM6↔MM6 diff keys rows by
    // (advert_id, ReportingLabel); advert_id is the message id, so without the
    // PMMID in the label the old and the new row share a key. The decision is
    // still "append" and both rows are in the file, but the preview counts the
    // new row as not added.
    await writeConfig({ ...ERSTE_FEED, ReportingLabel: "{{number}}{{variant}}-l_{{audiences[audience].lineitem_id}}" });
    const { card, ids } = await seedLiveCard();
    await setMessageVersionNo(erste.id, card.id, card.version, 2, "local", "u-admin");

    const dry = await exportFeed({ dryRun: true, defaultMessageId: card.id, messageIds: ids });
    expect(dry.decision.action).toBe("append");
    expect(dry.diff.removed).toBe(0);
    expect(dry.diff.added).toBe(0);

    const { payload } = await committedRows(ids, card.id);
    const rows = byPmmid(payload.rows);
    expect(rows.get(`p_adform-a_aud1-m_${card.number}-t_top1-v_a-n_2`)?.IsActive).toBe("TRUE");
    expect(rows.get(`p_adform-a_aud1-m_${card.number}-t_top1-v_a-n_1`)?.IsActive).toBe("FALSE");
  });
});
