"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Position,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronDown } from "lucide-react";
import { parseTreeStructure } from "../_tree/parseTreeStructure";
import { buildTree, type TreeNode } from "../_tree/buildTree";
import type { Audience, Message, Topic } from "../types";

type ConfigRow = { key: string; value: unknown };

async function fetchTreeStructure(): Promise<string> {
  const r = await fetch("/api/config?key=treeStructure", {
    credentials: "include",
  });
  if (!r.ok) return "";
  const data = (await r.json()) as { rows: ConfigRow[] };
  const v = data.rows[0]?.value;
  return typeof v === "string" ? v : "";
}

const COLUMN_WIDTH = 280;
const ROW_HEIGHT = 44;
const EXPANDED_STORAGE_KEY = "mm6_tree_expanded_v2";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 32;
// Number of distinct level-colour classes defined in globals.css
// (.tree-view__node-wrap--lvl-0 .. lvl-5). Deeper custom trees cycle past
// this count.
const LEVEL_COLOR_CYCLE = 6;
function levelOf(nodeId: string): number {
  return Number.parseInt(nodeId.split(":")[0] ?? "0", 10);
}

// Hierarchical y-layout (tidy-tree, simple variant).
//
// Leaves get sequential y indices in DFS-discovery order; non-leaves get the
// midpoint of their visible children's y. That clusters every subtree
// vertically under its root and avoids the alphabetic-across-the-whole-column
// interleaving the v1 layout produced. Subtrees of non-expanded parents
// contribute zero rows to the cursor, so collapsing shrinks the canvas.
function computeLayout(
  nodes: TreeNode[],
  expanded: Set<string>,
): { positions: Map<string, { x: number; y: number }>; visibleIds: Set<string> } {
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId !== null) {
      const arr = childrenOf.get(n.parentId) ?? [];
      arr.push(n.id);
      childrenOf.set(n.parentId, arr);
    }
  }

  const visibleIds = new Set<string>();
  const positions = new Map<string, { x: number; y: number }>();
  const byId = new Map(nodes.map((n) => [n.id, n]));

  let yCursor = 0;
  function place(id: string): number {
    visibleIds.add(id);
    const node = byId.get(id)!;
    const isExpanded = expanded.has(id);
    const kids = isExpanded ? (childrenOf.get(id) ?? []) : [];

    let yRow: number;
    if (kids.length === 0) {
      yRow = yCursor;
      yCursor += 1;
    } else {
      const childYs = kids.map((k) => place(k));
      yRow = (childYs[0] + childYs[childYs.length - 1]) / 2;
    }
    positions.set(id, {
      x: node.level * COLUMN_WIDTH,
      y: yRow * ROW_HEIGHT,
    });
    return yRow;
  }

  const roots = nodes.filter((n) => n.parentId === null);
  for (const r of roots) place(r.id);

  return { positions, visibleIds };
}

function loadExpanded(): Set<string> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch {
    return null;
  }
}

// Default expanded set: only the root (level-0) nodes are expanded, so the
// canvas starts showing Product → Strategy and everything past Strategy is
// collapsed until the user clicks a chevron.
function defaultExpanded(nodes: TreeNode[]): Set<string> {
  return new Set(nodes.filter((n) => n.level === 0).map((n) => n.id));
}

type TreeViewProps = {
  audiences: Audience[];
  topics: Topic[];
  messages: Message[];
  onOpenMessage: (id: number) => void;
};

export default function TreeView(props: TreeViewProps) {
  // ReactFlowProvider lets the inner component reach into the xyflow store
  // via useReactFlow() — needed for the "keep the clicked node anchored
  // under the cursor" viewport pan when expanding/collapsing.
  return (
    <ReactFlowProvider>
      <TreeViewInner {...props} />
    </ReactFlowProvider>
  );
}

