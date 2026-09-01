import { describe, it, expect } from "vitest";
import xlsx from "node-xlsx";
import { buildXlsxBuffer, type FeedRowSet } from "@/lib/feed-export";
import {
  DEFAULT_SIGNAL_COLUMN,
  isSignalColumn,
  isValidSignalColumn,
  platformForSignalColumn,
  signalColumnForPlatform,
  SIGNAL_COLUMN_OPTIONS,
} from "@/lib/feed-signal";
import {
  feedExportDisplayName,
  feedExportFilename,
} from "@/lib/feed-filename";
import { extractDefaultMc } from "@/lib/adform-snapshot";

const ADFORM = "AdformSignal:ADFPLAID";
const DV360 = "ExternalSignal:ExternalSignal";

function rowSet(signalColumn?: string): FeedRowSet {
  return {
    columns: ["Text:pmmid", ADFORM, "ReportingLabel"],
    rows: [
      { "Text:pmmid": "p1", [ADFORM]: "14239378", ReportingLabel: "r1" },
      { "Text:pmmid": "p2", [ADFORM]: "14239083", ReportingLabel: "r2" },
    ],
    messageIds: [1, 2],
    defaultRowIndex: -1,
    ...(signalColumn ? { signalColumn } : {}),
  };
}

function sheet(buf: Buffer): string[][] {
  return xlsx.parse(buf)[0].data as string[][];
}

describe("signal column", () => {
  it("recognises both platform aliases and nothing else", () => {
    expect(isSignalColumn(ADFORM)).toBe(true);
    expect(isSignalColumn(DV360)).toBe(true);
    expect(isSignalColumn("Text:pmmid")).toBe(false);
    expect(isValidSignalColumn(DV360)).toBe(true);
    expect(isValidSignalColumn("AdformSignal:typo")).toBe(false);
    expect(isValidSignalColumn(null)).toBe(false);
    expect(SIGNAL_COLUMN_OPTIONS.map((o) => o.value)).toContain(
      DEFAULT_SIGNAL_COLUMN,
    );
  });

  it("keeps the configured header when no signal column is stamped", () => {
    const data = sheet(buildXlsxBuffer(rowSet()));
    expect(data[0][1]).toBe(ADFORM);
    expect(data[1][1]).toBe("14239378");
  });

  it("renames only the header cell, leaving every value in place", () => {
    const data = sheet(buildXlsxBuffer(rowSet(DV360)));
    expect(data[0]).toEqual(["Text:pmmid", DV360, "ReportingLabel"]);
    // The values still come from the configured column key — a rename that lost
    // the lineitem ids would produce a feed AdForm/DV360 silently ignores.
    expect(data[1]).toEqual(["p1", "14239378", "r1"]);
    expect(data[2]).toEqual(["p2", "14239083", "r2"]);
  });

  it("leaves the row set's own columns untouched, so diffs stay comparable", () => {
    const rs = rowSet(DV360);
    buildXlsxBuffer(rs);
    expect(rs.columns).toEqual(["Text:pmmid", ADFORM, "ReportingLabel"]);
  });
});

describe("platform <-> signal column", () => {
  it("maps each signal header to its platform and back", () => {
    expect(platformForSignalColumn(ADFORM)).toBe("adform");
    expect(platformForSignalColumn(DV360)).toBe("dv360");
    expect(signalColumnForPlatform("adform")).toBe(ADFORM);
    expect(signalColumnForPlatform("dv360")).toBe(DV360);
  });

  it("falls back to adform for anything unrecognised", () => {
    // Rows written before the platform column existed are all AdForm, so an
    // unknown value must not invent a third platform.
    expect(platformForSignalColumn("")).toBe("adform");
    expect(platformForSignalColumn("Nonsense:Header")).toBe("adform");
    expect(signalColumnForPlatform("meta")).toBe(DEFAULT_SIGNAL_COLUMN);
  });

  it("puts the platform in the download name", () => {
    // A split export writes two files for the same product+version in the same
    // second; the platform is what tells them apart at a glance.
    expect(feedExportFilename("erste", "SZA", "adform", 1, 40)).toBe(
      "erste-SZA-adform-feed-v1-40.xlsx",
    );
    expect(feedExportFilename("erste", "SZA", "dv360", 1, 41)).toBe(
      "erste-SZA-dv360-feed-v1-41.xlsx",
    );
  });
});

describe("feed export display name", () => {
  const base = {
    id: 42,
    product: "SZK",
    platform: "adform",
    feedVersion: 0,
    notes: null as string | null,
  };

  it("shows the uploaded file's own name for a reference", () => {
    // The name a person will look for in the list is the one they uploaded,
    // not a name we generated for a file they never downloaded.
    expect(
      feedExportDisplayName(
        {
          ...base,
          source: "adform_snapshot",
          notes:
            "Uploaded from AdForm: erste-SZK-feed-v1-27-merged-adform-mc332c-fixed.xlsx",
        },
        "erste",
      ),
    ).toBe("erste-SZK-feed-v1-27-merged-adform-mc332c-fixed.xlsx");
  });

  it("falls back to the generated name when a reference has no notes", () => {
    expect(
      feedExportDisplayName({ ...base, source: "adform_snapshot" }, "erste"),
    ).toBe("erste-SZK-adform-feed-v0-42.xlsx");
  });

  it("keeps the generated name for a real export", () => {
    expect(
      feedExportDisplayName(
        { ...base, feedVersion: 1, source: "export", notes: "some note" },
        "erste",
      ),
    ).toBe("erste-SZK-adform-feed-v1-42.xlsx");
  });
});

describe("extractDefaultMc", () => {
  const columns = [
    "Text:pmmid",
    "Text:messaging_card_id",
    "Text:messaging_card_variant",
  ];

  function rs(row: Record<string, string>) {
    return {
      columns,
      rows: [row],
      messageIds: [-1],
      defaultRowIndex: 0,
    };
  }

  it("reads the MC from the PMMID, not the descriptive columns", () => {
    // A live reference carried card-id 301/b while its PMMID said -m_302-. The
    // PMMID is what the diff, the carry-forward and AdForm all match on, so it
    // wins — otherwise the export rebuilds the DEFAULT row from a different MC
    // and it never lines up with the baseline's.
    expect(
      extractDefaultMc(
        rs({
          "Text:pmmid":
            "p_adform-s_pro-a_DEFAULT-m_302-t_SZK_valami-v_b-n_4",
          "Text:messaging_card_id": "301",
          "Text:messaging_card_variant": "b",
        }),
      ),
    ).toEqual({ number: 302, variant: "b", versionNo: 4 });
  });

  it("falls back to the columns when the PMMID cannot be parsed", () => {
    expect(
      extractDefaultMc(
        rs({
          "Text:pmmid": "not-a-pmmid",
          "Text:messaging_card_id": "301",
          "Text:messaging_card_variant": "b",
        }),
      ),
    ).toEqual({ number: 301, variant: "b" });
  });
});
