import { describe, it, expect } from "vitest";
import { buildTree } from "@/app/(app)/matrix/_tree/buildTree";
import { parseTreeStructure } from "@/app/(app)/matrix/_tree/parseTreeStructure";
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

describe("buildTree", () => {
  it("returns empty for empty data", () => {
    const levels = parseTreeStructure("Audience → Messages");
    expect(buildTree({ auds: [], tops: [], msgs: [] }, levels)).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("returns empty for empty levels", () => {
    expect(
      buildTree(
        { auds: [aud({})], tops: [top({})], msgs: [msg({ id: 1 })] },
        [],
      ),
    ).toEqual({ nodes: [], edges: [] });
  });

  it("groups two messages into one Audience node", () => {
    const auds = [aud({ key: "audA", name: "A" })];
    const tops = [top({ key: "topX", name: "X" })];
    const msgs = [
      msg({ id: 1, number: 1, variant: "a", audience: "audA", topic: "topX" }),
      msg({ id: 2, number: 1, variant: "b", audience: "audA", topic: "topX" }),
    ];
    const levels = parseTreeStructure("Audience → Messages");
    const { nodes, edges } = buildTree({ auds, tops, msgs }, levels);
    // 1 audience node + 2 message leaf nodes
    expect(nodes).toHaveLength(3);
    const audNode = nodes.find((n) => n.level === 0)!;
    expect(audNode.label).toBe("A");
    expect(audNode.count).toBe(2);
    expect(audNode.entityKey).toBe("audA");
    expect(audNode.parentId).toBe(null);
    // leaf nodes carry the audience as their parentId
    const leaves = nodes.filter((n) => n.level === 1);
    expect(leaves.every((l) => l.parentId === audNode.id)).toBe(true);
    // both leaf edges point at the audience node
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.source === audNode.id)).toBe(true);
  });

  it("buckets null group values under (none)", () => {
    const auds = [
      aud({ key: "a1", name: "A1", product: "P1" }),
      aud({ key: "a2", name: "A2", product: null }),
    ];
    const tops = [top({ key: "t", name: "T" })];
    const msgs = [
      msg({ id: 10, audience: "a1", topic: "t" }),
      msg({ id: 11, audience: "a2", topic: "t" }),
    ];
    const levels = parseTreeStructure("Product → Messages");
    const { nodes } = buildTree({ auds, tops, msgs }, levels);
    const productNodes = nodes.filter((n) => n.level === 0);
    expect(productNodes.map((n) => n.label).sort()).toEqual(["(none)", "P1"]);
  });

  it("produces deterministic node order (level then label)", () => {
    const auds = [
      aud({ key: "a", name: "Zebra", strategy: "S1" }),
      aud({ key: "b", name: "Apple", strategy: "S1" }),
    ];
    const tops = [top({ key: "t" })];
    const msgs = [
      msg({ id: 1, audience: "a", topic: "t" }),
      msg({ id: 2, audience: "b", topic: "t" }),
    ];
    const levels = parseTreeStructure("Strategy → Audience → Messages");
    const { nodes } = buildTree({ auds, tops, msgs }, levels);
    const audienceLevel = nodes.filter((n) => n.level === 1).map((n) => n.label);
    expect(audienceLevel).toEqual(["Apple", "Zebra"]);
  });
});
