import { describe, it, expect } from "vitest";
import {
  joinTopic,
  splitTopic,
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
