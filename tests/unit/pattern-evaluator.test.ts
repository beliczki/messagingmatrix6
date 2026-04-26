import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { evaluatePattern } from "@/lib/patterns";

const fixturePath = path.resolve(
  process.cwd(),
  "tests/fixtures/v5/pattern-evaluator/cases.json",
);

type Case = {
  id: string;
  pattern: string | null;
  context: Record<string, unknown>;
  expected: string;
};

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
  cases: { evaluatePattern: Case[] };
};

describe("evaluatePattern (v5 fixture contract)", () => {
  for (const c of fixture.cases.evaluatePattern) {
    it(c.id, () => {
      expect(evaluatePattern(c.pattern, c.context)).toBe(c.expected);
    });
  }
});
