import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, clients, creatives } from "@/db/schema";
import { applyCreativeManifest } from "@/lib/creative-manifest";
import { createTestDb, type TestDb } from "../helpers/test-db";

// The seam of the creative manifest (tasks/todo.md, 2026-11-23, M1): a Codex
// delivery ships a manifest.json with the text, the description and the
// keywords of each MC + variant, and this fills the matching creatives. It only
// fills empty fields, matches by exact file_name among the client's active
// creatives, and refuses a file whose creative carries another MC or variant.

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

const OLD = "2026-01-01 00:00:00";
const F1 = "ERSTE_SZK_MC101_c_karrier_n1_1080x1080.png";
const F2 = "ERSTE_SZK_MC101_c_karrier_n1_300x250.png";

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  [telekom] = await db.insert(clients).values({ key: "telekom", name: "Telekom" }).returning();
});

afterEach(async () => {
  await h.cleanup();
});

async function creative(over: Partial<typeof creatives.$inferInsert> = {}) {
  const [row] = await db
    .insert(creatives)
    .values({
      clientId: erste.id,
      mcNumber: 101,
      mcVariant: "c",
      fileName: F1,
      type: "image",
      updatedAt: OLD,
      ...over,
    })
    .returning();
  return row!;
}

async function reload(id: number) {
  const [row] = await db.select().from(creatives).where(eq(creatives.id, id));
  return row!;
}

function manifest(files: string[], over: Record<string, unknown> = {}) {
  return {
    version: 1,
    client: "erste",
    source: "codex",
    groups: [
      {
        mc: 101,
        variant: "c",
        image_text: "ERSTE\nSzemélyi kölcsön\nTHM 8,92%",
        image_description: "Szemüveges férfi laptoppal egy kávézóban.",
        copy_keyword: "személyi kölcsön, fix kamat, karrierváltás",
        visual_keyword: "férfi, kávézó, szemüveg, laptop",
        files,
        ...over,
      },
    ],
  };
}

