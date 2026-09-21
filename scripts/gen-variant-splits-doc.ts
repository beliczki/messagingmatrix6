// Build docs/variant-splits.md — every MC number whose files are spread across
// several VARIANT letters although the filenames say the same thing.
//
// Why a report and not a rename: the letters are not reliably redundant. The
// flagship case (MC97) carries three 300x250 files — `a` and `b` byte-identical
// (same sha256) and `f` a DIFFERENT picture at the same size. Folding the
// letters together blind would put two different creatives into one cell and
// silently lose one of them. So the classification is mechanical and the
// decision stays human: this doc tells you which MCs are safe to collapse,
// which hold real duplicates, and which only look alike.
//
// Read-only over the live DB; safe to re-run after every rename round.
//   npx tsx --env-file=.env.local scripts/gen-variant-splits-doc.ts [clientKey]
//
// Classes, in the order a human wants to act on them:
//   DUPLICATE   same sha256 under two letters — the letter is the only
//               difference; one of them can go.
//   SIZE-SPLIT  a letter that holds ONE size which a fuller letter also holds,
//               with the same keywords — the preprocessing split by size.
//               Marked `same bytes` or `different picture` per size, because
//               that is exactly what decides whether it can be folded back.
//   LOOKALIKE   several letters, each with the full size set and the same
//               keywords, all different bytes — genuinely different creatives
//               that were named alike. Nothing to merge; rename to tell them
//               apart if the sameness is the problem.
import { writeFileSync } from "node:fs";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, creatives, uploadedFiles } from "@/db/schema";
import { parseCreativeFilename } from "@/lib/parse-creative-filename";

type Row = {
  variant: string;
  size: string;
  sha: string | null;
  fileName: string;
  keywords: string;
};

function sizeSet(rows: Row[]): string[] {
  return [...new Set(rows.map((r) => r.size))].sort();
}

async function main() {
  const clientKey = process.argv[2] ?? "erste";
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.key, clientKey))
    .limit(1);
  if (!client) throw new Error(`no client '${clientKey}'`);

  const rows = await db
    .select({
      mcNumber: creatives.mcNumber,
      mcVariant: creatives.mcVariant,
      fileName: creatives.fileName,
      fileDimensions: creatives.fileDimensions,
      sha: uploadedFiles.sha256,
    })
    .from(creatives)
    .leftJoin(uploadedFiles, eq(uploadedFiles.id, creatives.fileId))
    .where(and(eq(creatives.clientId, client.id), isNull(creatives.archivedAt)));

  const byNumber = new Map<number, Row[]>();
  for (const r of rows) {
    if (r.mcNumber == null || !r.fileName) continue;
    const parsed = parseCreativeFilename(r.fileName);
    byNumber.set(r.mcNumber, [
      ...(byNumber.get(r.mcNumber) ?? []),
      {
        variant: (r.mcVariant ?? "a").toLowerCase(),
        size: parsed.declaredDimensions ?? r.fileDimensions ?? "?",
        sha: r.sha,
        fileName: r.fileName,
        keywords: parsed.keywords.trim().toLowerCase(),
      },
    ]);
  }

  const out: string[] = [];
  out.push("# Variant splits — MC numbers spread across letters that say the same thing");
  out.push("");
  out.push(
    `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · client **${client.key}** · ` +
      "`npx tsx --env-file=.env.local scripts/gen-variant-splits-doc.ts`",
  );
  out.push("");
  out.push(
    "A letter is a MESSAGE, not a size — every size of one message belongs under one letter. " +
      "These MCs disagree with that. The classes below say what each one actually is, because " +
      "the letters are not interchangeable: the same size can hold a different picture under a " +
      "different letter, and folding them blind loses one.",
  );
  out.push("");

  const dup: string[] = [];
  const split: string[] = [];
  const lookalike: string[] = [];

  for (const [number, list] of [...byNumber].sort((a, b) => a[0] - b[0])) {
    const variants = [...new Set(list.map((r) => r.variant))].sort();
    if (variants.length < 2) continue;
    const keywords = new Set(list.map((r) => r.keywords));
    if (keywords.size > 1) continue; // different messages: the letters are right

    const byVariant = new Map<string, Row[]>();
    for (const r of list) byVariant.set(r.variant, [...(byVariant.get(r.variant) ?? []), r]);

    // DUPLICATE: one sha256 under two letters.
    const shaToVariants = new Map<string, Set<string>>();
    for (const r of list) {
      if (!r.sha) continue;
      shaToVariants.set(r.sha, (shaToVariants.get(r.sha) ?? new Set()).add(r.variant));
    }
    const dupShas = [...shaToVariants].filter(([, v]) => v.size > 1);
    if (dupShas.length > 0) {
      dup.push(
        `- **MC${number}** — ${dupShas.length} file(s) filed under two letters: ` +
          dupShas
            .map(([sha, vs]) => {
              const one = list.find((r) => r.sha === sha)!;
              return `\`${one.size}\` [${[...vs].sort().join(", ")}] \`${sha.slice(0, 8)}\``;
            })
            .join(", "),
      );
    }

    // SIZE-SPLIT: a letter holding exactly one size that a fuller letter also has.
    const fullest = [...byVariant.entries()].sort(
      (a, b) => sizeSet(b[1]).length - sizeSet(a[1]).length,
    )[0]!;
    const singles = [...byVariant.entries()].filter(
      ([v, rs]) => v !== fullest[0] && sizeSet(rs).length === 1,
    );
    if (singles.length > 0 && sizeSet(fullest[1]).length > 1) {
      const lines = singles.map(([v, rs]) => {
        const size = sizeSet(rs)[0]!;
        const here = rs[0]!;
        const there = fullest[1].find((r) => r.size === size);
        const verdict = !there
          ? "size not in the fuller letter — folding it in ADDS a size"
          : there.sha && here.sha && there.sha === here.sha
            ? "same bytes — safe to drop"
            : "different picture at the same size — NOT the same creative";
        return `    - \`${v}\` · ${size} · ${verdict}`;
      });
      split.push(
        `- **MC${number}** — fullest letter \`${fullest[0]}\` (${sizeSet(fullest[1]).length} sizes), ` +
          `${singles.length} one-size letter(s):\n${lines.join("\n")}`,
      );
    }

    // LOOKALIKE: several letters with the same full size set, all different bytes.
    const full = [...byVariant.entries()].filter(
      ([, rs]) => sizeSet(rs).length === sizeSet(fullest[1]).length,
    );
    if (full.length > 1 && dupShas.length === 0 && singles.length === 0) {
      lookalike.push(
        `- **MC${number}** — ${full.map(([v]) => v).join(", ")} each carry ` +
          `${sizeSet(fullest[1]).length} size(s) of "${[...keywords][0]}", all different bytes`,
      );
    }
  }

  const section = (title: string, body: string[], empty: string) => {
    out.push(`## ${title} — ${body.length}`);
    out.push("");
    out.push(body.length > 0 ? body.join("\n") : `_${empty}_`);
    out.push("");
  };

  section(
    "DUPLICATE · one file, two letters",
    dup,
    "nothing: no file appears under two letters",
  );
  section(
    "SIZE-SPLIT · a letter per size",
    split,
    "nothing: no letter holds a single size another letter already covers",
  );
  section(
    "LOOKALIKE · different pictures, same words",
    lookalike,
    "nothing",
  );

  const path = "docs/variant-splits.md";
  writeFileSync(path, out.join("\n") + "\n");
  console.log(
    `${path} written — duplicate: ${dup.length}, size-split: ${split.length}, lookalike: ${lookalike.length}`,
  );
  process.exit(0);
}

main();
