// Carry out "Problematic_creatives_teendok.xlsx" against the database.
//
// The plan is produced read-only by gen-variant-actions.ts; this is the only
// step that writes. Two actions:
//
//   ÁTNEVEZ  — the file is the same creative as the reference letter, with a
//              refreshed rate line, so it becomes a VERSION of that letter:
//              file_name, mc_variant and family_key move together. They have
//              to: family_key is derived from the filename stem and CONTAINS
//              the letter, and promote.ts matches a creative to a prodlist
//              deliverable on it — a stale one would point at the old letter.
//   ARCHIVÁL — a redundant export (byte-identical, or the same design written
//              out twice). Reversible: the library's restore puts it back.
//
// DRY BY DEFAULT. `--apply` is the only thing that writes, and the run aborts
// before touching anything if a single row looks wrong — a plan that cannot be
// carried out exactly is a plan to re-examine, not to partially execute.
//
//   npx tsx --env-file=.env.local scripts/apply-variant-actions.ts \
//     [--apply] [--with-ellenoriz] [--client erste]
//
//   --with-ellenoriz  also archive the ELLENŐRIZ rows. The generator leaves
//                     them open on purpose (it could not MEASURE them), so
//                     including them is a human decision and has to be typed.
//   --skip 17830,…    leave these creatives out of the run. For the row the
//                     plan gets wrong and a person has to settle separately —
//                     typed into the command, so the exclusion is visible in
//                     the output rather than hidden in a filter.
import xlsx from "node-xlsx";
import { join } from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, creatives, nowUtc } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { parseCreativeFilename } from "@/lib/parse-creative-filename";
import { versionFamilyKey } from "@/lib/group-creative-versions";

const PLAN = join(
  process.env.HOME!,
  "ERSTE Addressable AI Agent",
  "problematic creatives",
  "Problematic_creatives_teendok.xlsx",
);

const COL = { id: 0, rel: 1, todo: 8, target: 9 } as const;

type Plan = { id: number; rel: string; todo: string; target: string };
type Verdict =
  | { kind: "ÁTNEVEZ"; plan: Plan; set: Record<string, string | null> }
  | { kind: "ARCHIVÁL"; plan: Plan }
  | { kind: "KIHAGY"; plan: Plan; why: string }
  | { kind: "HIBA"; plan: Plan; why: string };

