/**
 * One-off: undo the MC407 re-drafting (user, 2026-09-24).
 *
 * The bulk promote placed a/b/c on DISP, and the sibling pass after each letter
 * re-drafted it (ensureAgenticMc mistook a just-promoted letter for one the
 * brief never named), so drafts 36118–36120 reappeared on the wall and the
 * three live cells were left without image1. Archive the stray drafts, then run
 * the sibling pass again with the fixed gate so the delivered files land.
 *
 *   npx tsx scripts/fix-mc407-redrafts.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { archiveMessage, getMessage } from "@/lib/entities/messages";
import { placeAgenticSiblings } from "@/lib/entities/promote";
import { writeAudit } from "@/lib/audit";

const STRAY = [36118, 36119, 36120];

async function main() {
  const [erste] = await db.select().from(clients).where(eq(clients.key, "erste"));
  const cid = erste!.id;

  for (const id of STRAY) {
    const d = await getMessage(cid, id);
    if (!d || d.number !== 407 || d.status !== "DRAFT" || d.archivedAt) {
      throw new Error(`message ${id} is not an open MC407 draft — stopping`);
    }
    const res = await archiveMessage(cid, id, d.version);
    if (!res.ok) throw new Error(`archive of ${id} refused`);
    await writeAudit({
      clientId: cid,
      userId: null,
      entityType: "messages",
      entityId: id,
      action: "archive",
      before: d,
      after: res.row,
    });
    console.log(`archived draft ${id} (MC407${d.variant})`);
  }

  for (const v of ["a", "b", "c"]) {
    const out = await placeAgenticSiblings(cid, 407, v);
    console.log(
      `MC407${v}:`,
      out.map((r) => `${r.reason ?? "created"} ${r.message?.audience ?? ""} ${r.message?.image1 ?? ""}`),
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
