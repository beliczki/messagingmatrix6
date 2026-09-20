import { describe, it, expect } from "vitest";
import { groupCreativeVersions, versionLadder } from "@/lib/group-creative-versions";

let nextId = 1;
function row(fileName: string | null, createdAt = "2026-01-01 10:00:00") {
  return { id: nextId++, fileName, createdAt };
}

describe("groupCreativeVersions", () => {
  it("groups no-token (v1) with _n2/_n3 and picks the highest as latest", () => {
    const v1 = row("ERSTE_SZA_MC296_a_onlineSzamla_150e_2026Q2_300x250.jpg");
    const v3 = row("ERSTE_SZA_MC296_a_onlineSzamla_150e_2026Q2_n3_300x250.jpg");
    const v2 = row("ERSTE_SZA_MC296_a_onlineSzamla_150e_2026Q2_n2_300x250.jpg");
    const groups = groupCreativeVersions([v1, v3, v2]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.versions.map((r) => r.id)).toEqual([v1.id, v2.id, v3.id]);
    expect(groups[0]!.latest.id).toBe(v3.id);
  });

  it("groups across extension changes (jpg vs png)", () => {
    const a = row("ERSTE_HITEL_MC8_a_Babavaro_autocsere_n1_300x250.jpg");
    const b = row("ERSTE_HITEL_MC8_a_Babavaro_autocsere_n2_300x250.png");
    const groups = groupCreativeVersions([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.latest.id).toBe(b.id);
  });

  it("splits different declared sizes into separate groups", () => {
    const a = row("ERSTE_SZK_MC316_a_calculator_mockup_auto_n7_300x250.png");
    const b = row("ERSTE_SZK_MC316_a_calculator_mockup_auto_n7_640x360.png");
    const groups = groupCreativeVersions([a, b]);
    expect(groups).toHaveLength(2);
  });

  it("non-contiguous version numbers still order correctly", () => {
    const n4 = row("ERSTE_HK_MC286_a_WIZZAIR_tengerpart_rem_n4_300x250.jpg");
    const n1 = row("ERSTE_HK_MC286_a_WIZZAIR_tengerpart_rem_n1_300x250.jpg");
    const groups = groupCreativeVersions([n4, n1]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.versions.map((r) => r.id)).toEqual([n1.id, n4.id]);
    expect(groups[0]!.latest.id).toBe(n4.id);
  });

  it("null fileName never groups", () => {
    const a = row(null);
    const b = row(null);
    const groups = groupCreativeVersions([a, b]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.versions.length === 1)).toBe(true);
  });

  it("duplicate parsed version tie-breaks on createdAt then id", () => {
    const older = row("ERSTE_SZA_MC1_a_teszt_n2_300x250.jpg", "2026-01-01 10:00:00");
    const newer = row("ERSTE_SZA_MC1_a_teszt_n2_300x250.png", "2026-02-01 10:00:00");
    const groups = groupCreativeVersions([newer, older]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.versions.map((r) => r.id)).toEqual([older.id, newer.id]);
    expect(groups[0]!.latest.id).toBe(newer.id);
  });

  it("case differences in the stem still group (key lowercased)", () => {
    const a = row("ERSTE_SZA_MC5_a_Cseperedo_n1_300x250.jpg");
    const b = row("ERSTE_SZA_MC5_a_cseperedo_n2_300x250.jpg");
    const groups = groupCreativeVersions([a, b]);
    expect(groups).toHaveLength(1);
  });
});

// The draft card and the draft editor both ask "which file is current in this
// slot". They used to answer with whatever landed first, so a delivered n2 sat
// in the library while every draft still showed the n1 it replaced.
describe("versionLadder", () => {
  const f = (id: number, fileName: string | null) => ({ id, fileName });

  it("orders one family oldest → newest, whatever order it arrives in", () => {
    const out = versionLadder([
      f(3, "ERSTE_MARKET_MC405_b_balaton_n2_300x250.png"),
      f(1, "ERSTE_MARKET_MC405_b_balaton_300x250.png"),
      f(7, "ERSTE_MARKET_MC405_b_balaton_n4_300x250.png"),
    ]);
    expect(out.map((i) => i.id)).toEqual([1, 3, 7]);
  });

  it("keeps the slot on the FIRST file's family when two concepts share a size", () => {
    const out = versionLadder([
      f(1, "ERSTE_MARKET_MC405_b_balaton_300x250.png"),
      f(2, "ERSTE_MARKET_MC405_b_hegyek_300x250.png"),
      f(3, "ERSTE_MARKET_MC405_b_balaton_n2_300x250.png"),
    ]);
    expect(out.map((i) => i.id)).toEqual([1, 3]);
  });

  it("treats a file with no parsable family as a ladder of one", () => {
    expect(versionLadder([f(1, "random.png"), f(2, "other.png")])).toHaveLength(1);
    expect(versionLadder([f(1, null)])).toEqual([f(1, null)]);
    expect(versionLadder([])).toEqual([]);
  });
});
