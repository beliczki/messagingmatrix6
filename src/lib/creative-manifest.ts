// The creative manifest: what a Codex delivery says about its own files.
//
// When Codex produces a delivery it also writes a `manifest.json` (form and
// instruction: `creative-manifest.md` next to this file). Each group holds one
// MC + variant whose files share the same text: the text on the picture, its
// description, and the keywords of the copy and of the visual. This fills the
// matching creatives from it, so the matrix does not have to read the pictures
// afterwards.
//
// The rules (tasks/todo.md, 2026-11-23, "Kreatív-manifest", Robi's decisions):
// - A file is matched by its exact `file_name` among the client's ACTIVE
//   creatives. No match, several matches, or a creative that carries another
//   MC or variant than the group are reported and never written.
// - Only empty fields are filled, all six of them. A filled `image_text` or
//   `visual_keyword` stays as it is. So `visual_keyword` has two senses from
//   here on: on old rows a file-name slice (REBUILD_SPEC §6.4), on rows filled
//   from a manifest the keywords of the visual description.
// - `image_read_model = codex-manifest` marks the text as given by whoever made
//   the picture, not read off it.
// - Every write is one audit row (before: the empty values), inside one
//   transaction for the whole run, so a failed run leaves nothing behind.
//
// Stage 1 calls this from `scripts/import-creative-manifest.ts`; the upload
// (stage 2) is meant to call the same function.
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { db as appDb } from "@/db";
import { clients, creatives, nowUtc } from "@/db/schema";
import { writeAudit } from "@/lib/audit";

export const MANIFEST_READ_MODEL = "codex-manifest";

const nonBlank = z.string().trim().min(1);

// 3–6 keywords, lowercase, Hungarian, separated by commas (Robi, 2026-11-23).
// Spacing around the commas is normalised to `a, b, c`; anything else is
// refused, not repaired — the manifest is a contract, and a repaired keyword
// would be one nobody wrote.
const keywords = z.string().transform((raw, ctx) => {
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.some((p) => p === "")) {
    ctx.addIssue({ code: "custom", message: `üres kulcsszó: "${raw}"` });
    return z.NEVER;
  }
  if (parts.length < 3 || parts.length > 6) {
    ctx.addIssue({ code: "custom", message: `3–6 kulcsszó kell, itt ${parts.length} van: "${raw}"` });
    return z.NEVER;
  }
  const capital = parts.find((p) => p !== p.toLocaleLowerCase("hu-HU"));
  if (capital) {
    ctx.addIssue({ code: "custom", message: `a kulcsszó kisbetűs legyen: "${capital}"` });
    return z.NEVER;
  }
  return parts.join(", ");
});

const groupSchema = z.strictObject({
  mc: z.number().int().positive(),
  variant: z.string().regex(/^[a-z]$/, "a variáns egy kisbetű (a, b, c …)"),
  image_text: nonBlank,
  image_description: nonBlank,
  copy_keyword: keywords,
  visual_keyword: keywords,
  files: z.array(nonBlank).min(1),
});

export const creativeManifestSchema = z
  .strictObject({
    version: z.literal(1),
    client: nonBlank,
    source: z.literal("codex"),
    groups: z.array(groupSchema).min(1),
  })
  .superRefine((m, ctx) => {
    // One file, one set of values: a file in two groups would leave the result
    // to the order of the groups.
    const seen = new Set<string>();
    for (const g of m.groups) {
      for (const f of g.files) {
        if (seen.has(f)) ctx.addIssue({ code: "custom", message: `a fájl több csoportban is szerepel: ${f}` });
        seen.add(f);
      }
    }
  });

export type CreativeManifest = z.infer<typeof creativeManifestSchema>;

// The column names, in the order the report lists them. The provenance pair is
// written with the reading (image_text / image_description), never on its own.
type ContentField = "image_text" | "image_description" | "copy_keyword" | "visual_keyword";
export type ManifestField = ContentField | "image_read_at" | "image_read_model";

const CONTENT_FIELDS = [
  ["image_text", "imageText"],
  ["image_description", "imageDescription"],
  ["copy_keyword", "copyKeyword"],
  ["visual_keyword", "visualKeyword"],
] as const satisfies readonly (readonly [ContentField, keyof typeof creatives.$inferSelect])[];

type Where = { file: string; mc: number; variant: string };
export type ManifestFileResult =
  | (Where & { status: "fill"; creativeId: number; fill: ManifestField[]; kept: ContentField[] })
  | (Where & { status: "nothing_to_fill"; creativeId: number; kept: ContentField[] })
  | (Where & { status: "not_found" })
  | (Where & { status: "ambiguous"; creativeIds: number[] })
  | (Where & { status: "mc_mismatch"; creativeId: number; found: { mc: number | null; variant: string } });