function TreeViewInner({
  audiences,
  topics,
  messages,
  onOpenMessage,
}: TreeViewProps) {
  const rf = useReactFlow();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const treeStructureQ = useQuery({
    queryKey: ["config", "treeStructure"],
    queryFn: fetchTreeStructure,
  });

  // null means "no user preference yet → fall back to defaultExpanded()".
  // Once the user toggles anything we materialise it into a concrete Set.
  const [expanded, setExpanded] = useState<Set<string> | null>(() => loadExpanded());

  const parsed = useMemo(() => {
    const raw = treeStructureQ.data ?? "";
    try {
      return { levels: parseTreeStructure(raw), error: null as string | null };
    } catch (e) {
      return { levels: [], error: (e as Error).message };
    }
  }, [treeStructureQ.data]);

  const tree = useMemo(
    () =>
      buildTree(
        { auds: audiences, tops: topics, msgs: messages },
        parsed.levels,
      ),
    [audiences, topics, messages, parsed.levels],
  );

  const effectiveExpanded = useMemo(
    () => expanded ?? defaultExpanded(tree.nodes),
    [expanded, tree.nodes],
  );

  // Persist whenever the user actually has an explicit preference; never
  // persist the synthesised default (otherwise navigating away and back would
  // freeze the default snapshot into localStorage and stop adapting as new
  // products appear in the data).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (expanded === null) return;
    window.localStorage.setItem(
      EXPANDED_STORAGE_KEY,
      JSON.stringify([...expanded]),
    );
  }, [expanded]);

  const childrenOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of tree.nodes) {
      if (n.parentId !== null) m.set(n.parentId, (m.get(n.parentId) ?? 0) + 1);
    }
    return m;
  }, [tree.nodes]);

  const { positions, visibleIds } = useMemo(
    () => computeLayout(tree.nodes, effectiveExpanded),
    [tree.nodes, effectiveExpanded],
  );

  // Toggling an expand state re-runs the tidy-tree layout, which usually
  // moves the clicked node — its new y is the midpoint of the children that
  // just appeared (or of nothing, if it just collapsed). Counter-pan the
  // viewport by the same delta so the node stays under the cursor.
  const toggleExpanded = useCallback(
    (id: string) => {
      const base =
        expanded !== null ? new Set(expanded) : defaultExpanded(tree.nodes);
      if (base.has(id)) base.delete(id);
      else base.add(id);

      const oldY = positions.get(id)?.y;
      const { positions: nextPositions } = computeLayout(tree.nodes, base);
      const newY = nextPositions.get(id)?.y;

      if (
        oldY !== undefined &&
        newY !== undefined &&
        Math.abs(newY - oldY) > 0.001
      ) {
        const vp = rf.getViewport();
        rf.setViewport({ ...vp, y: vp.y - (newY - oldY) * vp.zoom });
      }

      setExpanded(base);
    },
    [expanded, positions, tree.nodes, rf],
  );

  const flowNodes = useMemo<Node[]>(
    () =>
      tree.nodes
        .filter((n) => visibleIds.has(n.id))
        .map((n) => {
          const pos = positions.get(n.id)!;
          const isLeaf = n.messageId !== undefined;
          const hasChildren = (childrenOf.get(n.id) ?? 0) > 0;
          const isExpanded = effectiveExpanded.has(n.id);
          const lvl = levelOf(n.id) % LEVEL_COLOR_CYCLE;
          return {
            id: n.id,
            position: pos,
            // Explicit width/height so the MiniMap has dimensions on the very
            // first render (without these it has to wait for ResizeObserver to
            // measure the DOM, and the thumbnail starts empty).
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            className: `tree-view__node-wrap tree-view__node-wrap--lvl-${lvl}${
              isLeaf ? " tree-view__node-wrap--leaf" : ""
            }`,
            data: {
              label: (
                <div
                  className={
                    isLeaf
                      ? "tree-view__node tree-view__node--leaf"
                      : "tree-view__node"
                  }
                  onClick={
                    isLeaf && n.messageId !== undefined
                      ? () => onOpenMessage(n.messageId!)
                      : undefined
                  }
                  role={isLeaf ? "button" : undefined}
                  tabIndex={isLeaf ? 0 : undefined}
                  onKeyDown={
                    isLeaf && n.messageId !== undefined
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onOpenMessage(n.messageId!);
                          }
                        }
                      : undefined
                  }
                >
                  {hasChildren ? (
                    <button
                      type="button"
                      className="tree-view__chevron"
                      aria-label={isExpanded ? "Collapse" : "Expand"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(n.id);
                      }}
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-3" />
                      ) : (
                        <ChevronRight className="size-3" />
                      )}
                    </button>
                  ) : null}
                  <span className="tree-view__node-label">{n.label}</span>
                  {!isLeaf ? (
                    <span className="tree-view__node-count">{n.count}</span>
                  ) : null}
                </div>
              ),
            },
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
          };
        }),
    [tree.nodes, positions, visibleIds, effectiveExpanded, childrenOf, onOpenMessage, toggleExpanded],
  );

  // Match the minimap container's aspect ratio to the visible content so the
  // rounded-border box wraps the dots tightly instead of leaving a wide
  // letterbox of empty space. Capped at MINIMAP_MAX on the longer axis;
  // the shorter axis scales proportionally.
  const minimapSize = useMemo(() => {
    const MINIMAP_MAX = 180;
    const MINIMAP_MIN = 90;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [id, pos] of positions) {
      if (!visibleIds.has(id)) continue;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + NODE_WIDTH);
      maxY = Math.max(maxY, pos.y + NODE_HEIGHT);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return { width: 160, height: 120 };
    }
    const aspect = w / h;
    if (aspect >= 1) {
      const width = MINIMAP_MAX;
      const height = Math.max(MINIMAP_MIN, Math.round(width / aspect));
      return { width, height };
    }
    const height = MINIMAP_MAX;
    const width = Math.max(MINIMAP_MIN, Math.round(height * aspect));
    return { width, height };
  }, [positions, visibleIds]);

  const flowEdges = useMemo<Edge[]>(
    () =>
      tree.edges
        .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: "smoothstep",
        })),
    [tree.edges, visibleIds],
  );

  if (treeStructureQ.isLoading) {
    return (
      <div className="tree-view tree-view--loading flex h-full items-center justify-center text-sm text-slate-500">
        Loading tree…
      </div>
    );
  }

  if (parsed.error) {
    return (
      <div className="tree-view tree-view--error flex h-full items-center justify-center p-8">
        <div className="empty-state max-w-md rounded-xl border border-dashed border-rose-300 bg-white p-8 text-center">
          <h2 className="empty-state__title text-base font-semibold text-rose-700">
            Invalid tree structure
          </h2>
          <p className="empty-state__hint mt-2 text-sm text-slate-600">
            {parsed.error}
          </p>
          <p className="empty-state__hint mt-3 text-xs text-slate-500">
            Edit the string in <strong>Settings → Structure → Decision tree
            structure</strong>.
          </p>
        </div>
      </div>
    );
  }

  if (tree.nodes.length === 0) {
    return (
      <div className="tree-view tree-view--empty flex h-full items-center justify-center p-8">
        <div className="empty-state max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="empty-state__title text-base font-semibold text-slate-900">
            Nothing to show
          </h2>
          <p className="empty-state__hint mt-1 text-sm text-slate-500">
            No messages match the current filter, or the tree structure is
            empty.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="tree-view h-full w-full" ref={containerRef}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <MiniMap
          position="top-right"
          pannable
          zoomable
          className="tree-view__minimap"
          style={{ width: minimapSize.width, height: minimapSize.height }}
          nodeColor="#0f172a"
          nodeStrokeColor="#0f172a"
          nodeStrokeWidth={2}
          nodeBorderRadius={1}
          maskColor="rgba(15, 23, 42, 0.18)"
          maskStrokeColor="#0f172a"
          maskStrokeWidth={1.5}
        />
        <Controls
          position="top-right"
          showInteractive={false}
          className="tree-view__controls"
          style={{ top: minimapSize.height + 20 }}
        />
      </ReactFlow>
    </div>
  );
}
