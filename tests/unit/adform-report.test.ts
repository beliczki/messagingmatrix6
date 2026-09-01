import { describe, it, expect } from "vitest";
import xlsx from "node-xlsx";
import {
  parseAdformReport,
  extractPmmidToken,
  parsePmmid,
  normalizePlatform,
  resolveProduct,
  extractSize,
  variantLetter,
  buildMessageResolver,
} from "@/lib/adform-report";

// Build a tiny report mirroring the real AdForm "Creative custom report" shape:
// a "Front Page" summary sheet + a data sheet whose header row is preceded by a
// "Table" label row, and whose leading column A is blank.
function buildReport(indent = true): Buffer {
  const front = [
    ["", "Summary"],
    ["", "Reporting Date", "30/05/2026 10:13:47 (UTC+02:00)"],
    ["", "Report Name", "Creative rep"],
    ["", "Reporting Period From", "01/04/2026 00:00:00"],
    ["", "Reporting Period To", "30/04/2026 23:59:59"],
  ];
  const sheet = [
    ["", "Table"],
    [
      "",
      "Date",
      "Campaign",
      "Line Item",
      "Banner Ad Message",
      "Banner/Adgroups",
      "Dynamic Ad Version",
      "Click Details",
      "Cost",
      "Clicks",
      "CTR (%)",
      "Conversions",
      "Rendered Impressions",
      "Tracked Ads",
    ],
    // display Adform — MC1a, two keyword rows for the same message (aggregation)
    ["", "01/04/2026", "camp", "display!x", "Unknown", "Camp - Ban - p_adform-s_pro-a_VAL_x-findsk-m_1-t_topic_one-v_a-n_1_111", "n/a", "kw1", 10, 2, 0, 0, 100, 1],
    ["", "02/04/2026", "camp", "display!x", "Unknown", "Camp - Ban - p_adform-s_pro-a_VAL_x-findsk-m_1-t_topic_one-v_a-n_1_111", "n/a", "kw2", 5, 3, 0, 1, 50, 1],
    // search Google Ads — pmmid= format, m_00 (no real MC)
    ["", "01/04/2026", "camp", "paidsearch!x", "Unknown", "text!text!00!1x1!pmmid=p_googleads_googlesearchnetwork-s_pro-a_wid-m_00-t_diakszamla-v_0!v11", "n/a", "kw3", 0, 4, 0, 0, 0, 0],
    // DEFAULT row — no -m_ marker, must be skipped
    ["", "01/04/2026", "camp", "display!x", "Unknown", "Camp - Ban - p_adform-s_pro-a_VAL_1-t_topic_one-v_a-n_1_default", "n/a", "n/a", 1, 0, 0, 0, 9, 0],
  ];
  // `indent: false` drops the blank column A — the shape produced by tooling
  // that rebuilds the report instead of exporting it from AdForm directly.
  const strip = (rows: unknown[][]) => rows.map((r) => r.slice(1));
  return xlsx.build([
    { name: "Front Page", data: indent ? front : strip(front), options: {} },
    { name: "Sheet", data: indent ? sheet : strip(sheet), options: {} },
  ]) as Buffer;
}

describe("extractPmmidToken", () => {
  it("reads the ' - '-delimited display format", () => {
    expect(
      extractPmmidToken("Camp - Ban - p_adform-s_pro-a_VAL_x-m_1-t_t-v_a-n_1_9"),
    ).toBe("p_adform-s_pro-a_VAL_x-m_1-t_t-v_a-n_1_9");
  });
  it("reads the pmmid= search format", () => {
    expect(
      extractPmmidToken("text!text!00!1x1!pmmid=p_googleads-s_pro-a_wid-m_0-t_x-v_0!v11"),
    ).toBe("p_googleads-s_pro-a_wid-m_0-t_x-v_0");
  });
  it("returns null when there is no PMMID", () => {
    expect(extractPmmidToken("Unknown")).toBeNull();
  });
});

