// Uploading an AdForm reference: the label names the MC its DEFAULT row came
// from ("MC<n><v> — <name>"), and defaultMessageId points at that card.
//
// The DEFAULT row's PMMID says which number + variant, and which released
// version (-n_) went out. The released version is bumped in place
// (REBUILD_SPEC §21), so after a bump no card carries the -n_ a reference
// still shows: the version may only rank the candidates, never filter them.
// Number + variant can also name two cards, the DCO one and its Agentic
// namesake, so the reference's own audiences keep the lookup on its axis.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import xlsx from "node-xlsx";
import { db } from "@/db";
import { audiences, clients, config, feedExports, messages, topics, users } from "@/db/schema";
import { hashPassword, signSession } from "@/lib/auth";
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

const { POST } = await import("@/app/api/adform-snapshots/route");

let h: TestDb;
let erste: { id: number };

const COLUMNS = ["Text:advert_id", "Text:pmmid", "IsDefault", "IsActive"];
const PMMID_PATTERN =
  "p_adform-a_{{Audience_Key}}-m_{{Number}}-t_{{Topic_Key}}-v_{{Variant}}-n_{{Version}}";

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
  await db.insert(config).values([
    { clientId: erste.id, key: "feedStructure", value: COLUMNS.join(", ") },
    {
      clientId: erste.id,
      key: "patterns",
      category: "patterns",
      value: JSON.stringify({ pmmid: PMMID_PATTERN }),
    },
  ]);
  await db.insert(audiences).values([
    { clientId: erste.id, key: "aud1", name: "AUD1", orderIndex: 0, product: "SZK" },
    { clientId: erste.id, key: "aud2", name: "AUD2", orderIndex: 1, product: "SZK" },
    // Agentic axis: a channel-backed audience, its own number space.
    { clientId: erste.id, key: "ch_disp", name: "Display", orderIndex: 2, channel: "DISP" },
  ]);
  await db.insert(topics).values([
    { clientId: erste.id, key: "top1", name: "TOP1", orderIndex: 0, product: "SZK" },
    { clientId: erste.id, key: "nd_top", name: "ND", orderIndex: 1, product: "SZK" },
  ]);
});

afterEach(async () => {
  await h.cleanup();
});

// The reference as AdForm hands it back: the card rows as they went out, and
// the DEFAULT row, whose PMMID carries the sentinel audience "DEFAULT".
function referenceXlsx(cardPmmids: string[], defaultMc: { number: number; variant: string; versionNo: number }) {
  const rows = cardPmmids.map((p, i) => [String(i + 1), p, "FALSE", "TRUE"]);
  rows.push([
    "0",
    `p_adform-a_DEFAULT-m_${defaultMc.number}-t_top1-v_${defaultMc.variant}-n_${defaultMc.versionNo}`,
    "TRUE",
    "TRUE",
  ]);
  return xlsx.build([{ name: "Feed", data: [COLUMNS, ...rows], options: {} }]);
}

async function upload(buffer: Buffer) {
  const [u] = await db.select().from(users).limit(1);
  const form = new FormData();
  form.set("file", new File([new Uint8Array(buffer)], "adform-reference.xlsx"));
  const res = await POST(
    {
      url: "http://localhost/api/adform-snapshots",
      headers: new Headers({ authorization: `Bearer ${await signSession(u)}` }),
      cookies: { get: () => undefined },
      formData: async () => form,
    } as unknown as NextRequest,
    { params: Promise.resolve({}) },
  );
  expect(res.status).toBe(200);
  const { snapshot } = (await res.json()) as { snapshot: { id: number } };
  // The stored reference, as the Feeds list and the export dialog read it.
  const [row] = await db.select().from(feedExports).where(eq(feedExports.id, snapshot.id));
  return row;
}

const pmmidAt = (aud: string, n: number, v: string, ver: number) =>
  `p_adform-a_${aud}-m_${n}-t_top1-v_${v}-n_${ver}`;

async function seedCard(name: string) {
  const card = await createMessage(erste.id, { audience: "aud1", topic: "top1", name });
  await copyMessages(erste.id, [card.pmmid!], ["aud2"]);
  const [copy2] = await db.select().from(messages).where(eq(messages.audience, "aud2"));
  return { card: (await getMessage(erste.id, card.id))!, copy2 };
}

describe("AdForm reference upload — the DEFAULT row's MC", () => {
  it("still names the card after its released version was bumped in place", async () => {
    // The reference went out at n1; the card was bumped to n2 since.
    const { card, copy2 } = await seedCard("Őszi hitel");
    const shipped = [pmmidAt("aud1", card.number, "a", 1), pmmidAt("aud2", card.number, "a", 1)];
    const bumped = await setMessageVersionNo(erste.id, card.id, card.version, 2, "global", null);
    expect(bumped.ok).toBe(true);

    const snap = await upload(referenceXlsx(shipped, { number: card.number, variant: "a", versionNo: 1 }));
    expect(snap.defaultLabel).toBe(`MC${card.number}a — Őszi hitel`);
    expect([card.id, copy2.id]).toContain(snap.defaultMessageId);
  });

  it("prefers the card at the reference's released version when the number + variant stands at several", async () => {
    // A number + variant can exist at more than one released version (Erste's
    // MC302b at n1 and n4). The one the reference shows is the one meant.
    const { card, copy2 } = await seedCard("n1 name");
    const later = await setMessageVersionNo(erste.id, copy2.id, copy2.version, 4, "local", null);
    expect(later.ok).toBe(true);
    await db.update(messages).set({ name: "n4 name" }).where(eq(messages.id, copy2.id));

    const snap = await upload(
      referenceXlsx([pmmidAt("aud1", card.number, "a", 1), pmmidAt("aud2", card.number, "a", 4)], {
        number: card.number,
        variant: "a",
        versionNo: 4,
      }),
    );
    expect(snap.defaultLabel).toBe(`MC${card.number}a — n4 name`);
    expect(snap.defaultMessageId).toBe(copy2.id);
  });

  it("takes the card on the reference's own audiences over its Agentic namesake", async () => {
    // The DCO card was bumped to n2; the Agentic namesake still stands at n1,
    // the version the reference shows. The namesake is a different card.
    const { card } = await seedCard("DCO card");
    const shipped = [pmmidAt("aud1", card.number, "a", 1), pmmidAt("aud2", card.number, "a", 1)];
    const agentic = await createMessage(
      erste.id,
      { audience: "ch_disp", topic: "nd_top", name: "Agentic namesake" },
      { requestedNumber: card.number },
    );
    expect(agentic.variant).toBe("a");
    expect(agentic.versionNo).toBe(1);
    const bumped = await setMessageVersionNo(erste.id, card.id, card.version, 2, "global", null);
    expect(bumped.ok).toBe(true);

    const snap = await upload(referenceXlsx(shipped, { number: card.number, variant: "a", versionNo: 1 }));
    expect(snap.defaultLabel).toBe(`MC${card.number}a — DCO card`);
    expect(snap.defaultMessageId).not.toBe(agentic.id);
  });
});
