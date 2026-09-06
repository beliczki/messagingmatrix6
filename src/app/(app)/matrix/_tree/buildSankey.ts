// Builds the sankey graph from the same `treeStructure` levels the tree view
// uses — but as a DAG, not a tree, and that distinction is the whole file.
//
// A tree node is a PATH: `buildTree` keys nodes on the whole chain of ancestors,
// because in a tree every node has exactly one parent. A sankey node is an
// ENTITY: one topic is one node, with ribbons arriving from every audience that
// uses it. Merging on the entity is not a nicety, it is what a sankey is for —
// and it is also what makes the diagram fit. On the live Erste filter the two
// identities differ by an order of magnitude:
//
//     level      as paths   as entities
//     topic         446          27
//     MC            681          54
//
// So this module walks the levels itself rather than reusing `buildTree`'s
// output. It shares the row assembly and the per-level grouping with the tree
// (`messageRows` / `groupValue`), so the two views can never disagree about what
// the structure is — only about whether a node is a path or a thing.

import {
  sankey as d3Sankey,
  sankeyLeft,
  sankeyLinkHorizontal,
} from "d3-sankey";
import { groupValue, messageRows } from "./buildTree";
import type { TreeLevel } from "./parseTreeStructure";
import type { Audience, Message, Topic } from "../types";

/** What the ribbon widths mean. `messages` needs no monitoring data at all. */
export type SankeyMetric = "messages" | "impressions" | "cost";

/** Per-message delivery for the chosen report period, keyed by message id. */
export type MetricRows = Map<
  number,
  { impressions: number; cost: number; conversions: number }
>;

export type SankeyNodeDatum = {
  id: string;
  label: string;
  level: number;
  /** The weight the diagram is drawn on — the active metric's total. */
  count: number;
  /**
   * Rows of `messages` under the node — which is a count of PLACEMENTS, not of
   * cards, at every level. One card put out in 24 audiences is 24 rows, so a
   * topic holding three cards across 24 audiences counts 72. Calling that "72
   * messages" reads as 72 different things; `cardCount` is the number of
   * different things.
   */
  placementCount: number;
  /** Distinct MC cards (number + variant) under the node. 1 on a leaf. */
  cardCount: number;
  /** Distinct audiences and topics the node's rows sit in. */
  audienceCount: number;
  topicCount: number;
  /** Conversions attributed to this node in the chosen period. */
  conversions: number;
  /** True for the synthetic per-column fold node. */
  isOther: boolean;
  /** How many real nodes this Other folds in. 0 on real nodes. */
  foldedGroups: number;
  statusCounts: Record<string, number>;
  /** A message to open when a leaf is clicked. A card carried by several
   *  audiences is one node, so this is its first message in row order. */
  messageId?: number;
  platform?: string;
  /** Set on an Other: clicking it expands that whole column. */
  expandLevel?: number;
  // Written by d3-sankey during layout.
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  value?: number;
};

export type SankeyLinkDatum = {
  id: string;
  source: string | SankeyNodeDatum;
  target: string | SankeyNodeDatum;
  value: number;
  // Written by d3-sankey during layout.
  width?: number;
  y0?: number;
  y1?: number;
};

export type SankeyGraph = {
  nodes: SankeyNodeDatum[];
  links: Array<SankeyLinkDatum & { path: string }>;
  width: number;
  height: number;
};

/** Column geometry — the sankey's own constants, not the tree's. */
export const SANKEY_COLUMN_GAP = 260;
export const SANKEY_NODE_WIDTH = 14;
// The gap between two stacked nodes is the ONLY separation the layout
// guarantees: a node's own height is proportional to its value, so in a column
// where one node holds most of the flow the rest are sub-pixel slivers. The
// padding therefore has to clear a label pill (~18px) on its own, or the labels
// sit on top of each other.
export const SANKEY_NODE_PADDING = 22;
/** Vertical room reserved per node: one padding gap plus room for the bar. */
const MIN_ROW_HEIGHT = 34;
const MIN_CANVAS_HEIGHT = 420;

/** The fold node that holds one column's overflow. */
export function otherNodeId(level: number): string {
  return `other:${level}`;
}

type NodeAgg = {
  id: string;
  level: number;
  label: string;
  rows: Set<number>;
  platforms: Set<string>;
  cardKeys: Set<string>;
  audienceKeys: Set<string>;
  topicKeys: Set<string>;
  messageId?: number;
};

/**
 * The full DAG: one node per (level, entity), one link per (source, target)
 * entity pair, both weighted by the number of distinct messages flowing through.
 */
