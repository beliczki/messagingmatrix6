import { describe, it, expect } from "vitest";
import {
  defaultConfigSeed,
  DEFAULT_LOOK_AND_FEEL,
  DEFAULT_PATTERNS,
} from "@/db/defaults";

describe("defaultConfigSeed", () => {
  it("returns a row for every Settings tab consumer", () => {
    const seed = defaultConfigSeed();
    const keys = seed.map((r) => r.key);
    for (const required of [
      "lookAndFeel",
      "patterns",
      "audienceStructure",
      "topicStructure",
      "messagesStructure",
      "creativeStructure",
      "feedStructure",
      "creativeParsingRules",
      "visibleTemplates",
    ]) {
      expect(keys).toContain(required);
    }
  });

  it("has every status color key the v5 status enum uses", () => {
    const expected = [
      "INCOMING",
      "NAMING",
      "CONTENT",
      "PREVIEW",
      "APPROVED",
      "ACTIVE",
      "INACTIVE",
      "ERROR",
      "DEAD",
      "MEMORY",
    ];
    for (const k of expected) {
      expect(DEFAULT_LOOK_AND_FEEL.statusColors).toHaveProperty(k);
    }
  });

  it("PMMID pattern reproduces the v5 default exactly", () => {
    expect(DEFAULT_PATTERNS.pmmid).toBe(
      "a_{{audience}}-t_{{topic}}-m_{{number}}-v_{{variant}}-n_{{version_no}}",
    );
  });
});