describe("parsePmmid", () => {
  it("parses a hyphenated audience key correctly", () => {
    expect(parsePmmid("p_adform-s_pro-a_VAL_wlfin-findsk-m_1-t_topic_one-v_b-n_1_42")).toEqual({
      scope: "p_adform",
      audienceKey: "VAL_wlfin-findsk",
      topicKey: "topic_one",
      mcNumber: 1,
      mcVariant: "b",
    });
  });
  it("handles m_00 and the search trailing !v11", () => {
    expect(parsePmmid("p_googleads_googlesearchnetwork-s_pro-a_wid-m_00-t_diakszamla-v_0!v11")).toEqual({
      scope: "p_googleads_googlesearchnetwork",
      audienceKey: "wid",
      topicKey: "diakszamla",
      mcNumber: 0,
      mcVariant: "0",
    });
  });
  it("returns null for a DEFAULT row without -m_", () => {
    expect(parsePmmid("p_adform-s_pro-a_VAL_1-t_topic_one-v_a-n_1_default")).toBeNull();
  });
});

describe("normalizePlatform", () => {
  it("maps known vendor scopes", () => {
    expect(normalizePlatform("p_googleads_googlesearchnetwork")).toBe("googleads");
    expect(normalizePlatform("p_tiktoktechnologiesuklimited_tiktok")).toBe("tiktok");
    expect(normalizePlatform("p_dv360")).toBe("dv360");
    expect(normalizePlatform("p_adform")).toBe("adform");
  });
});

describe("extractSize", () => {
  it("reads the size from a display banner name", () => {
    expect(
      extractSize("Erste_2026 - Erste_300x250_2026 - p_adform-s_pro-a_x-m_1-t_y-v_a"),
    ).toBe("300x250");
  });
  it("reads the 1x1 size from a search row", () => {
    expect(extractSize("text!text!00!1x1!pmmid=p_googleads-s_pro-a_x-m_0-t_y-v_0")).toBe(
      "1x1",
    );
  });
  it("returns empty string when there is no size token", () => {
    expect(extractSize("Campaign - Banner - p_adform-s_pro-a_x-m_1-t_y-v_a")).toBe("");
  });
});

describe("variantLetter", () => {
  it("keeps a bare letter", () => {
    expect(variantLetter("a")).toBe("a");
  });
  it("extracts a trailing single-letter token", () => {
    expect(variantLetter("hitelvalaszto_a")).toBe("a");
  });
  it("extracts a leading single-letter token", () => {
    expect(variantLetter("a_calc_auto")).toBe("a");
  });
  it("lowercases but never collapses multi-letter variants", () => {
    expect(variantLetter("NA")).toBe("na");
    expect(variantLetter("calc_na")).toBe("calc_na");
  });
  it("leaves digit variants unchanged", () => {
    expect(variantLetter("0")).toBe("0");
  });
});

