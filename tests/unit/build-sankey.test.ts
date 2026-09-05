import { describe, it, expect } from "vitest";
import { buildTree, type TreeData } from "@/app/(app)/matrix/_tree/buildTree";
import { parseTreeStructure } from "@/app/(app)/matrix/_tree/parseTreeStructure";
import {
  foldToTopN,
  otherNodeId,
  layoutSankey,
} from "@/app/(app)/matrix/_tree/buildSankey";
import type { Audience, Message, Topic } from "@/app/(app)/matrix/types";

function aud(overrides: Partial<Audience>): Audience {
  return {
    id: 0,
    key: "k",
    name: "K",
    product: null,
    orderIndex: 0,
    status: null,
    strategy: null,
    buyingPlatform: null,
    dataSource: null,
    targetingType: null,
    device: null,
    tag: null,
    comment: null,
    campaignName: null,
    campaignId: null,
    lineitemName: null,
    lineitemId: null,
    channel: null,
    version: 1,
    updatedAt: "",
    archivedAt: null,
    ...overrides,
  };
}

function top(overrides: Partial<Topic>): Topic {
  return {
    id: 0,
    key: "t",
    name: "T",
    product: null,
    orderIndex: 0,
    status: null,
    tag: null,
    tag1: null,
    tag2: null,
    tag3: null,
    tag4: null,
    comment: null,
    created: null,
    version: 1,
    updatedAt: "",
    archivedAt: null,
    ...overrides,
  };
}

function msg(overrides: Partial<Message>): Message {
  return {
    id: 0,
    number: 1,
    variant: "a",
    audience: "k",
    topic: "t",
    status: null,
    name: null,
    headline: null,
    copy1: null,
    copy2: null,
    disclaimer: null,
    headlineStyle: null,
    copy1Style: null,
    copy2Style: null,
    disclaimerStyle: null,
    ctaStyle: null,
    customCss: null,
    template: null,
    templateVariantClasses: null,
    versionNo: 1,
    version: 1,
    pmmid: null,
    startDate: null,
    endDate: null,
    updatedAt: "",
    flash: null,
    flashStyle: null,
    cta: null,
    landingUrl: null,
    image1: null,
    image2: null,
    image3: null,
    image4: null,
    image5: null,
    image6: null,
    video1: null,
    utmCampaign: null,
    utmSource: null,
    utmMedium: null,
    utmContent: null,
    utmTerm: null,
    utmCd26: null,
    finalTraffickedUrl: null,
    archivedAt: null,
    ...overrides,
  };
}

// Four audiences of very different sizes (4, 3, 2, 1 messages), one topic each,
// so the fold has an unambiguous ranking to work with.
function fixture(): TreeData {
  const sizes: Array<[string, number]> = [
    ["a1", 4],
    ["a2", 3],
    ["a3", 2],
    ["a4", 1],
  ];
  const auds: Audience[] = sizes.map(([key], i) =>
    aud({ id: i + 1, key, name: key.toUpperCase() }),
  );
  const tops: Topic[] = [top({ id: 1, key: "t1", name: "T1" })];
  const msgs: Message[] = [];
  let id = 0;
  let number = 0;
  for (const [key, n] of sizes) {
    for (let i = 0; i < n; i++) {
      id += 1;
      number += 1;
      msgs.push(
        msg({
          id,
          number,
          audience: key,
          topic: "t1",
          status: i === 0 ? "ACTIVE" : "PREVIEW",
        }),
      );
    }
  }
  const levels = parseTreeStructure("Audience → Messages");
  return buildTree({ auds, tops, msgs }, levels);
}

function idFor(tree: TreeData, label: string): string {
  const n = tree.nodes.find((x) => x.label === label);
  if (!n) throw new Error(`no node labelled ${label}`);
  return n.id;
}

function countsPerLevel(
  nodes: Array<{ level: number; count: number }>,
): Array<[number, number]> {
  const per = new Map<number, number>();
  for (const n of nodes) per.set(n.level, (per.get(n.level) ?? 0) + n.count);
  return [...per.entries()].sort((a, b) => a[0] - b[0]);
}

