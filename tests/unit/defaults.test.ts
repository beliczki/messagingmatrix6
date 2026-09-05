import { describe, it, expect } from "vitest";
import { MC_STATUSES } from "@/lib/mc-status";
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

  // Was "every key the v5 status enum uses" — that enum is gone. The seed now
  // has to match the canonical list EXACTLY: a missing key leaves a status with
  // no colour, and a leftover key is a status the app no longer knows, which is
  // the pair of mistakes the six duplicated lists used to make.
  it("seeds a colour for every MC status, and only those", () => {
    expect(Object.keys(DEFAULT_LOOK_AND_FEEL.statusColors).sort()).toEqual(
      [...MC_STATUSES].sort(),
    );
  });

  it("PMMID pattern reproduces the v5 default exactly", () => {
    expect(DEFAULT_PATTERNS.pmmid).toBe(
      "a_{{audience}}-t_{{topic}}-m_{{number}}-v_{{variant}}-n_{{version_no}}",
    );
  });
});