describe("applyCreativeManifest", () => {
  it("fills every empty field, marks the text as given, and audits the write", async () => {
    const c = await creative();

    const report = await applyCreativeManifest(db, erste.id, manifest([F1]), { dry: false });

    expect(report.results).toEqual([
      {
        file: F1,
        mc: 101,
        variant: "c",
        status: "fill",
        creativeId: c.id,
        fill: [
          "image_text",
          "image_description",
          "copy_keyword",
          "visual_keyword",
          "image_read_at",
          "image_read_model",
        ],
        kept: [],
      },
    ]);
    expect(report.writtenIds).toEqual([c.id]);

    const after = await reload(c.id);
    expect(after.imageText).toBe("ERSTE\nSzemélyi kölcsön\nTHM 8,92%");
    expect(after.imageDescription).toBe("Szemüveges férfi laptoppal egy kávézóban.");
    expect(after.copyKeyword).toBe("személyi kölcsön, fix kamat, karrierváltás");
    expect(after.visualKeyword).toBe("férfi, kávézó, szemüveg, laptop");
    expect(after.imageReadModel).toBe("codex-manifest");
    expect(after.imageReadAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(after.updatedAt).not.toBe(OLD);
    expect(after.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, String(c.id)));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.clientId).toBe(erste.id);
    expect(audit[0]!.entityType).toBe("creatives");
    expect(audit[0]!.action).toBe("update");
    expect(JSON.parse(audit[0]!.before!)).toEqual({
      imageText: null,
      imageDescription: null,
      copyKeyword: null,
      visualKeyword: null,
      imageReadAt: null,
      imageReadModel: null,
    });
    expect(JSON.parse(audit[0]!.after!)).toMatchObject({
      imageText: "ERSTE\nSzemélyi kölcsön\nTHM 8,92%",
      copyKeyword: "személyi kölcsön, fix kamat, karrierváltás",
      visualKeyword: "férfi, kávézó, szemüveg, laptop",
      imageReadModel: "codex-manifest",
    });
  });

  it("leaves a filled visual_keyword and a filled reading alone, and fills the rest", async () => {
    const c = await creative({
      visualKeyword: "BeErste3Q2_personas",
      imageText: "ERSTE\nmár leolvasva",
      imageReadAt: "2026-11-23 17:15:47",
      imageReadModel: "kepleltar-v1",
    });

    const report = await applyCreativeManifest(db, erste.id, manifest([F1]), { dry: false });

    expect(report.results[0]).toMatchObject({
      status: "fill",
      fill: ["image_description", "copy_keyword"],
      kept: ["image_text", "visual_keyword"],
    });
    const after = await reload(c.id);
    expect(after.visualKeyword).toBe("BeErste3Q2_personas");
    expect(after.imageText).toBe("ERSTE\nmár leolvasva");
    expect(after.imageReadAt).toBe("2026-11-23 17:15:47");
    expect(after.imageReadModel).toBe("kepleltar-v1");
    expect(after.imageDescription).toBe("Szemüveges férfi laptoppal egy kávézóban.");
    expect(after.copyKeyword).toBe("személyi kölcsön, fix kamat, karrierváltás");
  });

  it("counts an empty string as empty", async () => {
    const c = await creative({ visualKeyword: "", copyKeyword: "  " });
    await applyCreativeManifest(db, erste.id, manifest([F1]), { dry: false });
    const after = await reload(c.id);
    expect(after.visualKeyword).toBe("férfi, kávézó, szemüveg, laptop");
    expect(after.copyKeyword).toBe("személyi kölcsön, fix kamat, karrierváltás");
  });

  it("reports a file with no active creative, and matches neither an archived one nor another client's", async () => {
    const archived = await creative({ archivedAt: "2026-10-01 00:00:00" });
    const foreign = await creative({ clientId: telekom.id });

    const report = await applyCreativeManifest(db, erste.id, manifest([F1, "NINCS_ILYEN_1x1.png"]), {
      dry: false,
    });

    expect(report.results).toEqual([
      { file: F1, mc: 101, variant: "c", status: "not_found" },
      { file: "NINCS_ILYEN_1x1.png", mc: 101, variant: "c", status: "not_found" },
    ]);
    expect(report.writtenIds).toEqual([]);
    expect((await reload(archived.id)).imageText).toBeNull();
    expect((await reload(foreign.id)).imageText).toBeNull();
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("does not write when the creative carries another MC or another variant", async () => {
    const otherMc = await creative({ mcNumber: 102 });
    const otherVariant = await creative({ fileName: F2, mcVariant: "d" });

    const report = await applyCreativeManifest(db, erste.id, manifest([F1, F2]), { dry: false });

    expect(report.results).toEqual([
      {
        file: F1,
        mc: 101,
        variant: "c",
        status: "mc_mismatch",
        creativeId: otherMc.id,
        found: { mc: 102, variant: "c" },
      },
      {
        file: F2,
        mc: 101,
        variant: "c",
        status: "mc_mismatch",
        creativeId: otherVariant.id,
        found: { mc: 101, variant: "d" },
      },
    ]);
    expect(report.writtenIds).toEqual([]);
    for (const id of [otherMc.id, otherVariant.id]) {
      const row = await reload(id);
      expect(row.imageText).toBeNull();
      expect(row.copyKeyword).toBeNull();
      expect(row.updatedAt).toBe(OLD);
    }
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("reads a creative with no variant as variant a", async () => {
    const c = await creative({ mcVariant: null });
    const report = await applyCreativeManifest(db, erste.id, manifest([F1], { variant: "a" }), {
      dry: false,
    });
    expect(report.results[0]).toMatchObject({ status: "fill", creativeId: c.id });
  });

  it("does not write when two active creatives share the file name", async () => {
    const a = await creative();
    const b = await creative();

    const report = await applyCreativeManifest(db, erste.id, manifest([F1]), { dry: false });

    expect(report.results).toEqual([
      { file: F1, mc: 101, variant: "c", status: "ambiguous", creativeIds: [a.id, b.id] },
    ]);
    expect((await reload(a.id)).imageText).toBeNull();
    expect((await reload(b.id)).imageText).toBeNull();
  });

  it("dry reports what it would write and writes nothing", async () => {
    const c = await creative({ visualKeyword: "BeErste3Q2_personas" });

    const report = await applyCreativeManifest(db, erste.id, manifest([F1]), { dry: true });

    expect(report.dry).toBe(true);
    expect(report.writtenIds).toEqual([]);
    expect(report.results[0]).toMatchObject({
      status: "fill",
      creativeId: c.id,
      fill: ["image_text", "image_description", "copy_keyword", "image_read_at", "image_read_model"],
      kept: ["visual_keyword"],
    });
    const after = await reload(c.id);
    expect(after.imageText).toBeNull();
    expect(after.copyKeyword).toBeNull();
    expect(after.imageReadModel).toBeNull();
    expect(after.updatedAt).toBe(OLD);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("is idempotent: a second run finds nothing to fill and audits nothing", async () => {
    const c = await creative();
    await applyCreativeManifest(db, erste.id, manifest([F1]), { dry: false });
    const second = await applyCreativeManifest(db, erste.id, manifest([F1]), { dry: false });

    expect(second.results[0]).toMatchObject({
      status: "nothing_to_fill",
      creativeId: c.id,
      kept: ["image_text", "image_description", "copy_keyword", "visual_keyword"],
    });
    expect(second.writtenIds).toEqual([]);
    expect(await db.select().from(auditLog)).toHaveLength(1);
  });

  it("refuses a manifest written for another client, before any write", async () => {
    await creative();
    await expect(
      applyCreativeManifest(db, telekom.id, manifest([F1]), { dry: false }),
    ).rejects.toThrow(/erste/);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("refuses a malformed manifest, before any write", async () => {
    const c = await creative();
    await expect(
      applyCreativeManifest(db, erste.id, manifest([F1], { copy_keyword: "Személyi Kölcsön, Fix Kamat, X" }), {
        dry: false,
      }),
    ).rejects.toThrow();
    expect((await reload(c.id)).imageText).toBeNull();
  });
});