describe("foldToTopN", () => {
  it("returns nothing for an empty tree", () => {
    expect(foldToTopN({ nodes: [], edges: [] }, 5)).toEqual({
      nodes: [],
      links: [],
    });
  });

  it("never folds the root column — it has no parent to expand from", () => {
    const { nodes } = foldToTopN(fixture(), 1);
    const level0 = nodes.filter((n) => n.level === 0);
    expect(level0.map((n) => n.label).sort()).toEqual(["A1", "A2", "A3", "A4"]);
    expect(level0.some((n) => n.isOther)).toBe(false);
  });

  it("folds per parent, so only the parent that overflows gets an Other", () => {
    const tree = fixture();
    const { nodes } = foldToTopN(tree, 2);
    // A1 has 4 leaves and the cap is 2, so two fold. A2 has 3: folding one
    // leftover would render "Other (1)", so it shows all three instead.
    const a1Other = nodes.find((n) => n.id === otherNodeId(idFor(tree, "A1")));
    expect(a1Other?.label).toBe("Other (2)");
    expect(a1Other?.count).toBe(2);
    for (const label of ["A2", "A3", "A4"]) {
      expect(
        nodes.find((n) => n.id === otherNodeId(idFor(tree, label))),
      ).toBeUndefined();
    }
  });

  it("keeps every visible parent's children reachable from that parent", () => {
    // The regression this rule exists for: with a per-COLUMN cap, a visible
    // node's whole subtree could lose the column-wide ranking and disappear
    // into a shared Other, so a node on screen led nowhere.
    const tree = fixture();
    const { nodes, links } = foldToTopN(tree, 2);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const outgoing = new Map<string, number>();
    for (const l of links) {
      expect(byId.has(l.source as string)).toBe(true);
      expect(byId.has(l.target as string)).toBe(true);
      outgoing.set(
        l.source as string,
        (outgoing.get(l.source as string) ?? 0) + l.value,
      );
    }
    // Every non-leaf node passes its whole count on to nodes that exist.
    for (const n of nodes) {
      if (n.messageId !== undefined || n.level > 0) continue;
      expect(outgoing.get(n.id)).toBe(n.count);
    }
  });

  it("conserves the message count at every level", () => {
    for (const cap of [1, 2, 3, 10]) {
      // 10 messages, and neither level may lose or double-count one.
      expect(countsPerLevel(foldToTopN(fixture(), cap).nodes)).toEqual([
        [0, 10],
        [1, 10],
      ]);
    }
  });

  it("shows every child of a parent the user expanded", () => {
    const tree = fixture();
    const a1 = idFor(tree, "A1");
    const { nodes } = foldToTopN(tree, 2, new Set([a1]));
    expect(nodes.find((n) => n.id === otherNodeId(a1))).toBeUndefined();
    expect(nodes.filter((n) => n.level === 1)).toHaveLength(10);
    expect(nodes.find((n) => n.id === a1)?.isExpanded).toBe(true);
  });

  it("marks the overflowing parent and its Other with the same expand target", () => {
    const tree = fixture();
    const a1 = idFor(tree, "A1");
    const { nodes } = foldToTopN(tree, 2);
    expect(nodes.find((n) => n.id === a1)?.expandTargetId).toBe(a1);
    expect(nodes.find((n) => n.id === otherNodeId(a1))?.expandTargetId).toBe(a1);
    // A2 does not overflow, so its pill is not a fold handle.
    expect(
      nodes.find((n) => n.id === idFor(tree, "A2"))?.expandTargetId,
    ).toBeUndefined();
  });

  it("carries the folded children's status breakdown into the Other", () => {
    const tree = fixture();
    const { nodes } = foldToTopN(tree, 2);
    const other = nodes.find((n) => n.id === otherNodeId(idFor(tree, "A1")));
    // A1's four messages are one ACTIVE and three PREVIEW; the two biggest by
    // the label tie-break stay, so the fold holds two PREVIEW ones.
    expect(other?.statusCounts).toEqual({ PREVIEW: 2 });
  });
});

describe("layoutSankey", () => {
  it("pins every node to its own structure level", () => {
    const { nodes, links } = foldToTopN(fixture(), 10);
    const graph = layoutSankey(nodes, links);
    const xByLevel = new Map<number, number>();
    for (const n of graph.nodes) {
      const prev = xByLevel.get(n.level);
      if (prev === undefined) xByLevel.set(n.level, n.x0 as number);
      else expect(n.x0).toBe(prev);
    }
    expect((xByLevel.get(1) as number) > (xByLevel.get(0) as number)).toBe(true);
  });

  it("gives every link a ribbon path and a width", () => {
    const { nodes, links } = foldToTopN(fixture(), 10);
    const graph = layoutSankey(nodes, links);
    expect(graph.links.length).toBeGreaterThan(0);
    for (const l of graph.links) {
      expect(l.path.startsWith("M")).toBe(true);
      expect(l.width).toBeGreaterThan(0);
    }
  });
});
