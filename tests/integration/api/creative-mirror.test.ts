import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, clients, creatives, messages } from "@/db/schema";
import {
  createCreativeWithMirror,
  ensureAgenticMc,
  placeAgenticSiblings,
} from "@/lib/entities/promote";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };

async function seedChannel(clientId: number, code: string, order: number) {
  await db.insert(channels).values({
    clientId,
    key: `ch_${code.toLowerCase()}`,
    code,
    label: code,
    orderIndex: order,
  });
}

// What the Creative Library posts: the parsing rules have already read the MC
// number and variant out of the filename by the time the row is written.
function upload(clientId: number, fileName: string) {
  const m = fileName.match(/_MC(\d+)_([a-z])_/i)!;
  return createCreativeWithMirror(clientId, {
    fileName,
    product: "SZA",
    mcNumber: parseInt(m[1]!, 10),
    mcVariant: m[2]!.toLowerCase(),
  });
}

async function agenticCells(clientId: number, number: number) {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.clientId, clientId), eq(messages.number, number)));
}

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  await seedChannel(erste.id, "DISP", 0);
  await seedChannel(erste.id, "SOC", 1);
  withActiveClientKey("erste");
});

afterEach(async () => {
  await h.cleanup();
});

describe("uploading a correctly-named creative fills the Agentic matrix", () => {
  it("creates a template-less MC at the number the filename names", async () => {
    await upload(erste.id, "ERSTE_SZA_MC324_a_DiakszamlaQ3_n2_300x250.png");

    const cells = await agenticCells(erste.id, 324);
    expect(cells).toHaveLength(1);
    expect(cells[0].variant).toBe("a");
    expect(cells[0].audience).toBe("ch_disp");
    expect(cells[0].template).toBeNull();
    expect(cells[0].image1).toBe("ERSTE_SZA_MC324_a_DiakszamlaQ3_n2_300x250.png");
    // A delivered file, not a card waiting to be written.
    expect(cells[0].status).toBe("ACTIVE");
    expect(cells[0].pmmid).toBeTruthy();
  });

  it("routes by declared size: social sizes land on SOC, the rest on DISP", async () => {
    await upload(erste.id, "ERSTE_SZA_MC324_a_DiakszamlaQ3_n2_300x250.png");
    await upload(erste.id, "ERSTE_SZA_MC324_a_DiakszamlaQ3_n2_1080x1080.png");

    const cells = await agenticCells(erste.id, 324);
    expect(cells.map((c) => c.audience).sort()).toEqual(["ch_disp", "ch_soc"]);
  });

  it("does not duplicate the cell as the rest of the sizes arrive", async () => {
    for (const size of ["300x250", "300x600", "970x250", "1200x1200"]) {
      await upload(erste.id, `ERSTE_SZA_MC324_a_DiakszamlaQ3_n2_${size}.png`);
    }

    const cells = await agenticCells(erste.id, 324);
    expect(cells).toHaveLength(1);
    // The first file in stays the cover — image1 may have been curated since.
    expect(cells[0].image1).toBe("ERSTE_SZA_MC324_a_DiakszamlaQ3_n2_300x250.png");
  });

  it("puts a later variant in the cell its number already occupies", async () => {
    await upload(erste.id, "ERSTE_SZA_MC324_a_DiakszamlaQ3_csakfoto_n2_300x250.png");
    await upload(erste.id, "ERSTE_SZA_MC324_b_DiakszamlaQ3_n2_300x250.png");

    const cells = await agenticCells(erste.id, 324);
    expect(cells).toHaveLength(2);
    expect(cells.map((c) => c.variant).sort()).toEqual(["a", "b"]);
    // A number never spans topics within an axis: b joins a's row, it does not
    // open a second one under its own keywords.
    expect(new Set(cells.map((c) => c.topic))).toEqual(
      new Set(["SZA_DiakszamlaQ3_csakfoto"]),
    );
  });

  it("leaves an un-numbered creative alone", async () => {
    const creative = await createCreativeWithMirror(erste.id, {
      fileName: "ERSTE_SZA_MC_a_valami_n1_300x250.png",
      product: "SZA",
    });
    expect(creative.id).toBeTruthy();
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it("skips — does not throw — when the client has no channels", async () => {
    await db.delete(channels).where(eq(channels.clientId, erste.id));
    const creative = await upload(
      erste.id,
      "ERSTE_SZA_MC324_a_DiakszamlaQ3_n2_300x250.png",
    );
    expect(creative.mcNumber).toBe(324);
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it("mirrors a creative whose row predates the mirror (the backfill path)", async () => {
    // mc_number/mc_variant set, no message anywhere — the state every file
    // uploaded between the batch import and this fix was left in.
    const [creative] = await db
      .insert(creatives)
      .values({
        clientId: erste.id,
        fileName: "ERSTE_SZA_MC324_b_DiakszamlaQ3_n2_970x250.png",
        product: "SZA",
        mcNumber: 324,
        mcVariant: "b",
      })
      .returning();

    const first = await ensureAgenticMc(erste.id, creative);
    expect(first.created).toBe(true);
    // Idempotent: a re-run finds its own work instead of doubling it.
    const second = await ensureAgenticMc(erste.id, creative);
    expect(second.created).toBe(false);
    expect(second.reason).toBe("exists");
    expect(await agenticCells(erste.id, 324)).toHaveLength(1);
  });
});

// The draft is a gate. Uploading used to place the cell anyway, which stranded
// the draft on the wall AND made its promote impossible — the cell it wanted to
// create was already there (MC404/MC405, 2026-09-22).
describe("a live draft holds the number until it is promoted", () => {
  async function draftOn(number: number, variant: string) {
    const [row] = await db
      .insert(messages)
      .values({
        clientId: erste.id,
        number,
        variant,
        audience: null,
        topic: "tervezett_topic",
        status: "DRAFT",
        draftTarget: "agentic",
      })
      .returning();
    return row!;
  }

  it("creates no cell while the draft is open", async () => {
    await draftOn(404, "a");
    await upload(erste.id, "ERSTE_SZA_MC404_a_balaton_n1_300x250.png");

    const rows = await agenticCells(erste.id, 404);
    // Only the draft itself: nothing was placed.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.audience).toBeNull();
  });

  it("still places the cell for a number with no draft", async () => {
    await upload(erste.id, "ERSTE_SZA_MC406_a_balaton_n1_300x250.png");
    const rows = await agenticCells(erste.id, 406);
    expect(rows.map((r) => r.audience)).toEqual(["ch_disp"]);
  });

  // Reversed on 2026-09-23. The gate used to be per (number, variant), and the
  // letter with no draft of its own walked straight past it: it minted a live
  // cell in a topic derived from its filename and took the NUMBER's topic with
  // it, which then refused the drafted letter's own promote ("a number never
  // spans topics"). MC406 is the case — `a` was drafted and correctly skipped
  // while `b` and `c` placed themselves and carried the number off.
  it("holds the number for a letter the brief never named, and drafts it", async () => {
    const source = await draftOn(407, "a");
    await upload(erste.id, "ERSTE_SZA_MC407_b_balaton_n1_300x250.png");

    const rows = await agenticCells(erste.id, 407);
    // Nothing placed: the number is still the draft's.
    expect(rows.filter((r) => r.audience !== null)).toHaveLength(0);
    // And the delivered letter is waiting as a draft variant, not as something
    // somebody has to notice and type in.
    const drafts = rows.filter((r) => r.audience === null);
    expect(drafts.map((r) => r.variant).sort()).toEqual(["a", "b"]);
    // The brief belongs to the MC, not to the variant.
    expect(drafts.find((r) => r.variant === "b")!.topic).toBe(source.topic);
  });

  it("adds the letter once, however many sizes arrive for it", async () => {
    await draftOn(408, "a");
    await upload(erste.id, "ERSTE_SZA_MC408_b_balaton_n1_300x250.png");
    await upload(erste.id, "ERSTE_SZA_MC408_b_balaton_n1_970x250.png");
    const drafts = (await agenticCells(erste.id, 408)).filter((r) => r.audience === null);
    expect(drafts.map((r) => r.variant).sort()).toEqual(["a", "b"]);
  });

  // A DCO draft and an Agentic cell may legally share a number, so a draft
  // heading elsewhere does not hold this axis — the same scoping promoteDraft's
  // cross-topic check uses.
  it("a DCO-targeted draft does not hold the Agentic axis", async () => {
    const [d] = await db
      .insert(messages)
      .values({
        clientId: erste.id,
        number: 409,
        variant: "a",
        audience: null,
        topic: "tervezett_topic",
        status: "DRAFT",
        draftTarget: "dco",
      })
      .returning();
    expect(d).toBeTruthy();
    await upload(erste.id, "ERSTE_SZA_MC409_a_balaton_n1_300x250.png");
    const rows = await agenticCells(erste.id, 409);
    expect(rows.filter((r) => r.audience === "ch_disp")).toHaveLength(1);
  });

  it("places every size's channel once the draft is gone", async () => {
    const draft = await draftOn(405, "a");
    await upload(erste.id, "ERSTE_SZA_MC405_a_balaton_n1_300x250.png");
    await upload(erste.id, "ERSTE_SZA_MC405_a_balaton_n1_1080x1080.png");
    expect(await agenticCells(erste.id, 405)).toHaveLength(1);

    // What a promote does to the draft row, without going through the route.
    await db
      .update(messages)
      .set({ audience: "ch_disp", status: "PREVIEW" })
      .where(eq(messages.id, draft.id));
    await placeAgenticSiblings(erste.id, 405, "a");

    const rows = await agenticCells(erste.id, 405);
    // The promoted row on DISP, plus the social size that had been waiting.
    expect(rows.map((r) => r.audience).sort()).toEqual(["ch_disp", "ch_soc"]);
  });

  // MC407, 2026-09-24. The bulk promote places siblings after EACH letter, so
  // when `a` is placed, `b` and `c` are still open drafts holding the number —
  // and `a`, no longer drafted, used to look like a letter the brief never
  // named. Every promoted letter was re-drafted, and its cell got no file.
  it("a bulk promote leaves no draft behind and gives each cell its file", async () => {
    const drafts = [await draftOn(410, "a"), await draftOn(410, "b"), await draftOn(410, "c")];
    for (const v of ["a", "b", "c"]) {
      await upload(erste.id, `ERSTE_SZA_MC410_${v}_balaton_n1_300x250.png`);
    }

    // The route's loop: promote one letter, place its siblings, next letter.
    for (const d of drafts) {
      await db
        .update(messages)
        .set({ audience: "ch_disp", status: "ACTIVE" })
        .where(eq(messages.id, d.id));
      await placeAgenticSiblings(erste.id, 410, d.variant);
    }

    const rows = await agenticCells(erste.id, 410);
    expect(rows.filter((r) => r.audience === null)).toHaveLength(0);
    expect(rows.map((r) => [r.variant, r.image1])).toEqual([
      ["a", "ERSTE_SZA_MC410_a_balaton_n1_300x250.png"],
      ["b", "ERSTE_SZA_MC410_b_balaton_n1_300x250.png"],
      ["c", "ERSTE_SZA_MC410_c_balaton_n1_300x250.png"],
    ]);
  });
});
