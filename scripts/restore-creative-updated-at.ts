// Put `creatives.updated_at` back to the last time the creative really changed.
//
// The dashboard's creative strip windows and orders on `updated_at` — it is the
// "last change, which is what the strip claims to show". Three bookkeeping
// passes in this thread wrote that column without anything about the creative
// changing: the image-reading imports (930 rows on 21 Sept, 147 more on the
// 23rd) and the variant-plan renames (35). The result is a dashboard whose last
// 30 days are filled with files delivered in 2024.
//
// A reading is not a delivery. So the column goes back to the newest evidence
// of a REAL change, which is one of:
//   * the newest audit entry for that creative that is NOT one of those silent
//     passes — a `create`, a `bulk_update`, or any entry carrying a user_id;
//   * failing that, `created_at`. A delivered file that was never edited after
//     upload last changed when it arrived.
//
// Archived rows are left alone: the strip does not show them, and their
// `updated_at` records when they were archived, which is true.
//
//   npx tsx --env-file=.env.local scripts/restore-creative-updated-at.ts \
//     [--apply] [--since 2026-09-21] [--client erste]
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";

/** When the silent bookkeeping passes began — nothing before this is theirs. */
const DEFAULT_SINCE = "2026-09-21";

type Row = {
  id: number;
  file_name: string | null;
  created_at: string;
  updated_at: string;
  restore_to: string;
};

async function main() {
  const args = process.argv.slice(2);
  const get = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const apply = args.includes("--apply");
  const since = get("--since") ?? DEFAULT_SINCE;
  const clientKey = get("--client") ?? "erste";

  const [client] = await db.select().from(clients).where(eq(clients.key, clientKey)).limit(1);
  if (!client) throw new Error(`nincs ilyen kliens: ${clientKey}`);

  // `mine` is the silent pass: an update with no user behind it, written since
  // the readings began. Everything else in the log is real history.
  const rows = (await db.execute(sql`
    with real_change as (
      select a.entity_id::int as id, max(a.created_at) as at
      from audit_log a
      where a.client_id = ${client.id}
        and a.entity_type = 'creatives'
        and not (a.action = 'update' and a.user_id is null and a.created_at >= ${since})
      group by 1
    )
    select c.id,
           c.file_name,
           c.created_at,
           c.updated_at,
           greatest(c.created_at, coalesce(r.at, c.created_at)) as restore_to
    from creatives c
    left join real_change r on r.id = c.id
    where c.client_id = ${client.id}
      and c.archived_at is null
      and c.updated_at >= ${since}
      and greatest(c.created_at, coalesce(r.at, c.created_at)) < c.updated_at
    order by c.updated_at desc, c.id
  `)) as unknown as Row[];

  console.log(`${rows.length} kreatív updated_at-je hamis "változást" állít\n`);
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    const k = r.restore_to.slice(0, 7);
    byMonth.set(k, (byMonth.get(k) ?? 0) + 1);
  }
  console.log("hova kerülnek vissza:");
  for (const [m, n] of [...byMonth].sort()) console.log(`  ${m}  ${String(n).padStart(4)}`);
  console.log("\nminta:");
  for (const r of rows.slice(0, 5)) {
    console.log(`  id${r.id}  ${r.updated_at} → ${r.restore_to}  ${r.file_name ?? ""}`);
  }

  if (!apply) {
    console.log("\n[SZÁRAZ] semmi nem lett írva. Éles: --apply");
    process.exit(0);
  }

  // Written straight, without touching `version`: this is not an edit of the
  // creative, it is the removal of one that never happened.
  await db.execute(sql`
    with real_change as (
      select a.entity_id::int as id, max(a.created_at) as at
      from audit_log a
      where a.client_id = ${client.id}
        and a.entity_type = 'creatives'
        and not (a.action = 'update' and a.user_id is null and a.created_at >= ${since})
      group by 1
    )
    update creatives c
       set updated_at = greatest(c.created_at, coalesce(r.at, c.created_at))
      from real_change r
     where r.id = c.id
       and c.client_id = ${client.id}
       and c.archived_at is null
       and c.updated_at >= ${since}
       and greatest(c.created_at, coalesce(r.at, c.created_at)) < c.updated_at
  `);
  // Creatives with no audit history at all fall back to their own created_at,
  // and the join above cannot reach them.
  await db.execute(sql`
    update creatives c
       set updated_at = c.created_at
     where c.client_id = ${client.id}
       and c.archived_at is null
       and c.updated_at >= ${since}
       and c.created_at < c.updated_at
       and not exists (
         select 1 from audit_log a
          where a.client_id = c.client_id
            and a.entity_type = 'creatives'
            and a.entity_id = c.id::text
            and not (a.action = 'update' and a.user_id is null and a.created_at >= ${since})
       )
  `);
  console.log(`\nkész: ${rows.length} sor visszadátumozva`);
  process.exit(0);
}

main();
