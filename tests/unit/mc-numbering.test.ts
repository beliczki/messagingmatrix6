import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { nextMcSlot } from "@/lib/numbering";

const fixturePath = path.resolve(
  process.cwd(),
  "tests/fixtures/v5/mc-numbering/cases.json",
);

type Case = {
  id: string;
  messages: Array<{
    number?: number;
    variant?: string;
    topic: string;
    audience: string;
    status?: string;
  }>;
  insert: { topic: string; audience: string };
  expected: { number: number; variant: string; version: number };
};

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
  cases: Case[];
};

describe("nextMcSlot (v5 fixture contract)", () => {
  for (const c of fixture.cases) {
    it(c.id, () => {
      const got = nextMcSlot(c.messages, c.insert.topic, c.insert.audience);
      expect(got).toEqual(c.expected);
    });
  }
});
