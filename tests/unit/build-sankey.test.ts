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

describe("foldToTopN", () => {
  it("returns nothing for an empty tree", () => {
    expect(foldToTopN({ nodes: [], edges: [] }, 5)).toEqual({
      nodes: [],
      links: [],
    });
  });

  it("keeps every group when the column fits under the cap", () => {
    const { nodes } = foldToTopN(fixture(), 10);
    const level0 = nodes.filter((n) => n.level === 0);
    expect(level0.map((n) => n.label).sort()).toEqual(["A1", "A2", "A3", "A4"]);
    expect(level0.some((n) => n.isOther)).toBe(false);
  });

  it("folds everything past the cap into one Other node", () => {
    const { nodes } = foldToTopN(fixture(), 2);
    const level0 = nodes.filter((n) => n.level === 0);
    // The two biggest audiences survive; A3 (2) + A4 (1) fold together.
    expect(level0.filter((n) => !n.isOther).map((n) => n.label)).toEqual([
      "A1",
      "A2",
    ]);
    const other = level0.find((n) => n.isOther);
    expect(other?.id).toBe(otherNodeId(0));
    expect(other?.label).toBe("Other (2)");
    expect(other?.count).toBe(3);
  });

  it("keeps the folded mass flowing to the next column instead of dropping it", () => {
    const { nodes, links } = foldToTopN(fixture(), 2);
    // The messages under A3/A4 are never reachable as their own leaves — they
    // continue as one grey branch, so the Other chain carries their count
    // forward as-is.
    const chain = links.find(
      (l) => l.source === otherNodeId(0) && l.target === otherNodeId(1),
    );
    expect(chain?.value).toBe(3);
    // The leaf column's Other holds both: the 3 carried through plus the 5
    // leaves of A1/A2 that did not make the cap themselves.
    const otherLeaf = nodes.find((n) => n.id === otherNodeId(1));
    expect(otherLeaf?.count).toBe(8);
  });

  it("conserves the message count at every level", () => {
    for (const cap of [1, 2, 3, 10]) {
      const { nodes } = foldToTopN(fixture(), cap);
      const perLevel = new Map<number, number>();
      for (const n of nodes) {
        perLevel.set(n.level, (perLevel.get(n.level) ?? 0) + n.count);
      }
      // 10 messages, and neither level may lose or double-count one.
      expect([...perLevel.entries()].sort()).toEqual([
        [0, 10],
        [1, 10],
      ]);
    }
  });

  it("carries the folded groups' status breakdown into the Other node", () => {
    const { nodes } = foldToTopN(fixture(), 2);
    const other = nodes.find((n) => n.id === otherNodeId(0));
    // A3 and A4 contribute one ACTIVE each; A3's second message is PREVIEW.
    expect(other?.statusCounts).toEqual({ ACTIVE: 2, PREVIEW: 1 });
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
