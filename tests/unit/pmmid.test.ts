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

describe("PMMID — hardcoded format (no pattern configured)", () => {
  for (const c of fixture.cases.hardcoded) {
    it(c.id, () => {
      expect(generatePmmid(c.message)).toBe(c.expected);
    });
  }
});

describe("PMMID — pattern-driven", () => {
  for (const c of fixture.cases.pattern) {
    it(c.id, () => {
      expect(
        generatePmmid(c.message, c.audiences ?? [], c.topics ?? [], c.pattern),
      ).toBe(c.expected);
    });
  }
});
