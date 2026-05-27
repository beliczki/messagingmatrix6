"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Position,
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

const COLUMN_WIDTH = 240;
const ROW_HEIGHT = 44;
const COLLAPSED_STORAGE_KEY = "mm6_tree_collapsed_v1";

// Hierarchical y-layout (tidy-tree, simple variant).
//
// Leaves get sequential y indices in DFS-discovery order; non-leaves get the
// midpoint of their visible children's y. That clusters every subtree
// vertically under its root and avoids the alphabetic-across-the-whole-column
// interleaving the v1 layout produced. Hidden subtrees (collapsed parents)
// contribute zero rows to the cursor, so collapsing shrinks the canvas.
function computeLayout(
  nodes: TreeNode[],
  collapsed: Set<string>,
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
    const isCollapsed = collapsed.has(id);
    const kids = isCollapsed ? [] : (childrenOf.get(id) ?? []);

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

function loadCollapsed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export default function TreeView({
  audiences,
  topics,
  messages,
  onOpenMessage,
}: {
  audiences: Audience[];
  topics: Topic[];
  messages: Message[];
  onOpenMessage: (id: number) => void;
}) {
  const treeStructureQ = useQuery({
    queryKey: ["config", "treeStructure"],
    queryFn: fetchTreeStructure,
  });

  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      COLLAPSED_STORAGE_KEY,
      JSON.stringify([...collapsed]),
    );
  }, [collapsed]);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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

  const childrenOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of tree.nodes) {
      if (n.parentId !== null) m.set(n.parentId, (m.get(n.parentId) ?? 0) + 1);
    }
    return m;
  }, [tree.nodes]);

  const { positions, visibleIds } = useMemo(
    () => computeLayout(tree.nodes, collapsed),
    [tree.nodes, collapsed],
  );

  const flowNodes = useMemo<Node[]>(
    () =>
      tree.nodes
        .filter((n) => visibleIds.has(n.id))
        .map((n) => {
          const pos = positions.get(n.id)!;
          const isLeaf = n.messageId !== undefined;
          const hasChildren = (childrenOf.get(n.id) ?? 0) > 0;
          const isCollapsed = collapsed.has(n.id);
          return {
            id: n.id,
            position: pos,
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
                      aria-label={isCollapsed ? "Expand" : "Collapse"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapsed(n.id);
                      }}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="size-3" />
                      ) : (
                        <ChevronDown className="size-3" />
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
            style: isLeaf ? { cursor: "pointer" } : undefined,
          };
        }),
    [tree.nodes, positions, visibleIds, collapsed, childrenOf, onOpenMessage, toggleCollapsed],
  );

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
    <div className="tree-view h-full w-full">
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
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
