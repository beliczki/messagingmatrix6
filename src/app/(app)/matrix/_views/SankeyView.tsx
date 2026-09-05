"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  Background,
  Handle,
  Position,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { parseTreeStructure } from "../_tree/parseTreeStructure";
import { buildTree } from "../_tree/buildTree";
import {
  foldToTopN,
  layoutSankey,
  SANKEY_NODE_WIDTH,
  type SankeyNodeDatum,
} from "../_tree/buildSankey";
import {
  platformToken,
  STATUS_COLOR,
  type Audience,
  type Message,
  type Topic,
} from "../types";
import { useIsDarkMode } from "./useIsDarkMode";

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

// How many children ONE parent shows before its overflow folds into its own
// "Other". Per parent, not per column: a node you can see must be a node you can
// follow (see the note at the top of buildSankey.ts).
const TOP_N_PER_PARENT = 10;
const EXPANDED_STORAGE_KEY = "mm6_sankey_expanded_v1";
// Width declared to xyflow per node: the bar plus the label pill. It is what
// fitView measures, so labels stay inside the fitted viewport. Only the bar and
// the pill take pointer events — the rest of the box lets ribbons through.
const NODE_BOX_WIDTH = SANKEY_NODE_WIDTH + 6 + 190;
// A node carrying a single message is a sub-pixel sliver at real scale; give
// every node a floor so it stays hoverable.
const MIN_BAR_HEIGHT = 3;
// Same cycle length as the tree's level stripes (.sankey-view__*--lvl-0..5).
const LEVEL_COLOR_CYCLE = 6;
// Room the tooltip needs, so it can be kept inside the canvas near an edge.
// Matches the max-width in globals.css plus the offset it is drawn at.
const TOOLTIP_W = 274;
const TOOLTIP_H = 120;

function loadExpanded(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(
      Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function idOf(x: string | SankeyNodeDatum): string {
  return typeof x === "string" ? x : x.id;
}

type HoverTarget = { kind: "node" | "link"; id: string } | null;

type Highlight = { nodes: Set<string>; links: Set<string> } | null;

/** Where the tooltip goes: the hover event carries its own coordinates rather
 *  than the view sampling the last mousemove — `mouseover` fires BEFORE the
 *  `mousemove` at the same position, so a sampled position is always one move
 *  stale, and on the first hover after mount there is nothing sampled at all. */
type HoverAt = { clientX: number; clientY: number };

const HighlightContext = createContext<{
  highlight: Highlight;
  setHover: (t: HoverTarget, at: HoverAt) => void;
}>({ highlight: null, setHover: () => {} });

type SankeyNodeData = {
  label: string;
  count: number;
  messageId?: number;
  expandTargetId?: string;
  isExpanded?: boolean;
  onOpenMessage: (id: number) => void;
  onToggleExpand: (parentId: string) => void;
};

type SankeyEdgeData = {
  path: string;
  ribbonWidth: number;
  level: number;
  neutral: boolean;
};

function SankeyNodeBox({ id, data }: NodeProps) {
  const d = data as unknown as SankeyNodeData;
  const { highlight, setHover } = useContext(HighlightContext);
  const dimmed = highlight !== null && !highlight.nodes.has(id);
  const isLeaf = d.messageId !== undefined;
  const expandTarget = d.expandTargetId;
  const clickable = isLeaf || expandTarget !== undefined;

  // A leaf opens its MC; anything else that is clickable is a fold handle —
  // either the parent whose children overflow, or that parent's Other, which is
  // a shortcut for the same toggle.
  function activate() {
    if (isLeaf) d.onOpenMessage(d.messageId as number);
    else if (expandTarget !== undefined) d.onToggleExpand(expandTarget);
  }

  return (
    <div
      className={clsx(
        "sankey-view__node",
        dimmed && "sankey-view__node--dim",
        isLeaf && "sankey-view__node--leaf",
        expandTarget !== undefined && "sankey-view__node--expandable",
      )}
      onMouseEnter={(e) => setHover({ kind: "node", id }, e)}
      onMouseLeave={(e) => setHover(null, e)}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="sankey-view__handle"
      />
      <span className="sankey-view__bar" />
      <span
        className="sankey-view__pill"
        title={
          expandTarget !== undefined
            ? `${d.label} — ${d.count} · click to ${d.isExpanded ? "collapse" : "show all"}`
            : `${d.label} — ${d.count}`
        }
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? activate : undefined}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  activate();
                }
              }
            : undefined
        }
      >
        {expandTarget !== undefined ? (
          <span className="sankey-view__chevron" aria-hidden>
            {d.isExpanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </span>
        ) : null}
        <span className="sankey-view__label">{d.label}</span>
        <span className="sankey-view__count">{d.count}</span>
      </span>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="sankey-view__handle"
      />
    </div>
  );
}

