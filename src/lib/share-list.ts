// The Shares list (§6.10b): which picture stands for each MC of a share, what
// text a share can be found by, and the row filter. Pure — the route reads the
// rows, this decides — so the rules can be tested without a database. The DB
// side (signed URLs, the creatives' current text) is in share-snapshot.ts.

import {
  emptySearchFields,
  type MatchPredicate,
  type SearchFields,
} from "@/lib/search-query";

/**
 * The parts of a share snapshot (`share_galleries.metadata`) these rules read.
 * Every key is optional: a snapshot is JSON frozen at the time it was made, and
 * older ones lack the later keys (`matrixItems`, `assets`, a creative's
 * `imageText`). A missing key means the share has none of that kind.
 */
export type SnapshotLike = {
  messages?: Array<{
    id: number;
    number: number;
    variant: string;
    headline?: string | null;
    copy1?: string | null;
    copy2?: string | null;
    disclaimer?: string | null;
    cta?: string | null;
  }>;
  matrixItems?: Array<{ messageId: number; size: string }>;
  creatives?: Array<{
    id: number;
    mcNumber: number | null;
    mcVariant: string | null;
    fileId: string | null;
    fileDimensions: string | null;
    imageText?: string | null;
  }>;
  assets?: Array<{ id: number; fileId: string | null; fileDimensions: string | null }>;
  files?: Array<{ id: string; mimeType: string | null }>;
};

/** Where one preview picture comes from; the caller turns it into a URL. */
export type PreviewRef =
  | { kind: "matrix"; messageId: number; size: string }
  | { kind: "file"; fileId: string; mimeType: string | null }
  | { kind: "none" };

/** One MC (or variant) of a share, at the size chosen to show it. */
export type PreviewGroup = {
  /** `MC12a`; null for an item with no MC (a library asset). */
  label: string | null;
  size: string | null;
  ref: PreviewRef;
};

export function mcLabel(number: number, variant: string | null): string {
  return `MC${number}${variant ?? ""}`;
}

