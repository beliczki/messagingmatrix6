import { describe, it, expect } from "vitest";
import {
  agenticTopicFromFilename,
  channelCodeForSize,
} from "@/lib/agentic-topic";

// The promote dialog OFFERS what the upload path WRITES. Two derivations of
// "the topic this file implies" would drift, and the drift would land an MC in
// a near-duplicate row beside its own siblings.
describe("agenticTopicFromFilename", () => {
  it("joins the product and the filename's keywords", () => {
    expect(
      agenticTopicFromFilename(
        "ERSTE_MARKET_MC405_b_vagyonkezele_s_rem_balatoniparos_n2_300x250.png",
        "MARKET",
      ),
    ).toMatch(/^MARKET_/);
  });

  it("falls back to the product parsed out of the name", () => {
    const out = agenticTopicFromFilename(
      "ERSTE_HK_MC404_b_easypay_n1_300x250.png",
      null,
    );
    expect(out.startsWith("HK_")).toBe(true);
  });

  it("never returns an empty topic", () => {
    expect(agenticTopicFromFilename(null, null)).toBe("creative");
    expect(agenticTopicFromFilename("", "")).toBe("creative");
  });
});

describe("channelCodeForSize", () => {
  it("routes the social sizes to SOC and everything else to DISP", () => {
    expect(channelCodeForSize("1080x1080")).toBe("SOC");
    expect(channelCodeForSize("1200x628")).toBe("SOC");
    expect(channelCodeForSize("300x250")).toBe("DISP");
    expect(channelCodeForSize("970x250")).toBe("DISP");
    expect(channelCodeForSize(null)).toBe("DISP");
  });
});
