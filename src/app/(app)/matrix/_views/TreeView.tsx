"use client";

import { useMemo } from "react";
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
import { parseTreeStructure } from "../_tree/parseTreeStructure";
import { buildTree } from "../_tree/buildTree";
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
const ROW_HEIGHT = 56;

// Deterministic positions: each column packs its nodes top-to-bottom in the
// order produced by buildTree (which already sorts by label).
function layoutNodes(
  nodes: ReturnType<typeof buildTree>["nodes"],
  onOpenMessage: (id: number) => void,
): Node[] {
  const perColumn = new Map<number, number>();
  return nodes.map((n) => {
    const yIndex = perColumn.get(n.level) ?? 0;
    perColumn.set(n.level, yIndex + 1);
    const isLeaf = n.messageId !== undefined;
    return {
      id: n.id,
      position: { x: n.level * COLUMN_WIDTH, y: yIndex * ROW_HEIGHT },
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
            <span className="tree-view__node-label">{n.label}</span>
            {!isLeaf ? (
              <span className="tree-view__node-count">{n.count}</span>
            ) : null}
          </div>
        ),
      },
      // Default node type renders the label inside a box; we override its
      // padding via .react-flow__node-default override in CSS.
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: isLeaf
        ? { cursor: "pointer" }
        : undefined,
    };
  });
}

function layoutEdges(
  edges: ReturnType<typeof buildTree>["edges"],
): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "smoothstep",
  }));
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

  const flowNodes = useMemo(
    () => layoutNodes(tree.nodes, onOpenMessage),
    [tree.nodes, onOpenMessage],
  );
  const flowEdges = useMemo(() => layoutEdges(tree.edges), [tree.edges]);

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
