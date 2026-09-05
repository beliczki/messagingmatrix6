import { describe, it, expect } from "vitest";
import { parseTreeStructure } from "@/app/(app)/matrix/_tree/parseTreeStructure";
import {
  buildSankeyData,
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

// Three audiences over two shared topics, and one card (MC1a) carried by two of
// them. The sharing is the point: as PATHS this is six chains, as ENTITIES it is
// three audiences, two topics and five cards.
const LEVELS = parseTreeStructure("Audience → Topic → Messages");

function fixture() {
  const auds = [
    aud({ id: 1, key: "a1", name: "A1" }),
    aud({ id: 2, key: "a2", name: "A2" }),
    aud({ id: 3, key: "a3", name: "A3" }),
  ];
  const tops = [
    top({ id: 1, key: "t1", name: "T1" }),
    top({ id: 2, key: "t2", name: "T2" }),
  ];
  const spec: Array<[string, string, number, string]> = [
    ["a1", "t1", 1, "ACTIVE"],
    ["a1", "t1", 2, "ACTIVE"],
    ["a1", "t2", 3, "PREVIEW"],
    ["a2", "t1", 1, "ACTIVE"], // the same CARD as a1/t1's first message
    ["a2", "t2", 4, "PREVIEW"],
    ["a3", "t1", 5, "ACTIVE"],
  ];
  const msgs = spec.map(([audience, topic, number, status], i) =>
    msg({ id: i + 1, number, variant: "a", audience, topic, status }),
  );
  return { auds, tops, msgs };
}

function nodesAt<T extends { level: number }>(nodes: T[], level: number): T[] {
  return nodes.filter((n) => n.level === level);
}

describe("buildSankeyData", () => {
  it("returns nothing without levels or messages", () => {
    expect(buildSankeyData(fixture(), [], 10)).toEqual({
      nodes: [],
      links: [],
      metricIsEmpty: false,
    });
    expect(
      buildSankeyData({ auds: [], tops: [], msgs: [] }, LEVELS, 10),
    ).toEqual({ nodes: [], links: [], metricIsEmpty: false });
  });

  it("merges an entity into ONE node however many parents feed it", () => {
    // This is what separates a sankey from the tree: T1 is used by all three
    // audiences and is still a single node, with three ribbons arriving.
    const { nodes, links } = buildSankeyData(fixture(), LEVELS, 100);
    const topicNodes = nodesAt(nodes, 1);
    expect(topicNodes.map((n) => n.label).sort()).toEqual(["T1", "T2"]);
    const t1 = topicNodes.find((n) => n.label === "T1");
    expect(t1?.count).toBe(4);
    expect(links.filter((l) => l.target === t1?.id)).toHaveLength(3);
  });

  it("merges a card carried by several audiences into one leaf", () => {
    const { nodes } = buildSankeyData(fixture(), LEVELS, 100);
    const cards = nodesAt(nodes, 2);
    expect(cards.map((n) => n.label).sort()).toEqual([
      "MC1a",
      "MC2a",
      "MC3a",
      "MC4a",
      "MC5a",
    ]);
    // MC1a sits in two audiences and is still one node, weighing two messages.
    expect(cards.find((n) => n.label === "MC1a")?.count).toBe(2);
  });

  it("counts every message exactly once in every column", () => {
    for (const cap of [1, 2, 100]) {
      const { nodes } = buildSankeyData(fixture(), LEVELS, cap);
      const per = new Map<number, number>();
      for (const n of nodes) per.set(n.level, (per.get(n.level) ?? 0) + n.count);
      expect([...per.entries()].sort((a, b) => a[0] - b[0])).toEqual([
        [0, 6],
        [1, 6],
        [2, 6],
      ]);
    }
  });

  it("lets a folded node keep feeding the real nodes downstream", () => {
    // In a DAG the Other inherits its members' own links, so a folded audience's
    // flow still arrives at the topics it feeds — nothing is left leading
    // nowhere, and no second Other has to be chained on to carry it.
    const { nodes, links } = buildSankeyData(fixture(), LEVELS, 1);
    const other = nodes.find((n) => n.id === otherNodeId(0));
    expect(other?.label).toBe("Other (2)");
    expect(other?.count).toBe(3);
    const t1 = nodesAt(nodes, 1).find((n) => n.label === "T1");
    const t2 = nodesAt(nodes, 1).find((n) => n.label === "T2");
    expect(links.find((l) => l.source === other?.id && l.target === t1?.id)?.value).toBe(2);
    expect(links.find((l) => l.source === other?.id && l.target === t2?.id)?.value).toBe(1);
  });

  it("never renders Other (1)", () => {
    // The topic column holds exactly two nodes; a cap of 1 would fold one of
    // them, which costs a row and says nothing.
    const { nodes } = buildSankeyData(fixture(), LEVELS, 1);
    expect(nodesAt(nodes, 1)).toHaveLength(2);
    expect(nodesAt(nodes, 1).some((n) => n.isOther)).toBe(false);
  });

  it("shows the whole column the user expanded", () => {
    const { nodes } = buildSankeyData(fixture(), LEVELS, 1, new Set([0]));
    expect(nodes.find((n) => n.id === otherNodeId(0))).toBeUndefined();
    expect(nodesAt(nodes, 0).map((n) => n.label).sort()).toEqual([
      "A1",
      "A2",
      "A3",
    ]);
  });

  it("breaks a node's count down by status", () => {
    const { nodes } = buildSankeyData(fixture(), LEVELS, 100);
    const t1 = nodesAt(nodes, 1).find((n) => n.label === "T1");
    const t2 = nodesAt(nodes, 1).find((n) => n.label === "T2");
    expect(t1?.statusCounts).toEqual({ ACTIVE: 4 });
    expect(t2?.statusCounts).toEqual({ PREVIEW: 2 });
  });
});

describe("layoutSankey", () => {
  it("pins every node to its own structure level", () => {
    const { nodes, links } = buildSankeyData(fixture(), LEVELS, 100);
    const graph = layoutSankey(nodes, links);
    const xByLevel = new Map<number, number>();
    for (const n of graph.nodes) {
      const prev = xByLevel.get(n.level);
      if (prev === undefined) xByLevel.set(n.level, n.x0 as number);
      else expect(n.x0).toBe(prev);
    }
    expect((xByLevel.get(1) as number) > (xByLevel.get(0) as number)).toBe(true);
    expect((xByLevel.get(2) as number) > (xByLevel.get(1) as number)).toBe(true);
  });

  it("gives every link a ribbon path and a width", () => {
    const { nodes, links } = buildSankeyData(fixture(), LEVELS, 100);
    const graph = layoutSankey(nodes, links);
    expect(graph.links.length).toBeGreaterThan(0);
    for (const l of graph.links) {
      expect(l.path.startsWith("M")).toBe(true);
      expect(l.width).toBeGreaterThan(0);
    }
  });
});

describe("buildSankeyData — metric weighting", () => {
  const metrics = new Map([
    [1, { impressions: 100, cost: 1000, conversions: 2 }],
    [2, { impressions: 50, cost: 500, conversions: 0 }],
    // messages 3-6 delivered nothing the report could see.
  ]);

  it("weighs nodes and ribbons by the chosen metric", () => {
    const { nodes, links } = buildSankeyData(
      fixture(),
      LEVELS,
      100,
      new Set(),
      "impressions",
      metrics,
    );
    // A1 carries messages 1, 2 and 3 → 100 + 50 + 0.
    const a1 = nodesAt(nodes, 0).find((n) => n.label === "A1");
    expect(a1?.count).toBe(150);
    // The message count is kept alongside, so the tooltip can still say three.
    expect(a1?.messageCount).toBe(3);
    const t1 = nodesAt(nodes, 1).find((n) => n.label === "T1");
    expect(links.find((l) => l.source === a1?.id && l.target === t1?.id)?.value).toBe(150);
  });

  it("sums conversions per node whatever the weighting is", () => {
    const { nodes } = buildSankeyData(
      fixture(),
      LEVELS,
      100,
      new Set(),
      "cost",
      metrics,
    );
    expect(nodesAt(nodes, 0).find((n) => n.label === "A1")?.conversions).toBe(2);
    expect(nodesAt(nodes, 0).find((n) => n.label === "A3")?.conversions).toBe(0);
  });

  it("reports an empty metric rather than laying out a graph of zeroes", () => {
    const out = buildSankeyData(
      fixture(),
      LEVELS,
      100,
      new Set(),
      "cost",
      new Map(),
    );
    expect(out.metricIsEmpty).toBe(true);
    expect(out.nodes).toEqual([]);
  });

  it("still counts messages when no metric is chosen", () => {
    const { nodes } = buildSankeyData(fixture(), LEVELS, 100);
    const a1 = nodesAt(nodes, 0).find((n) => n.label === "A1");
    expect(a1?.count).toBe(3);
    expect(a1?.messageCount).toBe(3);
  });
});