describe("buildMessageResolver", () => {
  // Mirrors real June-report shapes: MC290 lives once per variant in an
  // INCOMING cell; MC316 variant "a" fans out across many cells.
  const resolve = buildMessageResolver([
    { id: 1, number: 290, variant: "a", audience: "SZK_INCOMING", topic: "SZK_kerdoiv_NA_hiteltinder" },
    { id: 2, number: 290, variant: "b", audience: "SZK_INCOMING", topic: "SZK_kerdoiv_NA_hiteltinder" },
    { id: 3, number: 316, variant: "a", audience: "SZK_wla_auto", topic: "SZK_felhaszcelja" },
    { id: 4, number: 316, variant: "a", audience: "SZK_wlc_auto", topic: "SZK_felhaszcelja" },
  ]);

  it("tier 1 — exact 4-part key, case-insensitive", () => {
    expect(
      resolve(290, "a", "SZK_INCOMING", "SZK_kerdoiv_NA_hiteltinder"),
    ).toEqual({ messageId: 1, matchLevel: "exact" });
    expect(
      resolve(290, "A", "szk_incoming", "szk_kerdoiv_na_hiteltinder"),
    ).toEqual({ messageId: 1, matchLevel: "exact" });
  });

  it("tier 2 — unique family via the variant letter", () => {
    expect(resolve(290, "hitelvalaszto_a", "wid", "szk_q2")).toEqual({
      messageId: 1,
      matchLevel: "family",
    });
  });

  it("tier 3 — fan-out family stays unlinked but flagged", () => {
    expect(resolve(316, "a_calc_auto", "wid", "szk_q2")).toEqual({
      messageId: null,
      matchLevel: "family_known",
    });
  });

  it("no match for an absent MC number or variant letter", () => {
    expect(resolve(999, "a", "wid", "szk_q2")).toEqual({
      messageId: null,
      matchLevel: null,
    });
    expect(resolve(290, "c", "wid", "szk_q2")).toEqual({
      messageId: null,
      matchLevel: null,
    });
  });
});

describe("resolveProduct", () => {
  const audienceProduct = new Map<string, string | null>([
    ["VAL_wlfin-findsk", "VAL"],
    ["wid", null],
  ]);
  const rules = [
    { keyword: "microszamla", product: "VAL" },
    { keyword: "otthonstart", product: "HITEL" },
  ];

  it("prefers the matrix audience product when known", () => {
    expect(
      resolveProduct("VAL_wlfin-findsk", "anything", null, audienceProduct, rules),
    ).toBe("VAL");
  });
  it("falls back to a keyword rule on topic when audience has no product", () => {
    expect(
      resolveProduct("wid", "otthonstart", null, audienceProduct, rules),
    ).toBe("HITEL");
  });
  it("matches a keyword inside the PMMID too (case-insensitive)", () => {
    expect(
      resolveProduct("unknown", "x", "p_adform-s_pro-a_wid-m_0-t_MICROSZAMLA-v_a", audienceProduct, rules),
    ).toBe("VAL");
  });
  it("returns null when nothing matches", () => {
    expect(resolveProduct("unknown", "nope", null, audienceProduct, rules)).toBeNull();
  });
});

describe("parseAdformReport", () => {
  it("aggregates to message level and resolves period + metrics", () => {
    const r = parseAdformReport(buildReport());
    expect(r.periodFrom).toBe("01/04/2026 00:00:00");
    expect(r.periodTo).toBe("30/04/2026 23:59:59");
    expect(r.totalDataRows).toBe(4);
    expect(r.skipped).toBe(1); // the DEFAULT row
    expect(r.rows).toHaveLength(2);

    const mc1 = r.rows.find((x) => x.platform === "adform")!;
    expect(mc1).toMatchObject({
      audienceKey: "VAL_x-findsk",
      topicKey: "topic_one",
      mcNumber: 1,
      mcVariant: "a",
      impressions: 150,
      clicks: 5,
      cost: 15,
      conversions: 1,
    });
    expect(mc1.ctr).toBeCloseTo(5 / 150);

    const ga = r.rows.find((x) => x.platform === "googleads")!;
    expect(ga).toMatchObject({ mcNumber: 0, mcVariant: "0", topicKey: "diakszamla", impressions: 0 });
    expect(ga.ctr).toBeNull(); // 0 impressions → undefined CTR
  });

  // AdForm's own export indents every sheet by one blank column; reports
  // rebuilt by other tooling start at column A. The period must be read from
  // the label's own row, not from a fixed column index.
  it("reads the period from a Front Page with no leading blank column", () => {
    const r = parseAdformReport(buildReport(false));
    expect(r.periodFrom).toBe("01/04/2026 00:00:00");
    expect(r.periodTo).toBe("30/04/2026 23:59:59");
    expect(r.rows).toHaveLength(2);
  });
});