function SankeyRibbon({ id, data }: EdgeProps) {
  const d = data as unknown as SankeyEdgeData;
  const { highlight, setHover } = useContext(HighlightContext);
  const dimmed = highlight !== null && !highlight.links.has(id);

  return (
    <g className="sankey-view__ribbon-group">
      <path
        d={d.path}
        strokeWidth={d.ribbonWidth}
        className={clsx(
          "sankey-view__ribbon",
          d.neutral
            ? "sankey-view__ribbon--other"
            : `sankey-view__ribbon--lvl-${d.level % LEVEL_COLOR_CYCLE}`,
          dimmed && "sankey-view__ribbon--dim",
          highlight !== null && !dimmed && "sankey-view__ribbon--on",
        )}
      />
      {/* Invisible fat stroke so a 1px ribbon is still hoverable. */}
      <path
        d={d.path}
        strokeWidth={Math.max(d.ribbonWidth, 8)}
        className="sankey-view__ribbon-hit"
        onMouseEnter={(e) => setHover({ kind: "link", id }, e)}
        onMouseLeave={(e) => setHover(null, e)}
      />
    </g>
  );
}

const nodeTypes = { sankeyNode: SankeyNodeBox };
const edgeTypes = { sankeyRibbon: SankeyRibbon };

type SankeyViewProps = {
  audiences: Audience[];
  topics: Topic[];
  messages: Message[];
  onOpenMessage: (id: number) => void;
};

