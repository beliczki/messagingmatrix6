/**
 * One-off: undo the MC410 re-drafting (user, 2026-09-30).
 *
 * A Both card promoted onto a DCO row (SZK_wlaltalanosszk): the sibling pass
 * after each letter only counted a CHANNEL cell as placed, so it re-drafted
 * a/b/c as empty drafts 36124–36126 and placed none of the delivered files.
 * Archive the stray drafts, then run the sibling pass again with the fixed
 * gate (6.116.2), landing the files in the promoted cells' topic.
 *
 *   npx tsx scripts/fix-mc410-redrafts.ts
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

const STRAY = [36124, 36125, 36126];
const PROMOTED = [36114, 36115, 36116];

async function main() {
  const [erste] = await db.select().from(clients).where(eq(clients.key, "erste"));
  const cid = erste!.id;

  for (const id of STRAY) {
    const d = await getMessage(cid, id);
    if (!d || d.number !== 410 || d.status !== "DRAFT" || d.archivedAt || d.headline) {
      throw new Error(`message ${id} is not an empty open MC410 draft — stopping`);
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
    console.log(`archived draft ${id} (MC410${d.variant})`);
  }

  for (const id of PROMOTED) {
    const m = await getMessage(cid, id);
    if (!m || m.number !== 410 || m.status === "DRAFT" || !m.topic) {
      throw new Error(`message ${id} is not a placed MC410 cell — stopping`);
    }
    const out = await placeAgenticSiblings(cid, 410, m.variant, m.topic);
    console.log(
      `MC410${m.variant}:`,
      out.map((r) => `${r.reason ?? "created"} ${r.message?.audience ?? ""} ${r.message?.topic ?? ""}`),
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
