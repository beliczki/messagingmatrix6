import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  nextMcSlot,
  nextNewNumber,
  nextVariantForNumber,
} from "@/lib/numbering";

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

describe("mixed-number cells (v6)", () => {
  // Cell with two creative generations: MC90a/b + MC330a/b/c.
  const mixedCell = [
    { number: 90, variant: "a", topic: "t1", audience: "aud1" },
    { number: 90, variant: "b", topic: "t1", audience: "aud1" },
    { number: 330, variant: "a", topic: "t1", audience: "aud1" },
    { number: 330, variant: "b", topic: "t1", audience: "aud1" },
    { number: 330, variant: "c", topic: "t1", audience: "aud1" },
  ];

  it("nextMcSlot scopes the variant to the first occupant's number", () => {
    // Old bug: variant was max across the WHOLE cell ('c' -> 'd'), yielding
    // MC90d and skipping the real next slot MC90c.
    expect(nextMcSlot(mixedCell, "t1", "aud1")).toEqual({
      number: 90,
      variant: "c",
      version: 1,
    });
  });

  it("nextVariantForNumber bumps within the given number only", () => {
    expect(nextVariantForNumber(mixedCell, 330)).toBe("d");
    expect(nextVariantForNumber(mixedCell, 90)).toBe("c");
  });

  it("nextVariantForNumber returns 'a' when the number is absent", () => {
    expect(nextVariantForNumber(mixedCell, 500)).toBe("a");
    expect(nextVariantForNumber([], 1)).toBe("a");
  });

  it("nextVariantForNumber ignores archived and deleted occupants", () => {
    const cell = [
      { number: 90, variant: "a", topic: "t1", audience: "aud1" },
      {
        number: 90,
        variant: "b",
        topic: "t1",
        audience: "aud1",
        archivedAt: "2026-01-01T00:00:00Z",
      },
      {
        number: 90,
        variant: "c",
        topic: "t1",
        audience: "aud1",
        status: "deleted",
      },
    ];
    expect(nextVariantForNumber(cell, 90)).toBe("b");
  });

  it("nextNewNumber is global max + 1 over live rows", () => {
    expect(nextNewNumber(mixedCell)).toBe(331);
    expect(
      nextNewNumber([
        ...mixedCell,
        {
          number: 999,
          variant: "a",
          topic: "t2",
          audience: "aud2",
          archivedAt: "2026-01-01T00:00:00Z",
        },
      ]),
    ).toBe(331);
    expect(nextNewNumber([])).toBe(1);
  });
});
