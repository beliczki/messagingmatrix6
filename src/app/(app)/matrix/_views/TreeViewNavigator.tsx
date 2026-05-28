"use client";

import { useMemo } from "react";
import { MiniMap, useReactFlow, useStore } from "@xyflow/react";
import { Maximize, Minus, Plus } from "lucide-react";
import clsx from "clsx";
import { useIsDarkMode } from "./useIsDarkMode";

const SECTION_WIDTH = 232; // RightToolbar inner width when open (256 - px-3 * 2)
const MINIMAP_MIN_H = 90;
const MINIMAP_MAX_H = 180;

// Renders the tree view's MiniMap + zoom Controls inside the RightToolbar's
// NAVIGATOR section. Lives in the same ReactFlowProvider as the canvas
// (provider lifted to MatrixGrid) so it shares the xyflow store.
export default function TreeViewNavigator() {
  const isDark = useIsDarkMode();

  // Match minimap height to the visible-content aspect ratio so the rounded
  // box hugs the dots tightly instead of letterboxing. Width is fixed to the
  // toolbar column; height = width / aspect, clamped.
  const aspect = useStore((s) => {
    if (s.nodes.length === 0) return 4 / 3;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of s.nodes) {
      const w = n.width ?? n.measured?.width ?? 0;
      const h = n.height ?? n.measured?.height ?? 0;
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + w);
      maxY = Math.max(maxY, n.position.y + h);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return 4 / 3;
    }
    return w / h;
  });

  const minimapHeight = useMemo(
    () =>
      Math.max(
        MINIMAP_MIN_H,
        Math.min(MINIMAP_MAX_H, Math.round(SECTION_WIDTH / aspect)),
      ),
    [aspect],
  );

  return (
    <div className="tree-view-navigator flex flex-col gap-2">
      <div className="tree-view-navigator__label mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        Navigator
      </div>
      <div
        className="tree-view-navigator__minimap-wrap relative w-full"
        style={{ height: minimapHeight }}
      >
        <MiniMap
          pannable
          zoomable
          className="tree-view__minimap tree-view__minimap--docked"
          nodeColor={isDark ? "#cbd5e1" : "#0f172a"}
          nodeStrokeColor={isDark ? "#cbd5e1" : "#0f172a"}
          nodeStrokeWidth={2}
          nodeBorderRadius={1}
          maskColor={isDark ? "rgba(0, 0, 0, 0.5)" : "rgba(255, 255, 255, 0.5)"}
          maskStrokeColor={isDark ? "#64748b" : "#cbd5e1"}
          maskStrokeWidth={1}
        />
      </div>
      <TreeViewNavigatorControls orientation="horizontal" />
    </div>
  );
}

// Custom zoom/fit buttons. Replaces xyflow's default <Controls> so the
// styling matches the project's icon-button language and the same component
// can be rendered both inline (NAVIGATOR section, horizontal) and inside the
// collapsed RightToolbar rail (vertical).
export function TreeViewNavigatorControls({
  orientation,
}: {
  orientation: "horizontal" | "vertical";
}) {
  const rf = useReactFlow();
  return (
    <div
      className={clsx(
        "tree-view-navigator__controls flex gap-1",
        orientation === "vertical" ? "flex-col" : "flex-row",
      )}
    >
      <NavBtn
        onClick={() => rf.zoomIn({ duration: 150 })}
        title="Zoom in"
        ariaLabel="Zoom in"
      >
        <Plus className="size-4" />
      </NavBtn>
      <NavBtn
        onClick={() => rf.zoomOut({ duration: 150 })}
        title="Zoom out"
        ariaLabel="Zoom out"
      >
        <Minus className="size-4" />
      </NavBtn>
      <NavBtn
        onClick={() => rf.fitView({ duration: 200 })}
        title="Fit view"
        ariaLabel="Fit view"
      >
        <Maximize className="size-4" />
      </NavBtn>
    </div>
  );
}

function NavBtn({
  children,
  onClick,
  title,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className="tree-view-navigator__btn inline-flex size-8 items-center justify-center rounded text-slate-700 hover:bg-slate-100"
    >
      {children}
    </button>
  );
}