export type ManifestReport = {
  dry: boolean;
  /** One entry per file, in manifest order. In a dry run `fill` is what would be written. */
  results: ManifestFileResult[];
  /** The creatives written in this run: the rollback list. Empty in a dry run. */
  writtenIds: number[];
};

const isEmpty = (v: string | null) => v === null || v.trim() === "";

/**
 * Fill the client's creatives from a manifest. `input` is the parsed JSON as it
 * came; it is validated here, so no caller can skip the contract. Throws before
 * any write on a malformed manifest or one written for another client.
 */
export async function applyCreativeManifest(
  db: typeof appDb,
  clientId: number,
  input: unknown,
  opts: { dry: boolean },
): Promise<ManifestReport> {
  const manifest = creativeManifestSchema.parse(input);

  const [client] = await db.select({ key: clients.key }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new Error(`nincs ilyen kliens: ${clientId}`);
  if (client.key !== manifest.client) {
    throw new Error(`a manifest a(z) "${manifest.client}" kliensé, nem a(z) "${client.key}" kliensé`);
  }

  // `db` is the app's handle: inside `db.transaction` it routes every query —
  // these and the audit insert in writeAudit — through the one transaction.
  const run = async (): Promise<ManifestReport> => {
    const files = manifest.groups.flatMap((g) => g.files);
    // Bounded by the manifest, not by the table. FOR UPDATE on a live run: a
    // value someone types between this read and the write must not be taken
    // for empty.
    const query = db
      .select()
      .from(creatives)
      .where(and(eq(creatives.clientId, clientId), isNull(creatives.archivedAt), inArray(creatives.fileName, files)))
      .orderBy(creatives.id);
    const rows = opts.dry ? await query : await query.for("update");

    const byName = new Map<string, (typeof rows)[number][]>();
    for (const r of rows) {
      const list = byName.get(r.fileName!);
      if (list) list.push(r);
      else byName.set(r.fileName!, [r]);
    }

    const results: ManifestFileResult[] = [];
    const writtenIds: number[] = [];

    for (const g of manifest.groups) {
      for (const file of g.files) {
        const where: Where = { file, mc: g.mc, variant: g.variant };
        const hits = byName.get(file);
        if (!hits) {
          results.push({ ...where, status: "not_found" });
          continue;
        }
        if (hits.length > 1) {
          results.push({ ...where, status: "ambiguous", creativeIds: hits.map((h) => h.id) });
          continue;
        }
        const c = hits[0]!;
        // A creative with no variant is variant a, as everywhere else.
        const variant = (c.mcVariant ?? "a").toLowerCase();
        if (c.mcNumber !== g.mc || variant !== g.variant) {
          results.push({ ...where, status: "mc_mismatch", creativeId: c.id, found: { mc: c.mcNumber, variant } });
          continue;
        }

        const fill: ManifestField[] = [];
        const kept: ContentField[] = [];
        const set: PgUpdateSetSource<typeof creatives> = {};
        const before: Record<string, string | null> = {};
        for (const [name, key] of CONTENT_FIELDS) {
          if (isEmpty(c[key])) {
            fill.push(name);
            set[key] = g[name];
            before[key] = c[key];
          } else {
            kept.push(name);
          }
        }
        // Provenance belongs to the reading. Written only where empty too: a
        // creative whose text was read (kepleltar-v1) and whose description
        // comes from here keeps the reader's label; the audit row says which
        // field came from the manifest.
        if (fill.includes("image_text") || fill.includes("image_description")) {
          if (isEmpty(c.imageReadAt)) {
            fill.push("image_read_at");
            set.imageReadAt = nowUtc;
            before.imageReadAt = c.imageReadAt;
          }
          if (isEmpty(c.imageReadModel)) {
            fill.push("image_read_model");
            set.imageReadModel = MANIFEST_READ_MODEL;
            before.imageReadModel = c.imageReadModel;
          }
        }

        if (fill.length === 0) {
          results.push({ ...where, status: "nothing_to_fill", creativeId: c.id, kept });
          continue;
        }
        results.push({ ...where, status: "fill", creativeId: c.id, fill, kept });
        if (opts.dry) continue;

        // The SQL fragment, not a JS date: timestamps here are UTC
        // `YYYY-MM-DD HH:MM:SS` strings written by the DB ('T' > ' ').
        const [written] = await db
          .update(creatives)
          .set({ ...set, updatedAt: nowUtc })
          .where(eq(creatives.id, c.id))
          .returning();
        const after: Record<string, string | null> = {};
        for (const key of Object.keys(before)) after[key] = written![key as keyof typeof written] as string | null;
        await writeAudit({
          clientId,
          userId: null,
          entityType: "creatives",
          entityId: c.id,
          action: "update",
          before,
          after,
          silent: true,
        });
        writtenIds.push(c.id);
      }
    }

    return { dry: opts.dry, results, writtenIds };
  };

  return opts.dry ? run() : db.transaction(() => run());
}
