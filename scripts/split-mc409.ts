/**
 * One-off (user, 2026-09-30): MC409a → three standalone drafts MC411a, MC412a,
 * MC413a, each a full duplicate of 409a (content + brief), then delete 409a.
 * Same seed as createDraftVariant("duplicate"), but through the new-number
 * path of createDraft, so each copy gets the next free MC number.
 *
 *   npx tsx scripts/split-mc409.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { createDraft, deleteDraft, getMessage, pickWritable } from "@/lib/entities/messages";
import { writeAudit } from "@/lib/audit";

const SOURCE = 36108;
const TARGETS = [411, 412, 413];

async function main() {
  const [erste] = await db.select().from(clients).where(eq(clients.key, "erste"));
  const cid = erste!.id;

  const src = await getMessage(cid, SOURCE);
  if (!src || src.number !== 409 || src.variant !== "a" || src.status !== "DRAFT" || src.audience || src.archivedAt) {
    throw new Error(`message ${SOURCE} is not the open MC409a draft — stopping`);
  }
  const { audience: _audience, ...seed } = pickWritable(src);

  for (const want of TARGETS) {
    const row = await createDraft(cid, seed);
    await writeAudit({
      clientId: cid,
      userId: null,
      entityType: "messages",
      entityId: row.id,
      action: "create",
      after: row,
    });
    console.log(`created draft ${row.id} MC${row.number}${row.variant} "${row.name}"`);
    if (row.number !== want || row.variant !== "a") {
      throw new Error(`expected MC${want}a, got MC${row.number}${row.variant} — stopping before delete`);
    }
  }

  const res = await deleteDraft(cid, src.id, src.version);
  if (!res.ok) throw new Error(`delete of MC409a refused: ${res.reason}`);
  await writeAudit({
    clientId: cid,
    userId: null,
    entityType: "messages",
    entityId: src.id,
    action: "delete",
    before: src,
  });
  console.log(`deleted draft ${src.id} (MC409a)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
