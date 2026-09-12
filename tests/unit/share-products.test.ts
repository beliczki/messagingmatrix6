import { describe, expect, it } from "vitest";
import { shareProducts } from "@/lib/share-metadata";

const snapshot = (o: unknown) => JSON.stringify(o);

describe("shareProducts", () => {
  it("reads the product off the snapshot's creatives", () => {
    expect(
      shareProducts(
        snapshot({ creatives: [{ product: "MARKET" }, { product: "MARKET" }] }),
      ),
    ).toEqual(["MARKET"]);
  });

  it("falls back to the topic prefix for matrix cells", () => {
    // Snapshots freeze the message row, not the audience it points at, so the
    // canonical `coalesce(audiences.product, split_part(topic,'_',1))` has only
    // its second half available here.
    expect(
      shareProducts(
        snapshot({ messages: [{ topic: "SZK_felhaszcelja_varatlan_lakas" }] }),
      ),
    ).toEqual(["SZK"]);
  });

  it("prefers an explicit product over the topic prefix", () => {
    expect(
      shareProducts(snapshot({ messages: [{ product: "SZA", topic: "SZK_x" }] })),
    ).toEqual(["SZA"]);
  });

  it("collects every product a mixed share covers", () => {
    expect(
      shareProducts(
        snapshot({
          creatives: [{ product: "MARKET" }],
          messages: [{ topic: "SZA_diakszamla_q3" }],
        }),
      ).sort(),
    ).toEqual(["MARKET", "SZA"]);
  });

  it("returns nothing for an empty, malformed or missing snapshot", () => {
    expect(shareProducts(null)).toEqual([]);
    expect(shareProducts("{not json")).toEqual([]);
    expect(shareProducts(snapshot({ creatives: [], messages: [] }))).toEqual([]);
    // No underscore in the topic key: nothing to split, so nothing is claimed.
    expect(shareProducts(snapshot({ messages: [{ topic: "orphan" }] }))).toEqual(
      [],
    );
  });
});
