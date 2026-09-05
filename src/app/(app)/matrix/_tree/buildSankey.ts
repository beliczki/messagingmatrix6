// Turns the TreeData the tree view already builds into a d3-sankey graph.
//
// The sankey is not a second data model — it is the same `treeStructure`
// hierarchy drawn with ribbons instead of boxes. Everything here operates on
// `buildTree()`'s output, so the two views can never disagree about what the
// structure is.
//
// Two things the tree does not need and the sankey does:
//   1. Folding. A Messages leaf level has thousands of nodes; a column of
//      thousands of 1px ribbons is not a diagram.
//   2. Absolute geometry. d3-sankey computes x0/x1/y0/y1 per node and a width
//      per link; we hand those coordinates to xyflow rather than letting xyflow
//      lay anything out.
//
// The folding rule is **per parent**, and that is the whole point. An earlier
// version capped each COLUMN at its top N, which broke the diagram's basic
// promise: a node you can see must be a node you can follow. With a column cap,
// a visible audience's every topic could lose the column-wide ranking to other
// audiences' topics and vanish into one shared Other — so hovering a node that
// is plainly on screen led into grey nothing. Per parent, a visible node always
// shows its own children, and only its own overflow folds into its own Other,
// which the user can expand.

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
  /** True for a synthetic fold node. */
  isOther: boolean;
  /** How many real groups this Other folds in. 0 on real nodes and on the
   *  pass-through Others that only carry a collapsed branch rightwards. */
  foldedGroups: number;
  statusCounts: Record<string, number>;
  messageId?: number;
  platform?: string;
  /** Set on a real node that has more children than the cap: clicking it shows
   *  all of them. Also set on its Other, pointing at the same parent, so the
   *  fold node is a shortcut for the same action. */
  expandTargetId?: string;
  /** Whether that target is currently expanded — drives the chevron. */
  isExpanded?: boolean;
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

/** The fold node that holds one parent's overflow. */
export function otherNodeId(parentId: string): string {
  return `other:${parentId}`;
}

function addStatusCounts(
  into: Record<string, number>,
  from: Record<string, number>,
): void {
  for (const [k, v] of Object.entries(from)) {
    into[k] = (into[k] ?? 0) + v;
  }
}

// Biggest first; ties (every message leaf has count 1) break on the label so the
// order is stable across renders.
function rank(a: TreeNode, b: TreeNode): number {
  return b.count - a.count || a.label.localeCompare(b.label);
}

function realDatum(n: TreeNode): SankeyNodeDatum {
  const d: SankeyNodeDatum = {
    id: n.id,
    label: n.label,
    level: n.level,
    count: n.count,
    isOther: false,
    foldedGroups: 0,
    statusCounts: n.statusCounts,
  };
  if (n.messageId !== undefined) d.messageId = n.messageId;
  if (n.platform !== undefined) d.platform = n.platform;
  return d;
}

/**
 * Folds each parent's children down to its `topN` largest.
 *
 * `expanded` holds the ids of parents the user opened; their children are all
 * shown. A parent whose overflow is a single node is never folded either —
 * "Other (1)" costs a row and says nothing.
 */
export function foldToTopN(
  tree: TreeData,
  topN: number,
  expanded: Set<string> = new Set(),
): { nodes: SankeyNodeDatum[]; links: SankeyLinkDatum[] } {
  if (tree.nodes.length === 0) return { nodes: [], links: [] };

  const maxLevel = tree.nodes.reduce((m, n) => Math.max(m, n.level), 0);
  const childrenOf = new Map<string, TreeNode[]>();
  const roots: TreeNode[] = [];
  for (const n of tree.nodes) {
    if (n.parentId === null) {
      roots.push(n);
    } else {
      const arr = childrenOf.get(n.parentId) ?? [];
      arr.push(n);
      childrenOf.set(n.parentId, arr);
    }
  }

  const nodes: SankeyNodeDatum[] = [];
  const datumById = new Map<string, SankeyNodeDatum>();
  // Keyed by the id pair so parallel edges collapse into one ribbon (several
  // folded children of the same parent share one ribbon to that parent's
  // Other). The endpoints live in the value, not parsed back out of the key —
  // node ids embed user-entered values and are not safe to split apart.
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

  function push(d: SankeyNodeDatum): SankeyNodeDatum {
    nodes.push(d);
    datumById.set(d.id, d);
    return d;
  }

  // The root column is never folded: there is no parent above it whose pill
  // could serve as the expand handle, and it is the diagram's entry point.
  let keptReal = [...roots].sort(rank);
  for (const n of keptReal) push(realDatum(n));
  // Fold nodes rendered at the previous level, which must carry their collapsed
  // branch onwards.
  let openOthers: SankeyNodeDatum[] = [];

  for (let level = 1; level <= maxLevel; level++) {
    const nextKept: TreeNode[] = [];
    const nextOthers: SankeyNodeDatum[] = [];

    for (const parent of keptReal) {
      const children = [...(childrenOf.get(parent.id) ?? [])].sort(rank);
      if (children.length === 0) continue;

      const isExpanded = expanded.has(parent.id);
      // Folding a single leftover would render "Other (1)" — a row that costs
      // as much as the node it hides.
      const overflows = children.length > topN + 1;
      const keepList = isExpanded || !overflows ? children : children.slice(0, topN);
      const foldList = isExpanded || !overflows ? [] : children.slice(topN);

      if (overflows) {
        const parentDatum = datumById.get(parent.id);
        if (parentDatum) {
          parentDatum.expandTargetId = parent.id;
          parentDatum.isExpanded = isExpanded;
        }
      }

      for (const c of keepList) {
        nextKept.push(c);
        push(realDatum(c));
        addFlow(parent.id, c.id, c.count);
      }

      if (foldList.length > 0) {
        const statusCounts: Record<string, number> = {};
        let count = 0;
        for (const c of foldList) {
          addStatusCounts(statusCounts, c.statusCounts);
          count += c.count;
          addFlow(parent.id, otherNodeId(parent.id), c.count);
        }
        nextOthers.push(
          push({
            id: otherNodeId(parent.id),
            label: `Other (${foldList.length})`,
            level,
            count,
            isOther: true,
            foldedGroups: foldList.length,
            statusCounts,
            expandTargetId: parent.id,
            isExpanded: false,
          }),
        );
      }
    }

    // A collapsed branch keeps flowing to the right edge instead of ending
    // mid-diagram: each Other continues into one Other of its own, carrying the
    // same mass. It is not expandable — the fold node that started the chain is.
    for (const o of openOthers) {
      const cont = push({
        id: otherNodeId(o.id),
        label: "Other",
        level,
        count: o.count,
        isOther: true,
        foldedGroups: 0,
        statusCounts: o.statusCounts,
      });
      nextOthers.push(cont);
      addFlow(o.id, cont.id, o.count);
    }

    keptReal = nextKept;
    openOthers = nextOthers;
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
