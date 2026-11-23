// Read, and patch in place, the cells of one sheet in an .xlsx — without
// rebuilding the workbook.
//
// A spreadsheet library (SheetJS / node-xlsx) parses the whole file into its own
// model and writes a new one: whatever it does not model is gone — Google's
// custom metadata, a filter's state, styles it does not round-trip. A shared
// client file must not lose any of that. So this edits the sheet part as text:
// only the target rows are rebuilt, and in them only the target cells; every
// other row, every byte outside <sheetData> and every other zip member stays
// exactly as it was.
//
// Columns are found by their header text in row 1, never by letter, so a column
// moved in the next export is still found (or the patch refuses).
//
// Used by scripts/patch-mc-export.ts. Written for the xlsx files Google Sheets
// and Excel save: every <row> and <c> carries its r= reference.
import JSZip from "jszip";

export type SheetTable = {
  /** header text (row 1) → column letters */
  columns: Map<string, string>;
  /** every row after the header, values keyed by header text (headed columns only) */
  rows: { rowNumber: number; values: Map<string, string> }[];
};

export type CellPatch = {
  sheet: string;
  /** header of the column whose value identifies a row (must be unique among the targets) */
  keyHeader: string;
  /** key → { header → new value }. An empty string empties the cell. */
  updates: Map<string, Record<string, string>>;
};

export type CellPatchResult = {
  xlsx: Buffer;
  /** keys written, in the order of `updates` */
  written: string[];
  /** keys of `updates` the sheet does not have, in that order */
  missingKeys: string[];
};

// An Excel cell holds at most 32 767 characters.
const MAX_CELL_CHARS = 32767;
// Characters XML 1.0 cannot carry, escaped or not.
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

type Cell = { col: string; attrs: Map<string, string>; inner: string | null; xml: string };
/** start/end: the row's offsets in the <sheetData> text it was parsed from */
type Row = { rowNumber: number; head: string; xml: string; start: number; end: number; cells: Cell[] };

function attrsOf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/([\w:.-]+)="([^"]*)"/g)) out.set(m[1]!, unescapeXml(m[2]!));
  return out;
}

function unescapeXml(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) => {
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "amp") return "&";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function colIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}

/** The visible text of an <si> or <is>: every <t> run, phonetic runs left out. */
function runText(xml: string): string {
  const visible = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of visible.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += unescapeXml(m[1] ?? "");
  return out;
}

function parseRows(sheetData: string): Row[] {
  const rows: Row[] = [];
  for (const m of sheetData.matchAll(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g)) {
    const attrs = attrsOf(m[1]!);
    const r = attrs.get("r");
    if (!r) throw new Error(`a <row> without an r= reference: ${m[0].slice(0, 80)}`);
    const selfClosing = m[2] === "/>";
    const cells: Cell[] = [];
    if (!selfClosing) {
      for (const c of m[3]!.matchAll(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
        const cAttrs = attrsOf(c[1]!);
        const ref = cAttrs.get("r");
        const col = ref?.match(/^([A-Z]+)\d+$/)?.[1];
        if (!col) throw new Error(`row ${r}: a <c> without a usable r= reference: ${c[0].slice(0, 80)}`);
        cells.push({ col, attrs: cAttrs, inner: c[2] === "/>" ? null : c[3]!, xml: c[0] });
      }
    }
    rows.push({
      rowNumber: Number(r),
      head: `<row${m[1]}>`,
      xml: m[0],
      start: m.index!,
      end: m.index! + m[0].length,
      cells,
    });
  }
  return rows;
}

function cellValue(cell: Cell, shared: string[]): string {
  const inner = cell.inner ?? "";
  const t = cell.attrs.get("t") ?? "n";
  if (t === "inlineStr") {
    const is = inner.match(/<is>([\s\S]*?)<\/is>/);
    return is ? runText(is[1]!) : "";
  }
  const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (v === undefined) return "";
  if (t === "s") {
    const s = shared[Number(v)];
    if (s === undefined) throw new Error(`${cell.attrs.get("r")}: shared string ${v} does not exist`);
    return s;
  }
  if (t === "n") {
    // Google saves 101 as "101.0": compare numbers as numbers.
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : unescapeXml(v);
  }
  return unescapeXml(v);
}

type Located = {
  zip: JSZip;
  sheetPath: string;
  xml: string;
  shared: string[];
  before: string;
  sheetData: string;
  after: string;
  rows: Row[];
  columns: Map<string, string>;
};

async function locate(xlsx: Uint8Array, sheet: string): Promise<Located> {
  const zip = await JSZip.loadAsync(xlsx);
  const read = async (path: string) => {
    const f = zip.file(path);
    if (!f) throw new Error(`the xlsx has no ${path}`);
    return f.async("string");
  };
  const workbook = await read("xl/workbook.xml");
  const rels = [...(await read("xl/_rels/workbook.xml.rels")).matchAll(/<Relationship\b[^>]*>/g)].map((m) =>
    attrsOf(m[0]),
  );
  const target = (rel: Map<string, string>) => {
    const t = rel.get("Target")!;
    return t.startsWith("/") ? t.slice(1) : `xl/${t}`;
  };

  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => attrsOf(m[0]));
  const entry = sheets.find((s) => s.get("name") === sheet);
  if (!entry) throw new Error(`no sheet "${sheet}" (the workbook has: ${sheets.map((s) => s.get("name")).join(", ")})`);
  const rel = rels.find((r) => r.get("Id") === entry.get("r:id"));
  if (!rel) throw new Error(`sheet "${sheet}": relationship ${entry.get("r:id")} not found`);
  const sheetPath = target(rel);

  const sharedRel = rels.find((r) => r.get("Type")?.endsWith("/sharedStrings"));
  const shared = sharedRel
    ? [...(await read(target(sharedRel))).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runText(m[1]!))
    : [];

  const xml = await read(sheetPath);
  const sd = xml.match(/<sheetData>([\s\S]*)<\/sheetData>/);
  if (!sd || sd.index === undefined) throw new Error(`sheet "${sheet}" has no rows`);
  const before = xml.slice(0, sd.index + "<sheetData>".length);
  const sheetData = sd[1]!;
  const after = xml.slice(sd.index + sd[0].length - "</sheetData>".length);
  const rows = parseRows(sheetData);

  const header = rows.find((r) => r.rowNumber === 1);
  if (!header) throw new Error(`sheet "${sheet}" has no header row 1`);
  const columns = new Map<string, string>();
  for (const cell of header.cells) {
    const name = cellValue(cell, shared);
    if (!name) continue;
    if (columns.has(name)) throw new Error(`sheet "${sheet}": header "${name}" appears twice`);
    columns.set(name, cell.col);
  }
  return { zip, sheetPath, xml, shared, before, sheetData, after, rows, columns };
}