// The sankey shares the ReactFlowProvider that MatrixGrid puts around the whole
// matrix, so the RightToolbar's NAVIGATOR section (MiniMap + zoom Controls)
// drives this canvas exactly as it drives the tree's.
export default function SankeyView({
  audiences,
  topics,
  messages,
  onOpenMessage,
}: SankeyViewProps) {
  const isDark = useIsDarkMode();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHoverState] = useState<HoverTarget>(null);
  const [tooltipAt, setTooltipAt] = useState({ x: 0, y: 0 });
  // Parents the user opened. Persisted like the tree's expanded set, so a
  // branch you drilled into is still open when you come back.
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);

  const toggleExpand = useCallback((parentId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      try {
        window.localStorage.setItem(
          EXPANDED_STORAGE_KEY,
          JSON.stringify([...next]),
        );
      } catch {}
      return next;
    });
  }, []);

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

  const graph = useMemo(() => {
    const tree = buildTree(
      { auds: audiences, tops: topics, msgs: messages },
      parsed.levels,
    );
    const folded = foldToTopN(tree, TOP_N_PER_PARENT, expanded);
    return layoutSankey(folded.nodes, folded.links);
  }, [audiences, topics, messages, parsed.levels, expanded]);

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph.nodes],
  );

  // Adjacency for the path highlight. Both directions, keyed by node id.
  const { inLinks, outLinks } = useMemo(() => {
    const inl = new Map<string, Array<{ id: string; other: string }>>();
    const outl = new Map<string, Array<{ id: string; other: string }>>();
    for (const l of graph.links) {
      const s = idOf(l.source);
      const t = idOf(l.target);
      const outArr = outl.get(s) ?? [];
      outArr.push({ id: l.id, other: t });
      outl.set(s, outArr);
      const inArr = inl.get(t) ?? [];
      inArr.push({ id: l.id, other: s });
      inl.set(t, inArr);
    }
    return { inLinks: inl, outLinks: outl };
  }, [graph.links]);

  // Hovering anything lights the WHOLE route it sits on — every ancestor and
  // every descendant — not just the neighbouring edge. That is the one thing a
  // sankey is read for: where does this slice come from and where does it go.
  const highlight = useMemo<Highlight>(() => {
    if (hover === null) return null;
    const nodes = new Set<string>();
    const links = new Set<string>();

    function walkUp(start: string) {
      const stack = [start];
      while (stack.length > 0) {
        const cur = stack.pop() as string;
        for (const e of inLinks.get(cur) ?? []) {
          if (links.has(e.id)) continue;
          links.add(e.id);
          nodes.add(e.other);
          stack.push(e.other);
        }
      }
    }
    function walkDown(start: string) {
      const stack = [start];
      while (stack.length > 0) {
        const cur = stack.pop() as string;
        for (const e of outLinks.get(cur) ?? []) {
          if (links.has(e.id)) continue;
          links.add(e.id);
          nodes.add(e.other);
          stack.push(e.other);
        }
      }
    }

    if (hover.kind === "node") {
      nodes.add(hover.id);
      walkUp(hover.id);
      walkDown(hover.id);
    } else {
      const link = graph.links.find((l) => l.id === hover.id);
      if (!link) return null;
      const s = idOf(link.source);
      const t = idOf(link.target);
      links.add(link.id);
      nodes.add(s);
      nodes.add(t);
      walkUp(s);
      walkDown(t);
    }
    return { nodes, links };
  }, [hover, inLinks, outLinks, graph.links]);

  const setHover = useCallback((t: HoverTarget, at: HoverAt) => {
    if (t !== null) {
      const box = containerRef.current?.getBoundingClientRect();
      // Keep the whole box on the canvas — near the right or bottom edge an
      // unclamped offset would push it out of view.
      const x = at.clientX - (box?.left ?? 0);
      const y = at.clientY - (box?.top ?? 0);
      setTooltipAt({
        x: Math.max(0, Math.min(x, (box?.width ?? x) - TOOLTIP_W)),
        y: Math.max(0, Math.min(y, (box?.height ?? y) - TOOLTIP_H)),
      });
    }
    setHoverState(t);
  }, []);

  const highlightCtx = useMemo(
    () => ({ highlight, setHover }),
    [highlight, setHover],
  );

  const rfNodes = useMemo<Node[]>(
    () =>
      graph.nodes.map((n) => {
        // Platform colour wins over the depth colour when the whole subtree
        // shares one recognised buying platform — the same encoding the tree
        // node stripe and the matrix audience header use.
        const plat = platformToken(n.platform);
        const stripe = n.isOther
          ? "sankey-view__node-wrap--other"
          : plat
            ? `sankey-view__node-wrap--plat-${plat}`
            : `sankey-view__node-wrap--lvl-${n.level % LEVEL_COLOR_CYCLE}`;
        const data: SankeyNodeData = {
          label: n.label,
          count: n.count,
          onOpenMessage,
          onToggleExpand: toggleExpand,
        };
        if (n.messageId !== undefined) data.messageId = n.messageId;
        if (n.expandTargetId !== undefined) {
          data.expandTargetId = n.expandTargetId;
          data.isExpanded = n.isExpanded ?? false;
        }
        return {
          id: n.id,
          type: "sankeyNode",
          position: { x: n.x0 ?? 0, y: n.y0 ?? 0 },
          width: NODE_BOX_WIDTH,
          height: Math.max(MIN_BAR_HEIGHT, (n.y1 ?? 0) - (n.y0 ?? 0)),
          draggable: false,
          selectable: false,
          className: `sankey-view__node-wrap ${stripe}`,
          data: data as unknown as Record<string, unknown>,
        };
      }),
    [graph.nodes, onOpenMessage, toggleExpand],
  );

  const rfEdges = useMemo<Edge[]>(
    () =>
      graph.links.map((l) => {
        const source = idOf(l.source);
        const target = idOf(l.target);
        const sourceNode = nodeById.get(source);
        const targetNode = nodeById.get(target);
        const data: SankeyEdgeData = {
          path: l.path,
          ribbonWidth: Math.max(1, l.width ?? 1),
          level: sourceNode?.level ?? 0,
          // The folded branch is deliberately neutral grey: it must be visible
          // as mass without competing with the named groups for attention.
          neutral: (sourceNode?.isOther || targetNode?.isOther) ?? false,
        };
        return {
          id: l.id,
          source,
          target,
          type: "sankeyRibbon",
          data: data as unknown as Record<string, unknown>,
        };
      }),
    [graph.links, nodeById],
  );

  const tooltip = useMemo(() => {
    if (hover === null) return null;
    if (hover.kind === "node") {
      const n = nodeById.get(hover.id);
      if (!n) return null;
      return { title: n.label, value: n.count, statuses: n.statusCounts };
    }
    const l = graph.links.find((x) => x.id === hover.id);
    if (!l) return null;
    const s = nodeById.get(idOf(l.source));
    const t = nodeById.get(idOf(l.target));
    return {
      title: `${s?.label ?? "?"} → ${t?.label ?? "?"}`,
      value: l.value,
      statuses: null,
    };
  }, [hover, nodeById, graph.links]);

  if (treeStructureQ.isLoading) {
    return (
      <div className="sankey-view sankey-view--loading flex h-full items-center justify-center text-sm text-slate-500">
        Loading sankey…
      </div>
    );
  }

  if (parsed.error) {
    return (
      <div className="sankey-view sankey-view--error flex h-full items-center justify-center p-8">
        <div className="empty-state max-w-md rounded-xl border border-dashed border-rose-300 bg-white p-8 text-center">
          <h2 className="empty-state__title text-base font-semibold text-rose-700">
            Invalid tree structure
          </h2>
          <p className="empty-state__hint mt-2 text-sm text-slate-600">
            {parsed.error}
          </p>
          <p className="empty-state__hint mt-3 text-xs text-slate-500">
            The sankey reads the same string as the tree. Edit it in{" "}
            <strong>Settings → Structure → Decision tree structure</strong>.
          </p>
        </div>
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="sankey-view sankey-view--empty flex h-full items-center justify-center p-8">
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
    <div className="sankey-view relative h-full w-full" ref={containerRef}>
      <HighlightContext.Provider value={highlightCtx}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          minZoom={0.05}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          colorMode={isDark ? "dark" : "light"}
        >
          <Background gap={16} size={1} />
        </ReactFlow>
      </HighlightContext.Provider>

      {tooltip ? (
        <div
          className="sankey-view__tooltip"
          style={{ left: tooltipAt.x + 14, top: tooltipAt.y + 14 }}
        >
          <div className="sankey-view__tooltip-title">{tooltip.title}</div>
          <div className="sankey-view__tooltip-value">
            {tooltip.value} message{tooltip.value === 1 ? "" : "s"}
          </div>
          {tooltip.statuses
            ? Object.entries(tooltip.statuses)
                .sort((a, b) => b[1] - a[1])
                .map(([status, n]) => (
                  <div key={status} className="sankey-view__tooltip-status">
                    <span
                      className={clsx("status-dot", STATUS_COLOR[status])}
                      aria-hidden
                    />
                    <span className="sankey-view__tooltip-status-name">
                      {status}
                    </span>
                    <span className="sankey-view__tooltip-status-count">
                      {n}
                    </span>
                  </div>
                ))
            : null}
        </div>
      ) : null}
    </div>
  );
}