function parseSize(s: string | null): { w: number; h: number } | null {
  if (!s) return null;
  const m = /^(\d+)x(\d+)$/.exec(s);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

// Robi, 2026-11-24: "1080x1080 vagy 300x250 vagy ha az sincs négyzetes szerű
// méretekből". The two named sizes win outright, in that order.
const NAMED_SIZES = ["1080x1080", "300x250"];

/**
 * Which of an MC's sizes stands for it: 1080x1080, else 300x250, else the most
 * square one (smallest |ln(w/h)|, so 2:1 and 1:2 count alike; a tie goes to the
 * larger picture, then to the earlier one). Returns an index into `sizes`; 0
 * when no size can be read.
 */
export function pickPreviewSize(sizes: Array<string | null>): number {
  for (const named of NAMED_SIZES) {
    const i = sizes.indexOf(named);
    if (i >= 0) return i;
  }
  let best = 0;
  let bestSkew = Infinity;
  let bestArea = 0;
  sizes.forEach((s, i) => {
    const d = parseSize(s);
    if (!d) return;
    const skew = Math.abs(Math.log(d.w / d.h));
    const area = d.w * d.h;
    if (skew < bestSkew || (skew === bestSkew && area > bestArea)) {
      best = i;
      bestSkew = skew;
      bestArea = area;
    }
  });
  return best;
}

/**
 * The share's MCs and variants, one entry each, in the order its viewer shows
 * them (matrix cells, then creatives, then assets) — not its sizes. The same
 * card in four sizes, or copied into three audiences, is one entry, shown at
 * the size `pickPreviewSize` chooses. An asset has no MC and is its own entry.
 */
export function sharePreviewGroups(meta: SnapshotLike): PreviewGroup[] {
  type Candidate = { size: string | null; ref: PreviewRef };
  const groups = new Map<string, { label: string | null; items: Candidate[] }>();
  const add = (key: string, label: string | null, item: Candidate) => {
    const g = groups.get(key);
    if (g) g.items.push(item);
    else groups.set(key, { label, items: [item] });
  };
  const keyOf = (label: string) => `mc:${label.toLowerCase()}`;

  const messageById = new Map((meta.messages ?? []).map((m) => [m.id, m]));
  const filesById = new Map((meta.files ?? []).map((f) => [f.id, f]));
  const fileRef = (fileId: string | null): PreviewRef => {
    const f = fileId ? filesById.get(fileId) : undefined;
    return f ? { kind: "file", fileId: f.id, mimeType: f.mimeType } : { kind: "none" };
  };

  for (const p of meta.matrixItems ?? []) {
    const m = messageById.get(p.messageId);
    const label = m ? mcLabel(m.number, m.variant) : null;
    add(label ? keyOf(label) : `matrix:${p.messageId}`, label, {
      size: p.size,
      ref: { kind: "matrix", messageId: p.messageId, size: p.size },
    });
  }
  for (const c of meta.creatives ?? []) {
    const label = c.mcNumber !== null ? mcLabel(c.mcNumber, c.mcVariant) : null;
    add(label ? keyOf(label) : `creative:${c.id}`, label, {
      size: c.fileDimensions,
      ref: fileRef(c.fileId),
    });
  }
  for (const a of meta.assets ?? []) {
    add(`asset:${a.id}`, null, { size: a.fileDimensions, ref: fileRef(a.fileId) });
  }

  return [...groups.values()].map((g) => {
    const pick = g.items[pickPreviewSize(g.items.map((i) => i.size))]!;
    return { label: g.label, size: pick.size, ref: pick.ref };
  });
}

/**
 * The text ON a share's creatives, each distinct line once: a matrix cell's
 * copy (headline, copy1, copy2, disclaimer, cta) as the snapshot froze it, and
 * an uploaded creative's `image_text`. The latter is read from the creative's
 * CURRENT row (`currentText`, by creative id): the reading came after most
 * shares were made — on 2026-11-24 only 40 of 1121 snapshot creatives carried
 * it — so the snapshot's own copy stands in only where the row has none or is
 * gone.
 */
export function shareSearchText(
  meta: SnapshotLike,
  currentText: Map<number, string | null>,
): string {
  const out = new Set<string>();
  const put = (s: string | null | undefined) => {
    if (typeof s !== "string") return;
    const t = s.trim();
    if (t) out.add(t);
  };
  for (const m of meta.messages ?? []) {
    for (const s of [m.headline, m.copy1, m.copy2, m.disclaimer, m.cta]) put(s);
  }
  for (const c of meta.creatives ?? []) {
    const current = currentText.get(c.id);
    put(typeof current === "string" && current.trim() ? current : c.imageText);
  }
  return [...out].join("\n");
}

/** What a Shares row is filtered on. */
export type ShareFilterRow = {
  title: string | null;
  previews: Array<{ label: string | null }>;
  searchText: string;
};

/**
 * The §7.7 filter fields of one share: `mc:` matches its MC labels; free text
 * matches its name, its MCs and the text on its creatives. The other prefixes
 * (a: t: s: p: date:) have nothing to match on a share and stay empty.
 */
export function shareSearchFields(row: ShareFilterRow): SearchFields {
  const mc = row.previews
    .flatMap((p) => (p.label ? [p.label.toLowerCase()] : []))
    .join(" ");
  return {
    ...emptySearchFields(),
    mc,
    free: `${row.title ?? ""}\n${mc}\n${row.searchText}`.toLowerCase(),
  };
}

/**
 * Whether a share stays in the filtered list: one of its products is picked
 * (a share naming no product files under `emptyOption`), and the query matches.
 */
export function shareRowMatches(
  row: ShareFilterRow & { products: string[] },
  predicate: MatchPredicate,
  products: Set<string>,
  emptyOption: string,
): boolean {
  if (products.size > 0) {
    const values = row.products.length > 0 ? row.products : [emptyOption];
    if (!values.some((v) => products.has(v))) return false;
  }
  return predicate(shareSearchFields(row));
}
