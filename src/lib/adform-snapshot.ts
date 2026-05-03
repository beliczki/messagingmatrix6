// Parse a user-uploaded AdForm feed XLSX into a FeedRowSet so it can be
// diffed against a freshly built MM6 export. The download from AdForm uses
// the exact same header row the user typed in Settings → Feed structure
// (prefixes intact: "Text:advert_id", "Asset:background_image_1", …), so we
// just take the first row as columns and zip every subsequent row by header
// position. No prefix-stripping, no column remapping.

import xlsx from "node-xlsx";

import type { FeedRowSet } from "@/lib/feed-export";

export type AdformParseResult = {
  rowSet: FeedRowSet;
  sheetName: string;
};

export function parseAdformXlsx(buffer: Buffer): AdformParseResult {
  const sheets = xlsx.parse(buffer);
  if (sheets.length === 0) {
    throw new Error("AdForm file contains no sheets");
  }
  const sheet = sheets[0];
  const data = sheet.data as unknown[][];
  if (data.length === 0) {
    throw new Error(`Sheet "${sheet.name}" is empty`);
  }

  const headerRow = data[0];
  const columns: string[] = headerRow.map((cell) => cellToString(cell)).filter(
    (c) => c.length > 0,
  );
  if (columns.length === 0) {
    throw new Error(`Sheet "${sheet.name}" has no header columns`);
  }

  const isDefaultColIdx = findCleanColumnIdx(columns, "isdefault");

  const rows: Record<string, string>[] = [];
  let defaultRowIndex = -1;
  for (let i = 1; i < data.length; i += 1) {
    const raw = data[i];
    if (!raw || raw.every((c) => c === null || c === undefined || c === "")) {
      continue;
    }
    const row: Record<string, string> = {};
    for (let c = 0; c < columns.length; c += 1) {
      row[columns[c]] = cellToString(raw[c]);
    }
    rows.push(row);
    if (
      isDefaultColIdx >= 0 &&
      defaultRowIndex < 0 &&
      isTruthyFlag(row[columns[isDefaultColIdx]])
    ) {
      defaultRowIndex = rows.length - 1;
    }
  }

  return {
    sheetName: sheet.name,
    rowSet: {
      columns,
      rows,
      messageIds: rows.map(() => -1),
      defaultRowIndex,
    },
  };
}

function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell;
  if (typeof cell === "number" || typeof cell === "boolean") return String(cell);
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell);
}

function isTruthyFlag(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function findCleanColumnIdx(columns: string[], cleanLower: string): number {
  for (let i = 0; i < columns.length; i += 1) {
    const lower = columns[i].replace(/^[^:]+:/, "").toLowerCase();
    if (lower === cleanLower) return i;
  }
  return -1;
}

// PMMID format (v6): "<scope>-a_<audience_key>-m_<num>-t_<topic>-v_<variant>-n_<ver>"
// possibly suffixed with "-l_<lineitemid>". Audience key may itself contain
// underscores (e.g. "SZK_ertlal"), so we match non-greedily up to "-m_".
// "DEFAULT" is the sentinel audience used by the DEFAULT row — exclude it
// because it doesn't correspond to a real audience and would confuse product
// inference.
export function extractAudienceKeysFromRowSet(rowSet: FeedRowSet): string[] {
  const pmmidIdx = findCleanColumnIdx(rowSet.columns, "pmmid");
  if (pmmidIdx < 0) return [];
  const pmmidCol = rowSet.columns[pmmidIdx];
  const keys = new Set<string>();
  for (const row of rowSet.rows) {
    const pmmid = row[pmmidCol] ?? "";
    const m = pmmid.match(/-a_(.+?)-m_/);
    if (m && m[1] !== "DEFAULT") keys.add(m[1]);
  }
  return [...keys];
}
