// Turns the TreeData the tree view already builds into a d3-sankey graph.
//
// The sankey is not a second data model — it is the same `treeStructure`
// hierarchy drawn with ribbons instead of boxes. Everything here operates on
// `buildTree()`'s output, so the two views can never disagree about what the
// structure is.
//
// Two things the tree does not need and the sankey does:
//   1. Top-N folding. A Messages leaf level has thousands of nodes; a column of
//      thousands of 1px ribbons is not a diagram. Everything past the top N in
//      a column folds into one "Other" node, and that node forwards its flow to
//      the next column's "Other" so the folded mass stays visible all the way to
//      the right edge instead of vanishing mid-diagram.
//   2. Absolute geometry. d3-sankey computes x0/x1/y0/y1 per node and a width
//      per link; we hand those coordinates to xyflow rather than letting xyflow
//      lay anything out.

import {
  sankey as d3Sankey,
  sankeyLeft,
  sankeyLinkHorizontal,
} from "d3-sankey";
import type { TreeData, TreeNode } from "./buildTree";

export type SankeyNodeDatum = {
  id: string;
  label: string;
  level: number;
  count: number;
  /** True for the synthetic per-column fold node. */
  isOther: boolean;
  /** How many real groups this Other node folds in. 0 on real nodes. */
  foldedGroups: number;
  statusCounts: Record<string, number>;
  messageId?: number;
  platform?: string;
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
// where one Other node holds 90% of the flow the other twenty are sub-pixel
// slivers. The padding therefore has to clear a label pill (~18px) on its own,
// or the labels sit on top of each other.
export const SANKEY_NODE_PADDING = 22;
/** Vertical room reserved per node: one padding gap plus room for the bar. */
const MIN_ROW_HEIGHT = 34;
const MIN_CANVAS_HEIGHT = 420;

export function otherNodeId(level: number): string {
  return `other:${level}`;
}

function addStatusCounts(
  into: Record<string, number>,
  from: Record<string, number>,
): void {
  for (const [k, v] of Object.entries(from)) {
    into[k] = (into[k] ?? 0) + v;
  }
}

/**
 * Folds each column down to its `topN` largest nodes.
 *
 * A node is only considered at all when its parent survived the fold — the
 * subtree under a folded node is not re-attached to the root, it flows through
 * the Other chain. That keeps every message accounted for exactly once at every
 * level, which is what makes the ribbon widths add up.
 */
export function foldToTopN(
  tree: TreeData,
  topN: number,
): { nodes: SankeyNodeDatum[]; links: SankeyLinkDatum[] } {
  if (tree.nodes.length === 0) return { nodes: [], links: [] };

  const maxLevel = tree.nodes.reduce((m, n) => Math.max(m, n.level), 0);
  const byLevel = new Map<number, TreeNode[]>();
  for (const n of tree.nodes) {
    const arr = byLevel.get(n.level) ?? [];
    arr.push(n);
    byLevel.set(n.level, arr);
  }

  const kept = new Set<string>();
  const nodes: SankeyNodeDatum[] = [];
  // Keyed by the id pair so parallel edges collapse into one ribbon (several
  // folded children of the same parent share one ribbon to Other). The endpoints
  // live in the value, not parsed back out of the key — node ids embed
  // user-entered values and are not safe to split apart.
  const flows = new Map<
    string,
    { source: string; target: string; value: number }
  >();

  function addFlow(source: string, target: string, value: number): void {
    const key = `${source}->${target}`;
    const prev = flows.get(key);
    if (prev) prev.value += value;
    else flows.set(key, { source, target, value });
  }

  // Flow arriving into this level's Other node from the previous level's.
  let carry = 0;
  let carryStatuses: Record<string, number> = {};

  for (let level = 0; level <= maxLevel; level++) {
    const all = byLevel.get(level) ?? [];
    const reachable =
      level === 0
        ? all
        : all.filter((n) => n.parentId !== null && kept.has(n.parentId));
    const ranked = [...reachable].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label),
    );
    const keepList = ranked.slice(0, topN);
    const foldList = ranked.slice(topN);

    for (const n of keepList) {
      kept.add(n.id);
      const datum: SankeyNodeDatum = {
        id: n.id,
        label: n.label,
        level,
        count: n.count,
        isOther: false,
        foldedGroups: 0,
        statusCounts: n.statusCounts,
      };
      if (n.messageId !== undefined) datum.messageId = n.messageId;
      if (n.platform !== undefined) datum.platform = n.platform;
      nodes.push(datum);
    }

    const foldedCount = foldList.reduce((s, n) => s + n.count, 0);
    const otherCount = foldedCount + carry;
    if (otherCount > 0) {
      const statusCounts: Record<string, number> = { ...carryStatuses };
      for (const n of foldList) addStatusCounts(statusCounts, n.statusCounts);
      nodes.push({
        id: otherNodeId(level),
        label: foldList.length > 0 ? `Other (${foldList.length})` : "Other",
        level,
        count: otherCount,
        isOther: true,
        foldedGroups: foldList.length,
        statusCounts,
      });
    }

    if (level > 0) {
      for (const n of reachable) {
        const target = kept.has(n.id) ? n.id : otherNodeId(level);
        addFlow(n.parentId as string, target, n.count);
      }
      if (carry > 0) {
        addFlow(otherNodeId(level - 1), otherNodeId(level), carry);
      }
    }

    if (level < maxLevel) {
      carry = otherCount;
      for (const n of foldList) addStatusCounts(carryStatuses, n.statusCounts);
    } else {
      carry = 0;
      carryStatuses = {};
    }
  }

  const links: SankeyLinkDatum[] = [...flows.entries()].map(
    ([id, { source, target, value }]) => ({ id, source, target, value }),
  );

  return { nodes, links };
}

/**
 * Runs the d3-sankey layout over a folded graph and attaches the ribbon path
 * for each link. `sankeyLeft` pins every node to its own tree level, which is
 * what we want — the columns ARE the structure levels, not a derived depth.
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
