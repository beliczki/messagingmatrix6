import { describe, it, expect } from "vitest";
import {
  joinTopic,
  splitTopic,
  vocabulary,
  type Parts,
} from "@/app/(app)/matrix/PlannedTopicField";

const parts = (over: Partial<Parts> = {}): Parts => ({
  tag1: "",
  tag2: "",
  tag3: "",
  tag4: "",
  ...over,
});

// The composer's two halves have to be inverses. When they were not, a
// character typed into tag4 came back as tag1 — the text moved fields under the
// user's hands and the caret went with it.
describe("planned topic composer", () => {
  it("keeps a part in its own slot when the ones before it are empty", () => {
    const composed = joinTopic("MARKET", parts({ tag4: "t" }));
    expect(composed).toBe("MARKET____t");
    expect(splitTopic(composed, "MARKET")).toEqual(parts({ tag4: "t" }));
  });

  it("round-trips a fully filled key", () => {
    const p = parts({
      tag1: "edukacio",
      tag2: "nehezseg",
      tag3: "benefit",
      tag4: "easypay",
    });
    const composed = joinTopic("HK", p);
    expect(composed).toBe("HK_edukacio_nehezseg_benefit_easypay");
    expect(splitTopic(composed, "HK")).toEqual(p);
  });

  it("round-trips the NA-heavy shape the dimension actually uses", () => {
    const p = parts({ tag1: "edukacio", tag2: "NA", tag3: "NA", tag4: "kamat" });
    expect(splitTopic(joinTopic("SZK", p), "SZK")).toEqual(p);
  });

  it("drops trailing empties — nothing follows them to hold a position", () => {
    expect(joinTopic("VAL", parts({ tag1: "brand" }))).toBe("VAL_brand");
  });

  it("keeps underscores inside tag 4", () => {
    const p = parts({ tag1: "promocio", tag2: "NA", tag3: "NA", tag4: "teya_80" });
    const composed = joinTopic("VAL", p);
    expect(composed).toBe("VAL_promocio_NA_NA_teya_80");
    expect(splitTopic(composed, "VAL")).toEqual(p);
  });

  it("survives a value with no product prefix", () => {
    expect(splitTopic("edukacio_NA_NA_thing", "HK")).toEqual(
      parts({ tag1: "edukacio", tag2: "NA", tag3: "NA", tag4: "thing" }),
    );
  });

  it("reads an empty value as four empty parts", () => {
    expect(splitTopic(null, "HK")).toEqual(parts());
    expect(joinTopic("HK", parts())).toBe("HK");
  });
});

// The picker used to be built from the topics dimension alone, which made it a
// mirror of the past: a keyword added for work that has not started yet — the
// exact moment a draft is briefed — could not be picked.
describe("planned topic vocabulary", () => {
  const topic = (tag2: string | null) =>
    ({ tag2 }) as unknown as Parameters<typeof vocabulary>[1][number];

  it("offers a curated keyword no topic uses yet", () => {
    const out = vocabulary(["bankvaltas", "partner"], [topic("bankvaltas")], (t) => t.tag2);
    expect(out).toContain("partner");
  });

  it("keeps the curated order instead of re-sorting it", () => {
    const out = vocabulary(["zzz", "aaa", "mmm"], [], (t) => t.tag2);
    expect(out).toEqual(["zzz", "aaa", "mmm"]);
  });

  it("keeps an in-use value the curated list does not carry", () => {
    const out = vocabulary(["partner"], [topic("legacy")], (t) => t.tag2);
    expect(out).toEqual(["partner", "legacy"]);
  });

  it("puts NA first wherever it comes from, and never repeats a value", () => {
    const out = vocabulary(["partner", "NA"], [topic("NA"), topic("partner")], (t) => t.tag2);
    expect(out).toEqual(["NA", "partner"]);
  });

  it("ignores blank and whitespace-only values", () => {
    const out = vocabulary(["  ", "partner"], [topic(""), topic(null)], (t) => t.tag2);
    expect(out).toEqual(["partner"]);
  });
});
