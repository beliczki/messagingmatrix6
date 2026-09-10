/**
 * One-off: clone MC328a's creative fields (content + styles + custom CSS +
 * images + variant classes) onto the freshly created MC328b and MC328c in the
 * same cell (HK_INCOMING / HK_edukacio_nehezseg_benefit_easypay).
 *
 * Field set = pickWritable(source) minus the placement columns, i.e. exactly
 * what `copyMessages` clones — minus audience/topic, which define the cell and
 * are identical here anyway. Number and variant are untouched.
 *
 * Goes through updateMessage, so the trafficking columns are regenerated and
 * the optimistic-lock version bumps the same way a UI save would. PMMID stays
 * put — it is the row's stable identity, and neither cell nor number changed.
 *
 *   npx tsx scripts/copy-mc328a-to-bc.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { pickWritable, updateMessage } from "@/lib/entities/messages";

const SOURCE_ID = 35991; // MC328a
const TARGET_IDS = [35993, 35994]; // MC328b, MC328c

async function main() {
  const [source] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, SOURCE_ID));
  if (!source) throw new Error(`source ${SOURCE_ID} not found`);

  const { audience: _a, topic: _t, ...fields } = pickWritable(source);
  console.log(
    `source MC${source.number}${source.variant} → copying ${Object.keys(fields).length} fields`,
  );

  for (const id of TARGET_IDS) {
    const [target] = await db.select().from(messages).where(eq(messages.id, id));
    if (!target) throw new Error(`target ${id} not found`);
    if (target.number !== source.number) {
      throw new Error(
        `target ${id} is MC${target.number}${target.variant}, not an MC${source.number} variant`,
      );
    }
    const res = await updateMessage(
      source.clientId,
      id,
      target.version,
      fields,
    );
    if (!res.ok) throw new Error(`update of ${id} failed (version conflict)`);
    console.log(
      `  ✓ MC${res.row.number}${res.row.variant} (id ${id}) — version ${target.version} → ${res.row.version}`,
    );
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