function buildGraph(
  data: { auds: Audience[]; tops: Topic[]; msgs: Message[] },
  levels: TreeLevel[],
): { nodes: NodeAgg[]; links: Map<string, { source: string; target: string; rows: Set<number> }> } {
  const nodeMap = new Map<string, NodeAgg>();
  const linkMap = new Map<
    string,
    { source: string; target: string; rows: Set<number> }
  >();

  for (const row of messageRows(data)) {
    let prevId: string | null = null;
    for (let i = 0; i < levels.length; i++) {
      const gv = groupValue(levels[i], row);
      const id = `${i}:${gv.key}`;

      let agg = nodeMap.get(id);
      if (!agg) {
        agg = {
          id,
          level: i,
          label: gv.label,
          rows: new Set(),
          platforms: new Set(),
          cardKeys: new Set(),
          audienceKeys: new Set(),
          topicKeys: new Set(),
        };
        if (levels[i].kind === "messages") agg.messageId = row.message.id;
        nodeMap.set(id, agg);
      }
      agg.rows.add(row.message.id);
      agg.cardKeys.add(`${row.message.number}${row.message.variant}`);
      agg.audienceKeys.add(row.audience.key);
      agg.topicKeys.add(row.topic.key);
      if (row.audience.buyingPlatform) agg.platforms.add(row.audience.buyingPlatform);

      if (prevId !== null) {
        const key = `${prevId}->${id}`;
        let link = linkMap.get(key);
        if (!link) {
          link = { source: prevId, target: id, rows: new Set() };
          linkMap.set(key, link);
        }
        link.rows.add(row.message.id);
      }
      prevId = id;
    }
  }

  return { nodes: [...nodeMap.values()], links: linkMap };
}

/**
 * Folds a column that runs past `cap` down to its largest nodes.
 *
 * In a DAG the fold is cheap and honest: the Other node inherits the folded
 * nodes' own links, so a folded audience's flow still arrives at the real topics
 * it feeds. Nothing has to be chained into a second Other to keep the diagram
 * connected, and no visible node is left leading nowhere.
 *
 * `expandedLevels` holds the columns the user opened; those are never folded.
 */
