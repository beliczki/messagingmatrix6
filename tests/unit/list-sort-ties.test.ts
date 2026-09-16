import { describe, it, expect } from "vitest";
import { sortListRows } from "@/app/(app)/_components/ListSortHeader";

// created_at has one-second resolution, so a batch upload puts many rows on the
// same value. The tie-break decides what the user sees inside each second — and
// with 100+ files that is most of the list.
function row(id: number, fileName: string, createdAt: string) {
  return {
    id,
    fileName,
    product: "SZK",
    type: null,
    fileDimensions: null,
    createdAt,
    updatedAt: createdAt,
  };
}

// Three MCs interleaved, as a drop of mixed sizes arrives.
const batch = [
  row(3, "ERSTE_SZK_MC301_c_bankvaltas_n4_300x250.png", "2026-09-16 16:21:24"),
  row(1, "ERSTE_SZK_MC141_c_persely_n4_640x360.png", "2026-09-16 16:21:24"),
  row(4, "ERSTE_SZK_MC141_c_persely_n4_300x600.png", "2026-09-16 16:21:24"),
  row(2, "ERSTE_SZK_MC303_d_rezsi_n4_970x250.png", "2026-09-16 16:21:25"),
];

describe("sortListRows tie-breaking", () => {
  it("equal timestamps read by file name, so an MC's sizes stay together", () => {
    const out = sortListRows(batch, { key: "createdAt", dir: "asc" });
    expect(out.map((r) => r.fileName)).toEqual([
      "ERSTE_SZK_MC141_c_persely_n4_300x600.png",
      "ERSTE_SZK_MC141_c_persely_n4_640x360.png",
      "ERSTE_SZK_MC301_c_bankvaltas_n4_300x250.png",
      "ERSTE_SZK_MC303_d_rezsi_n4_970x250.png",
    ]);
  });

  it("a sort and its reverse are exact mirrors", () => {
    const asc = sortListRows(batch, { key: "createdAt", dir: "asc" });
    const desc = sortListRows(batch, { key: "createdAt", dir: "desc" });
    expect(asc.map((r) => r.id)).toEqual([...desc.map((r) => r.id)].reverse());
  });

  it("MC numbers compare numerically, not as text", () => {
    const wide = [
      row(1, "MC1000_a.png", "2026-09-16 16:21:24"),
      row(2, "MC99_a.png", "2026-09-16 16:21:24"),
    ];
    const out = sortListRows(wide, { key: "createdAt", dir: "asc" });
    expect(out.map((r) => r.fileName)).toEqual(["MC99_a.png", "MC1000_a.png"]);
  });

  it("rows with no file name still sort, falling back to id", () => {
    const anon = [
      row(2, "", "2026-09-16 16:21:24"),
      row(1, "", "2026-09-16 16:21:24"),
    ];
    expect(
      sortListRows(anon, { key: "createdAt", dir: "asc" }).map((r) => r.id),
    ).toEqual([1, 2]);
  });
});
