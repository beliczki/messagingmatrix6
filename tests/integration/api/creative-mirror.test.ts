import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, clients, creatives, messages } from "@/db/schema";
import {
  createCreativeWithMirror,
  ensureAgenticMc,
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
