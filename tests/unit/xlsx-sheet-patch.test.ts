import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { patchSheetCells, readSheet } from "@/lib/xlsx-sheet-patch";

// A hand-written two-sheet workbook shaped like an xlsx that Google Sheets saved:
// numbers as "101.0", text as shared strings, a quote-prefix style on the date
// column, hidden rows, a formula column. Every expected value below is a literal,
// written from the XML here, not recomputed by the module under test.

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet state="visible" name="Other" sheetId="1" r:id="rId4"/><sheet r:id="rId5" sheetId="2" name="Data"/></sheets></workbook>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;

// 0 creative_id, 1 name, 2 image_text, 3 updated_at, 4 link, 5 alpha, 6 "102",
// 7 old date, 8 beta (rich text, two runs), 9 gamma
const SHARED = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="12" uniqueCount="10"><si><t>creative_id</t></si><si><t>name</t></si><si><t>image_text</t></si><si><t>updated_at</t></si><si><t>link</t></si><si><t>alpha</t></si><si><t>102</t></si><si><t>2026-01-01 00:00:00</t></si><si><r><t>be</t></r><r><rPr><b/></rPr><t>ta</t></r></si><si><t xml:space="preserve">gamma &amp; co</t></si></sst>`;

const ROW1 = `<row r="1" ht="15.75" customHeight="1"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="1" t="s"><v>1</v></c><c r="C1" s="1" t="s"><v>2</v></c><c r="D1" s="1" t="s"><v>3</v></c><c r="E1" s="1" t="s"><v>4</v></c></row>`;
// Target: key stored as a number the Google way, empty styled cell in C, quote-prefix style 7 on D, formula in E.
const ROW2 = `<row r="2" ht="15.75" customHeight="1"><c r="A2" s="6"><v>101.0</v></c><c r="B2" s="6" t="s"><v>5</v></c><c r="C2" s="3"/><c r="D2" s="7" t="s"><v>7</v></c><c r="E2" s="2"><f>HYPERLINK(B2)</f><v>x</v></c></row>`;
// An empty self-closing row: the old python row regex swallowed the next row from here.
const ROW3 = `<row r="3" ht="15.75" hidden="1" customHeight="1"/>`;
// Target: key as a SHARED STRING, attributes not in r-first order, no C cell at all.
const ROW4 = `<row r="4" ht="15.75" hidden="1" customHeight="1"><c s="6" r="A4" t="s"><v>6</v></c><c t="s" s="6" r="B4"><v>8</v></c><c r="D4" s="2" t="s"><v>7</v></c></row>`;
// Not a target: must come out byte for byte.
const ROW5 = `<row r="5" ht="15.75" customHeight="1"><c r="A5" s="6"><v>103.0</v></c><c r="B5" s="6" t="s"><v>9</v></c><c r="C5" s="3" t="inlineStr"><is><t>keep me</t></is></c><c r="D5" s="2" t="s"><v>7</v></c></row>`;
// A second data row with a C cell, so the column's usual style (3) is a majority.
const ROW6 = `<row r="6"><c r="A6" s="6"><v>104</v></c><c r="C6" s="3"/></row>`;

const BEFORE_DATA = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>`;
const AFTER_DATA = `</sheetData><autoFilter ref="$A$1:$E$6"><filterColumn colId="1"><filters><filter val="alpha"/></filters></filterColumn></autoFilter></worksheet>`;

