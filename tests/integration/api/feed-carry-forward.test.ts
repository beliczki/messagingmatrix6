import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import {
  audiences,
  clients,
  config,
  feedExports,
  messages,
  topics,
} from "@/db/schema";
import { buildFeedRowSet, serializePayload } from "@/lib/feed-export";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };

const FEED_STRUCTURE = "Text:pmmid, ReportingLabel, IsActive";

async function seedConfig(clientId: number) {
  await db.insert(config).values([
    { clientId, key: "feedStructure", value: FEED_STRUCTURE },
    {
      clientId,
      key: "patterns",
      value: JSON.stringify({
        feed: {
          pmmid: "{{pmmid}}",
          ReportingLabel: "{{number}}{{variant}}",
          IsActive: "{{status}}=ACTIVE?TRUE:FALSE",
        },
      }),
    },
  ]);
}

async function seedMc(clientId: number, n: number, aud: string, top: string) {
  const [row] = await db
    .insert(messages)
    .values({
      clientId,
      number: n,
      variant: "a",
      audience: aud,
      topic: top,
      status: "ACTIVE",
      pmmid: `pmmid-${n}`,
      versionNo: 1,
    })
    .returning();
  return row;
}

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  await seedConfig(erste.id);
  await db.insert(audiences).values({
    clientId: erste.id,
    key: "aud1",
    name: "AUD1",
    orderIndex: 0,
    product: "Loans",
  });
  await db.insert(topics).values({
    clientId: erste.id,
    key: "top1",
    name: "TOP1",
    orderIndex: 0,
    product: "Loans",
  });
});

afterEach(async () => {
  await h.cleanup();
});

async function seedBaseline(clientId: number, messageIds: number[]) {
  await db.insert(feedExports).values({
    clientId,
    product: "Loans",
    platform: "adform",
    feedVersion: 1,
    exportedBy: null,
    uploadedToAdformAt: "2026-08-01 10:00:00",
    rowCount: messageIds.length,
    payloadJson: serializePayload({
      columns: ["Text:pmmid", "ReportingLabel", "IsActive"],
      rows: [],
      messageIds,
      defaultRowIndex: -1,
    }),
  });
}

describe("feed carry-forward", () => {
  it("keeps a live row that today's filter excludes, switched off", async () => {
    // The rule the whole feature exists for: a feed update may modify and
    // append, never delete. Exporting one slice of a product must not drop the
    // rows belonging to the other slice — they stay in the file, not serving.
    const keep = await seedMc(erste.id, 1, "aud1", "top1");
    const excluded = await seedMc(erste.id, 2, "aud1", "top1");
    await seedBaseline(erste.id, [keep.id, excluded.id]);

    const { rowSet } = await buildFeedRowSet({
      clientId: erste.id,
      product: "Loans",
      platform: "adform",
      defaultMessageId: null,
      messageIds: [keep.id],
    });

    expect(rowSet.messageIds.sort()).toEqual([keep.id, excluded.id].sort());
    const byPmmid = new Map(
      rowSet.rows.map((r) => [r["Text:pmmid"], r] as const),
    );
    expect(byPmmid.get("pmmid-1")?.IsActive).toBe("TRUE");
    // Excluded from the selection, so it goes out switched off rather than
    // vanishing — deleting is what a new version is for.
    expect(byPmmid.get("pmmid-2")?.IsActive).toBe("FALSE");
  });

  it("does not resurrect rows the baseline never carried", async () => {
    const keep = await seedMc(erste.id, 1, "aud1", "top1");
    const stranger = await seedMc(erste.id, 2, "aud1", "top1");
    await seedBaseline(erste.id, [keep.id]);

    const { rowSet } = await buildFeedRowSet({
      clientId: erste.id,
      product: "Loans",
      platform: "adform",
      defaultMessageId: null,
      messageIds: [keep.id],
    });

    expect(rowSet.messageIds).toEqual([keep.id]);
    expect(rowSet.messageIds).not.toContain(stranger.id);
  });

  it("serves a selected row normally even when the baseline carries it", async () => {
    const keep = await seedMc(erste.id, 1, "aud1", "top1");
    await seedBaseline(erste.id, [keep.id]);

    const { rowSet } = await buildFeedRowSet({
      clientId: erste.id,
      product: "Loans",
      platform: "adform",
      defaultMessageId: null,
      messageIds: [keep.id],
    });

    expect(rowSet.rows[0]?.IsActive).toBe("TRUE");
  });
});