function readPlan(withEllenoriz: boolean): Plan[] {
  const rows = (xlsx.parse(PLAN)[0]!.data as unknown[][]).slice(1);
  const wanted = new Set(["ÁTNEVEZ", "ARCHIVÁL", ...(withEllenoriz ? ["ELLENŐRIZ"] : [])]);
  const out: Plan[] = [];
  for (const r of rows) {
    const todo = String(r[COL.todo] ?? "");
    if (!wanted.has(todo)) continue;
    const id = Number(r[COL.id]);
    if (!Number.isFinite(id) || !id) {
      throw new Error(`a terv sora nem hordoz kreatív id-t: ${String(r[COL.rel])}`);
    }
    out.push({ id, rel: String(r[COL.rel] ?? ""), todo, target: String(r[COL.target] ?? "") });
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const apply = args.includes("--apply");
  const withEllenoriz = args.includes("--with-ellenoriz");
  const skip = new Set(
    (get("--skip") ?? "").split(",").map((x) => Number(x.trim())).filter(Boolean),
  );
  const clientKey = get("--client") ?? "erste";

  const [client] = await db.select().from(clients).where(eq(clients.key, clientKey)).limit(1);
  if (!client) throw new Error(`nincs ilyen kliens: ${clientKey}`);

  const plan = readPlan(withEllenoriz).filter((p) => !skip.has(p.id));
  if (skip.size) console.log(`kihagyva parancsból: ${[...skip].map((i) => `id${i}`).join(", ")}\n`);
  const live = await db
    .select()
    .from(creatives)
    .where(and(eq(creatives.clientId, client.id), isNull(creatives.archivedAt)));
  const byId = new Map(live.map((c) => [c.id, c]));
  // Which live creative currently holds a given filename — the only way to see
  // a rename that would land on top of another row.
  const holder = new Map<string, number>();
  for (const c of live) if (c.fileName) holder.set(c.fileName, c.id);

  const verdicts: Verdict[] = plan.map((p): Verdict => {
    const c = byId.get(p.id);
    if (!c) return { kind: "HIBA", plan: p, why: `nincs élő kreatív ezzel az id-vel (${p.id})` };

    if (p.todo === "ARCHIVÁL" || p.todo === "ELLENŐRIZ") {
      return { kind: "ARCHIVÁL", plan: p };
    }

    if (!p.target) return { kind: "HIBA", plan: p, why: "az ÁTNEVEZ sorhoz nincs célnév" };
    if (p.target === c.fileName) {
      // The generator describes the RELATIONSHIP (this file is version N of the
      // reference letter). When the file is already named that way there is
      // nothing to carry out — MC330/331/332 arrived correctly named.
      return { kind: "KIHAGY", plan: p, why: "már pontosan így hívják" };
    }
    const taken = holder.get(p.target);
    if (taken !== undefined && taken !== c.id) {
      return { kind: "HIBA", plan: p, why: `a célnevet másik élő kreatív viseli (id ${taken})` };
    }

    const parsed = parseCreativeFilename(p.target);
    if (!parsed.mcVariant || !parsed.familyKey) {
      return { kind: "HIBA", plan: p, why: `a célnévből nem olvasható betű/családkulcs: ${p.target}` };
    }

    // THE VERSION MUST LAND ON TOP, NEVER UNDER. The generator numbers a rename
    // from the distinct rate lines it saw INSIDE one exported size group, which
    // knows nothing about the versions the target family already holds. MC130
    // is the case that proves it: its `a` family already carries n3 and n4, and
    // the plan wants the NEWEST file (b_n5) to become n2 — which would file the
    // latest delivery below two older ones and make `versionLadder` hand the
    // matrix n4 as the current creative. Same derivation of "family" as the app
    // uses, on purpose: two of them would eventually disagree.
    const fam = versionFamilyKey(p.target);
    if (fam) {
      const above = live
        .filter((o) => o.id !== c.id && o.fileName)
        .map((o) => ({ o, f: versionFamilyKey(o.fileName!) }))
        .filter((e) => e.f && e.f.key === fam.key && e.f.version >= fam.version);
      if (above.length) {
        const names = above.map((e) => `${e.o.fileName} (n${e.f!.version})`).join(", ");
        return {
          kind: "HIBA",
          plan: p,
          why: `a célverzió n${fam.version}, de a célcsalád már tart ennél nem régebbit: ${names}`,
        };
      }
    }
    // banner_version only moves when it is currently IN SYNC with the filename.
    // It comes from the imported spreadsheet's "Version" column and is null on
    // UI uploads — writing a number into a field that never held one would be
    // inventing data, not migrating it.
    const oldVersion = parseCreativeFilename(c.fileName ?? "").version;
    const bannerMoves = c.bannerVersion !== null && c.bannerVersion === String(oldVersion);

    return {
      kind: "ÁTNEVEZ",
      plan: p,
      set: {
        fileName: p.target,
        mcVariant: parsed.mcVariant.toLowerCase(),
        familyKey: parsed.familyKey,
        ...(bannerMoves ? { bannerVersion: String(parsed.version) } : {}),
      },
    };
  });

  const errors = verdicts.filter((v) => v.kind === "HIBA");
  const renames = verdicts.filter((v) => v.kind === "ÁTNEVEZ");
  const archives = verdicts.filter((v) => v.kind === "ARCHIVÁL");
  const skips = verdicts.filter((v) => v.kind === "KIHAGY");

  console.log(`terv: ${plan.length} sor${withEllenoriz ? " (az ELLENŐRIZ sorokkal együtt)" : ""}\n`);
  for (const v of renames) {
    const c = byId.get(v.plan.id)!;
    console.log(`  ÁTNEVEZ  id${v.plan.id}  ${c.fileName}\n           →        ${v.set.fileName}`);
  }
  if (renames.length) console.log();
  for (const v of archives) {
    const c = byId.get(v.plan.id)!;
    console.log(`  ARCHIVÁL id${v.plan.id}  MC${c.mcNumber}${c.mcVariant ?? ""}  ${c.fileName}`);
  }
  if (skips.length) {
    console.log(`\n  kihagyva (${skips.length}): már pontosan így hívják`);
    for (const v of skips) console.log(`    id${v.plan.id}  ${v.plan.target}`);
  }

  if (errors.length) {
    console.log(`\n!! ${errors.length} sort nem lehet végrehajtani:`);
    for (const v of errors) console.log(`   id${v.plan.id}  ${(v as { why: string }).why}`);
    console.log("\nSemmi nem lett írva. Egy terv, amit nem lehet pontosan végrehajtani,");
    console.log("újragondolandó — nem részben végrehajtandó.");
    process.exit(1);
  }

  console.log(`\nösszesítés: ${renames.length} átnevezés, ${archives.length} archiválás, ${skips.length} kihagyva`);
  if (!apply) {
    console.log("\n[SZÁRAZ FUTÁS] semmi nem lett írva. Éles futtatás: --apply");
    process.exit(0);
  }

  for (const v of renames) {
    const before = byId.get(v.plan.id)!;
    await db
      .update(creatives)
      .set({ ...v.set, version: sql`${creatives.version} + 1`, updatedAt: nowUtc })
      .where(and(eq(creatives.clientId, client.id), eq(creatives.id, v.plan.id)));
    await writeAudit({
      clientId: client.id,
      userId: null,
      entityType: "creatives",
      entityId: v.plan.id,
      action: "update",
      before: { fileName: before.fileName, mcVariant: before.mcVariant, familyKey: before.familyKey, bannerVersion: before.bannerVersion },
      after: v.set,
      silent: true,
    });
  }
  for (const v of archives) {
    const before = byId.get(v.plan.id)!;
    await db
      .update(creatives)
      .set({ archivedAt: nowUtc, version: sql`${creatives.version} + 1`, updatedAt: nowUtc })
      .where(and(eq(creatives.clientId, client.id), eq(creatives.id, v.plan.id)));
    await writeAudit({
      clientId: client.id,
      userId: null,
      entityType: "creatives",
      entityId: v.plan.id,
      action: "archive",
      before: { archivedAt: before.archivedAt, fileName: before.fileName },
      after: { archivedAt: "most" },
      silent: true,
    });
  }
  console.log(`\nkész: ${renames.length} átnevezve, ${archives.length} archiválva`);
  process.exit(0);
}

main();
