import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { generatePmmid } from "@/lib/pmmid";

const fixturePath = path.resolve(
  process.cwd(),
  "tests/fixtures/v5/pmmid/cases.json",
);

type HardcodedCase = {
  id: string;
  message: {
    audience: string;
    topic: string;
    number: number;
    variant: string;
    version: number;
  };
  expected: string;
};

type PatternCase = HardcodedCase & {
  audiences?: Record<string, unknown>[];
  topics?: Record<string, unknown>[];
  pattern: string;
};

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
  cases: { hardcoded: HardcodedCase[]; pattern: PatternCase[] };
};

// v5 stored the message's version (the -n_ value) in a field called `version`.
// In v6 that name belongs to the save counter, so the fixtures are translated
// here rather than letting the generator accept both names.
function v6(m: HardcodedCase["message"]) {
  const { version, ...rest } = m;
  return { ...rest, versionNo: version };
}

describe("PMMID — hardcoded format (no pattern configured)", () => {
  for (const c of fixture.cases.hardcoded) {
    it(c.id, () => {
      expect(generatePmmid(v6(c.message))).toBe(c.expected);
    });
  }
});

describe("PMMID — pattern-driven", () => {
  for (const c of fixture.cases.pattern) {
    it(c.id, () => {
      expect(
        generatePmmid(v6(c.message), c.audiences ?? [], c.topics ?? [], c.pattern),
      ).toBe(c.expected);
    });
  }
});

describe("PMMID — the -n_ token is the version, never the save counter", () => {
  const placement = { audience: "aud1", topic: "top1", number: 332, variant: "a" };

  it("reads versionNo even when the row has been saved many times", () => {
    // MC332a, observed 2026-11-25: ten saves (version = 10), version_no = 1.
    const row = { ...placement, versionNo: 1, version: 10 };
    expect(generatePmmid(row)).toBe("a_aud1-t_top1-m_332-v_a-n_1");
  });

  it("refuses an input without versionNo instead of falling back to the save counter", () => {
    // A projection that forgot version_no used to put the optimistic-lock
    // counter into the measurement key without a word.
    const row = { ...placement, version: 10 } as unknown as Parameters<
      typeof generatePmmid
    >[0];
    expect(() => generatePmmid(row)).toThrow(/versionNo/);
  });
});