const SHEET1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`;

function sheet2(rows: string[]): string {
  return BEFORE_DATA + rows.join("") + AFTER_DATA;
}

const OTHER_FILES: Record<string, string> = {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
  "xl/workbook.xml": WORKBOOK,
  "xl/_rels/workbook.xml.rels": RELS,
  "xl/sharedStrings.xml": SHARED,
  "xl/worksheets/sheet1.xml": SHEET1,
};

const SAVED = new Date(Date.UTC(2026, 10, 23, 3, 0, 18));

// Like the xlsx Google saves: no folder entries, one timestamp on every entry.
async function workbook(rows = [ROW1, ROW2, ROW3, ROW4, ROW5, ROW6]): Promise<Buffer> {
  const zip = new JSZip();
  const opts = { createFolders: false, date: SAVED };
  for (const [name, body] of Object.entries(OTHER_FILES)) zip.file(name, body, opts);
  zip.file("xl/worksheets/sheet2.xml", sheet2(rows), opts);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function members(buf: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buf);
  const out: Record<string, string> = {};
  for (const [name, f] of Object.entries(zip.files)) if (!f.dir) out[name] = await f.async("string");
  return out;
}

const UPDATES = new Map<string, Record<string, string>>([
  ["101", { image_text: "ERSTE\nSzia & <b>", updated_at: "2026-11-23 17:21:30" }],
  ["102", { image_text: "Nincs szöveg a képen.", updated_at: "2026-11-23 17:18:15" }],
]);

describe("readSheet — decoding a sheet by its header names", () => {
  it("decodes numbers, shared strings, rich text and inline strings, keyed by header", async () => {
    const table = await readSheet(await workbook(), "Data");
    expect([...table.columns]).toEqual([
      ["creative_id", "A"],
      ["name", "B"],
      ["image_text", "C"],
      ["updated_at", "D"],
      ["link", "E"],
    ]);
    expect(table.rows.map((r) => [r.rowNumber, Object.fromEntries(r.values)])).toEqual([
      [2, { creative_id: "101", name: "alpha", image_text: "", updated_at: "2026-01-01 00:00:00", link: "x" }],
      [3, {}],
      [4, { creative_id: "102", name: "beta", updated_at: "2026-01-01 00:00:00" }],
      [5, { creative_id: "103", name: "gamma & co", image_text: "keep me", updated_at: "2026-01-01 00:00:00" }],
      [6, { creative_id: "104", image_text: "" }],
    ]);
  });

  it("throws on a sheet name the workbook does not have", async () => {
    await expect(readSheet(await workbook(), "Nope")).rejects.toThrow(/Nope/);
  });
});

describe("patchSheetCells — write only the named cells, leave every other byte", () => {
  it("writes the target cells as inline strings and keeps their style", async () => {
    const out = await patchSheetCells(await workbook(), { sheet: "Data", keyHeader: "creative_id", updates: UPDATES });
    expect(out.written).toEqual(["101", "102"]);
    expect(out.missingKeys).toEqual([]);
    const xml = (await members(out.xlsx))["xl/worksheets/sheet2.xml"];
    expect(xml).toBe(
      sheet2([
        ROW1,
        `<row r="2" ht="15.75" customHeight="1"><c r="A2" s="6"><v>101.0</v></c><c r="B2" s="6" t="s"><v>5</v></c><c r="C2" s="3" t="inlineStr"><is><t xml:space="preserve">ERSTE\nSzia &amp; &lt;b&gt;</t></is></c><c r="D2" s="7" t="inlineStr"><is><t xml:space="preserve">2026-11-23 17:21:30</t></is></c><c r="E2" s="2"><f>HYPERLINK(B2)</f><v>x</v></c></row>`,
        ROW3,
        // C4 did not exist: inserted in column order, with column C's usual data style (3).
        `<row r="4" ht="15.75" hidden="1" customHeight="1"><c s="6" r="A4" t="s"><v>6</v></c><c t="s" s="6" r="B4"><v>8</v></c><c r="C4" s="3" t="inlineStr"><is><t xml:space="preserve">Nincs szöveg a képen.</t></is></c><c r="D4" s="2" t="inlineStr"><is><t xml:space="preserve">2026-11-23 17:18:15</t></is></c></row>`,
        ROW5,
        ROW6,
      ]),
    );
  });

  it("leaves every other zip member as it was", async () => {
    const before = await members(await workbook());
    const after = await members((await patchSheetCells(await workbook(), { sheet: "Data", keyHeader: "creative_id", updates: UPDATES })).xlsx);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const name of Object.keys(before)) {
      if (name !== "xl/worksheets/sheet2.xml") expect(after[name], name).toBe(before[name]);
    }
  });

  it("adds no zip entries and keeps each entry's date", async () => {
    const entries = async (buf: Buffer) =>
      Object.values((await JSZip.loadAsync(buf)).files).map((f) => [f.name, f.dir, f.date.toISOString()]);
    const out = await patchSheetCells(await workbook(), { sheet: "Data", keyHeader: "creative_id", updates: UPDATES });
    expect(await entries(out.xlsx)).toEqual(await entries(await workbook()));
  });

  it("reads back the written values", async () => {
    const out = await patchSheetCells(await workbook(), { sheet: "Data", keyHeader: "creative_id", updates: UPDATES });
    const rows = (await readSheet(out.xlsx, "Data")).rows;
    expect(Object.fromEntries(rows.find((r) => r.rowNumber === 2)!.values)).toMatchObject({
      image_text: "ERSTE\nSzia & <b>",
      updated_at: "2026-11-23 17:21:30",
      link: "x",
    });
    expect(Object.fromEntries(rows.find((r) => r.rowNumber === 4)!.values)).toMatchObject({
      image_text: "Nincs szöveg a képen.",
    });
  });

  it("writes an empty value as an empty styled cell, not an empty string", async () => {
    const out = await patchSheetCells(await workbook(), {
      sheet: "Data",
      keyHeader: "creative_id",
      updates: new Map([["103", { image_text: "" }]]),
    });
    const xml = (await members(out.xlsx))["xl/worksheets/sheet2.xml"];
    expect(xml).toContain(`<c r="C5" s="3"/>`);
    expect(xml).not.toContain("keep me");
  });

  it("reports keys the sheet does not have, and writes the rest", async () => {
    const out = await patchSheetCells(await workbook(), {
      sheet: "Data",
      keyHeader: "creative_id",
      updates: new Map([["999", { image_text: "x" }], ["103", { image_text: "y" }]]),
    });
    expect(out.written).toEqual(["103"]);
    expect(out.missingKeys).toEqual(["999"]);
  });

  it("refuses a header the sheet does not have", async () => {
    await expect(
      patchSheetCells(await workbook(), { sheet: "Data", keyHeader: "creative_id", updates: new Map([["101", { nope: "x" }]]) }),
    ).rejects.toThrow(/nope/);
  });

  it("refuses a control character XML 1.0 cannot carry", async () => {
    await expect(
      patchSheetCells(await workbook(), { sheet: "Data", keyHeader: "creative_id", updates: new Map([["101", { image_text: "a\u0007b" }]]) }),
    ).rejects.toThrow(/101/);
  });

  it("refuses a sheet where the key is not unique", async () => {
    const dup = `<row r="7"><c r="A7" s="6"><v>101</v></c></row>`;
    await expect(
      patchSheetCells(await workbook([ROW1, ROW2, ROW3, ROW4, ROW5, ROW6, dup]), { sheet: "Data", keyHeader: "creative_id", updates: UPDATES }),
    ).rejects.toThrow(/101/);
  });
});