export async function readSheet(xlsx: Uint8Array, sheet: string): Promise<SheetTable> {
  const { rows, columns, shared } = await locate(xlsx, sheet);
  const headerOf = new Map([...columns].map(([name, col]) => [col, name]));
  return {
    columns,
    rows: rows
      .filter((r) => r.rowNumber !== 1)
      .map((r) => {
        const values = new Map<string, string>();
        for (const cell of r.cells) {
          const name = headerOf.get(cell.col);
          if (name) values.set(name, cellValue(cell, shared));
        }
        return { rowNumber: r.rowNumber, values };
      }),
  };
}

export async function patchSheetCells(xlsx: Uint8Array, patch: CellPatch): Promise<CellPatchResult> {
  const loc = await locate(xlsx, patch.sheet);
  const keyCol = loc.columns.get(patch.keyHeader);
  if (!keyCol) throw new Error(`sheet "${patch.sheet}" has no header "${patch.keyHeader}"`);

  const targetHeaders = new Set<string>();
  for (const [key, values] of patch.updates) {
    for (const [header, value] of Object.entries(values)) {
      if (!loc.columns.has(header)) throw new Error(`sheet "${patch.sheet}" has no header "${header}"`);
      targetHeaders.add(header);
      if (NOT_XML.test(value)) throw new Error(`key ${key}, ${header}: a character XML cannot carry`);
      if (value.length > MAX_CELL_CHARS) throw new Error(`key ${key}, ${header}: ${value.length} characters, a cell holds ${MAX_CELL_CHARS}`);
    }
  }

  // A cell the row does not have yet gets its column's usual data style.
  const usualStyle = new Map<string, string | undefined>();
  for (const header of targetHeaders) {
    const col = loc.columns.get(header)!;
    const counts = new Map<string, number>();
    for (const row of loc.rows) {
      if (row.rowNumber === 1) continue;
      const s = row.cells.find((c) => c.col === col)?.attrs.get("s");
      if (s !== undefined) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    let best: string | undefined;
    for (const [s, n] of counts) if (best === undefined || n > counts.get(best)!) best = s;
    usualStyle.set(col, best);
  }

  const rowOfKey = new Map<string, Row>();
  for (const row of loc.rows) {
    if (row.rowNumber === 1) continue;
    const keyCell = row.cells.find((c) => c.col === keyCol);
    if (!keyCell) continue;
    const key = cellValue(keyCell, loc.shared);
    if (!patch.updates.has(key)) continue;
    if (rowOfKey.has(key)) throw new Error(`key ${key} is in rows ${rowOfKey.get(key)!.rowNumber} and ${row.rowNumber}`);
    rowOfKey.set(key, row);
  }

  const replacement = new Map<Row, string>();
  const written: string[] = [];
  const missingKeys: string[] = [];
  for (const [key, values] of patch.updates) {
    const row = rowOfKey.get(key);
    if (!row) {
      missingKeys.push(key);
      continue;
    }
    const cells = new Map(row.cells.map((c) => [c.col, c]));
    const out = new Map(row.cells.map((c) => [c.col, c.xml]));
    for (const [header, value] of Object.entries(values)) {
      const col = loc.columns.get(header)!;
      const style = cells.get(col)?.attrs.get("s") ?? usualStyle.get(col);
      const ref = `${col}${row.rowNumber}`;
      const s = style === undefined ? "" : ` s="${style}"`;
      out.set(
        col,
        value === ""
          ? `<c r="${ref}"${s}/>`
          : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`,
      );
    }
    const body = [...out.entries()].sort(([a], [b]) => colIndex(a) - colIndex(b)).map(([, xml]) => xml).join("");
    replacement.set(row, `${row.head}${body}</row>`);
    written.push(key);
  }

  // Rebuild <sheetData> from the original text: untouched rows, and the text
  // between rows, are copied as they were.
  let sheetData = "";
  let cursor = 0;
  for (const row of loc.rows) {
    sheetData += loc.sheetData.slice(cursor, row.start) + (replacement.get(row) ?? row.xml);
    cursor = row.end;
  }
  sheetData += loc.sheetData.slice(cursor);

  // Same entry, same date; no folder entries (JSZip adds them by default, and
  // the xlsx Google saves has none). The one thing not kept: the unix mode bits
  // in each entry's external attributes. Google writes them under a non-UNIX
  // "made by", JSZip neither reads nor re-writes them, and Excel and Sheets do
  // not look at them.
  const entry = loc.zip.file(loc.sheetPath)!;
  loc.zip.file(loc.sheetPath, loc.before + sheetData + loc.after, { createFolders: false, date: entry.date });
  const buf = await loc.zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { xlsx: buf, written, missingKeys };
}