export function buildSankeyData(
  data: { auds: Audience[]; tops: Topic[]; msgs: Message[] },
  levels: TreeLevel[],
  cap: number,
  expandedLevels: Set<number> = new Set(),
  metric: SankeyMetric = "messages",
  metrics?: MetricRows,
): { nodes: SankeyNodeDatum[]; links: SankeyLinkDatum[]; metricIsEmpty: boolean } {
  if (levels.length === 0 || data.msgs.length === 0) {
    return { nodes: [], links: [], metricIsEmpty: false };
  }

  const { nodes: aggs, links: linkAggs } = buildGraph(data, levels);
  if (aggs.length === 0) return { nodes: [], links: [], metricIsEmpty: false };

  // Weight of one message under the active metric. A message with no monitoring
  // row weighs nothing — it did not deliver, as far as the report knows.
  function weigh(id: number): number {
    if (metric === "messages") return 1;
    const m = metrics?.get(id);
    if (!m) return 0;
    return metric === "cost" ? m.cost : m.impressions;
  }
  function sumWeight(rows: Iterable<number>): number {
    let total = 0;
    for (const id of rows) total += weigh(id);
    return total;
  }
  function sumConversions(rows: Iterable<number>): number {
    let total = 0;
    for (const id of rows) total += metrics?.get(id)?.conversions ?? 0;
    return total;
  }

  // Nothing in this selection delivered under the chosen metric. d3-sankey
  // cannot lay out an all-zero graph, and a diagram of zeroes would say nothing
  // anyway, so the caller is told to render the empty state instead.
  const metricIsEmpty =
    metric !== "messages" &&
    aggs.every((n) => sumWeight(n.rows) === 0);
  if (metricIsEmpty) return { nodes: [], links: [], metricIsEmpty: true };

  const statusById = new Map(data.msgs.map((m) => [m.id, m.status ?? ""]));
  function statusesOf(rows: Iterable<number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of rows) {
      const st = statusById.get(id);
      if (st === undefined || st === "") continue;
      out[st] = (out[st] ?? 0) + 1;
    }
    return out;
  }

  const byLevel = new Map<number, NodeAgg[]>();
  for (const n of aggs) {
    const arr = byLevel.get(n.level) ?? [];
    arr.push(n);
    byLevel.set(n.level, arr);
  }

  // Which real node each id renders as: itself, or its column's Other.
  const renderAs = new Map<string, string>();
  const nodes: SankeyNodeDatum[] = [];

  for (const [level, columnNodes] of byLevel) {
    const ranked = [...columnNodes].sort(
      (a, b) => sumWeight(b.rows) - sumWeight(a.rows) || a.label.localeCompare(b.label),
    );
    // Folding a single leftover would render "Other (1)" — a row that costs as
    // much as the node it hides.
    const folds = !expandedLevels.has(level) && ranked.length > cap + 1;
    const keepList = folds ? ranked.slice(0, cap) : ranked;
    const foldList = folds ? ranked.slice(cap) : [];

    for (const n of keepList) {
      renderAs.set(n.id, n.id);
      const d: SankeyNodeDatum = {
        id: n.id,
        label: n.label,
        level,
        count: sumWeight(n.rows),
        placementCount: n.rows.size,
        cardCount: n.cardKeys.size,
        audienceCount: n.audienceKeys.size,
        topicCount: n.topicKeys.size,
        conversions: sumConversions(n.rows),
        isOther: false,
        foldedGroups: 0,
        statusCounts: statusesOf(n.rows),
      };
      if (n.messageId !== undefined) d.messageId = n.messageId;
      if (n.platforms.size === 1) d.platform = [...n.platforms][0];
      nodes.push(d);
    }

    if (foldList.length > 0) {
      const oid = otherNodeId(level);
      const rows = new Set<number>();
      const cardKeys = new Set<string>();
      const audienceKeys = new Set<string>();
      const topicKeys = new Set<string>();
      for (const n of foldList) {
        renderAs.set(n.id, oid);
        for (const r of n.rows) rows.add(r);
        for (const c of n.cardKeys) cardKeys.add(c);
        for (const a of n.audienceKeys) audienceKeys.add(a);
        for (const t of n.topicKeys) topicKeys.add(t);
      }
      nodes.push({
        id: oid,
        label: `Other (${foldList.length})`,
        level,
        count: sumWeight(rows),
        placementCount: rows.size,
        cardCount: cardKeys.size,
        audienceCount: audienceKeys.size,
        topicCount: topicKeys.size,
        conversions: sumConversions(rows),
        isOther: true,
        foldedGroups: foldList.length,
        statusCounts: statusesOf(rows),
        expandLevel: level,
      });
    }
  }

  // Re-point every link at whatever its endpoints render as, merging the ones
  // that collapse onto the same pair. A link's weight is the number of distinct
  // messages on it, so merged links union their rows rather than adding counts —
  // two folded audiences feeding one topic must not count a message twice.
  const merged = new Map<
    string,
    { source: string; target: string; rows: Set<number> }
  >();
  for (const l of linkAggs.values()) {
    const source = renderAs.get(l.source);
    const target = renderAs.get(l.target);
    if (source === undefined || target === undefined) continue;
    const key = `${source}->${target}`;
    let entry = merged.get(key);
    if (!entry) {
      entry = { source, target, rows: new Set() };
      merged.set(key, entry);
    }
    for (const r of l.rows) entry.rows.add(r);
  }

  const links: SankeyLinkDatum[] = [...merged.entries()].map(
    ([id, { source, target, rows }]) => ({
      id,
      source,
      target,
      value: sumWeight(rows),
    }),
  );

  return { nodes, links, metricIsEmpty: false };
}

/**
 * Runs the d3-sankey layout and attaches the ribbon path for each link.
 * `sankeyLeft` pins every node to its own structure level, which is what we
 * want — the columns ARE the structure levels, not a derived depth.
 */
export function layoutSankey(
  nodes: SankeyNodeDatum[],
  links: SankeyLinkDatum[],
): SankeyGraph {
  if (nodes.length === 0) return { nodes: [], links: [], width: 0, height: 0 };

  const maxLevel = nodes.reduce((m, n) => Math.max(m, n.level), 0);
  const perColumn = new Map<number, number>();
  for (const n of nodes) {
    perColumn.set(n.level, (perColumn.get(n.level) ?? 0) + 1);
  }
  const tallestColumn = Math.max(...perColumn.values());

  const width = maxLevel * SANKEY_COLUMN_GAP + SANKEY_NODE_WIDTH;
  const height = Math.max(MIN_CANVAS_HEIGHT, tallestColumn * MIN_ROW_HEIGHT);

  // d3-sankey mutates what it is handed, so it gets copies — the caller's
  // memoised arrays stay clean and re-running the layout stays idempotent.
  const graph = d3Sankey<SankeyNodeDatum, SankeyLinkDatum>()
    .nodeId((d) => d.id)
    .nodeWidth(SANKEY_NODE_WIDTH)
    .nodePadding(SANKEY_NODE_PADDING)
    .nodeAlign(sankeyLeft)
    .extent([
      [0, 0],
      [width, height],
    ])({
    nodes: nodes.map((n) => ({ ...n })),
    links: links.map((l) => ({ ...l })),
  });

  const pathOf = sankeyLinkHorizontal<SankeyNodeDatum, SankeyLinkDatum>();

  return {
    nodes: graph.nodes,
    links: graph.links.map((l) => ({ ...l, path: pathOf(l) ?? "" })),
    width,
    height,
  };
}
