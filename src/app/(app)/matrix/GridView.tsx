"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Copy, GripHorizontal, GripVertical, Plus } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  type Audience,
  type Density,
  type Message,
  type Topic,
  STATUS_COLOR,
} from "./types";
import { type EditApi } from "./MatrixGrid";
import { useLongPress } from "@/app/_components/useLongPress";

// Coloured edge badge on audience headers (globals.css matrix-grid__header--*
// classes): width encodes the strategy (pro 3px / rem 5px), color the buying
// platform (dv360 dark green / adform teal). The edge follows the layout — the
// bottom when audiences are columns, the right when they are rows (transposed),
// so the strip always sits against the cells. Both fields must be set — channel
// (nonDCO) audiences carry neither and stay plain.
function audienceEdgeClasses(
  a: Audience,
  edge: "bottom" | "right" = "bottom",
): string | null {
  const s = edge === "right" ? "-r" : "";
  const strat =
    a.strategy === "pro"
      ? `matrix-grid__header--strat-pro${s}`
      : a.strategy === "rem"
        ? `matrix-grid__header--strat-rem${s}`
        : null;
  const plat =
    a.buyingPlatform === "dv360"
      ? `matrix-grid__header--plat-dv360${s}`
      : a.buyingPlatform === "adform"
        ? `matrix-grid__header--plat-adform${s}`
        : null;
  return strat && plat ? `${strat} ${plat}` : null;
}

export default function GridView({
  audiences,
  topics,
  messages,
  density,
  transposed,
  setTransposed,
  hideInactive,
  setHideInactive,
  topicReorderable,
  onReorder,
  onOpenMessage,
  onOpenHeader,
  editApi,
  onDndDrop,
  onDuplicateHeader,
  onAddHeader,
  onCreateInCell,
}: {
  audiences: Audience[];
  topics: Topic[];
  messages: Message[];
  density: Density;
  transposed: boolean;
  setTransposed: (v: boolean) => void;
  hideInactive: boolean;
  setHideInactive: (v: boolean) => void;
  topicReorderable: boolean;
  onReorder: (kind: "audience" | "topic", ids: number[]) => void;
  onOpenMessage: (id: number) => void;
  onOpenHeader: (kind: "audience" | "topic", key: string) => void;
  editApi: EditApi;
  onDndDrop: (args: {
    draggedId: number;
    targetAudience: string;
    targetTopic: string;
    copy: boolean;
  }) => void;
  onDuplicateHeader: (kind: "audience" | "topic", id: number) => void;
  onAddHeader: (kind: "audience" | "topic") => void;
  onCreateInCell: (audience: string, topic: string) => void;
}) {
  const editMode = editApi.editMode;

  const cells = useMemo(() => {
    const m = new Map<string, Message[]>();
    for (const msg of messages) {
      const key = `${msg.audience}\0${msg.topic}`;
      const arr = m.get(key);
      if (arr) arr.push(msg);
      else m.set(key, [msg]);
    }
    return m;
  }, [messages]);

  const messageById = useMemo(() => {
    const m = new Map<number, Message>();
    for (const msg of messages) m.set(msg.id, msg);
    return m;
  }, [messages]);

  // DnD plumbing — always declared (hooks rule), but the DndContext + per-cell
  // useDroppable / per-chip useDraggable are only mounted when editMode is on.
  // With 13k+ cells, registering even a disabled droppable per cell freezes the
  // page; gating mount on editMode is the only way to keep non-edit-mode fast.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const [dragState, setDragState] = useState<{
    draggedId: number;
    ids: number[];
  } | null>(null);
  // Header-reorder drag (edit mode): a `ro:<kind>:<id>` grip handle is dragged
  // onto another header's `rod:<kind>:<id>` drop zone. Kept separate from the
  // MC-chip dragState so the two flows never cross.
  const [reorderState, setReorderState] = useState<{
    kind: "audience" | "topic";
    id: number;
    label: string;
  } | null>(null);

  const onDragStart = useCallback(
    (e: DragStartEvent) => {
      const idStr = String(e.active.id);
      if (idStr.startsWith("mc:")) {
        const draggedId = Number(idStr.slice(3));
        const ids = editApi.selection.mcIds.has(draggedId)
          ? [...editApi.selection.mcIds]
          : [draggedId];
        setDragState({ draggedId, ids });
        return;
      }
      if (idStr.startsWith("ro:")) {
        const [, kind, idS] = idStr.split(":");
        setReorderState({
          kind: kind as "audience" | "topic",
          id: Number(idS),
          label: String(e.active.data.current?.label ?? ""),
        });
      }
    },
    [editApi.selection.mcIds],
  );

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const ro = reorderState;
      const state = dragState;
      setReorderState(null);
      setDragState(null);
      if (!e.over) return;
      const overId = String(e.over.id);
      // Header reorder: splice the dragged header to the target's position
      // within the visible id list of that dimension, then persist.
      if (ro && overId.startsWith("rod:")) {
        const [, kind, targetS] = overId.split(":");
        const targetId = Number(targetS);
        if (kind !== ro.kind || targetId === ro.id) return;
        const list = kind === "audience" ? audiences : topics;
        const ids = list.map((x) => x.id);
        const from = ids.indexOf(ro.id);
        const to = ids.indexOf(targetId);
        if (from < 0 || to < 0) return;
        ids.splice(from, 1);
        ids.splice(to, 0, ro.id);
        onReorder(kind as "audience" | "topic", ids);
        return;
      }
      if (!state || !overId.startsWith("cell:")) return;
      const [aud, top] = overId.slice(5).split("\0");
      if (!aud || !top) return;
      const activator = e.activatorEvent as MouseEvent | KeyboardEvent | null;
      const copy =
        !!activator &&
        ((activator as MouseEvent).ctrlKey || (activator as MouseEvent).metaKey);
      onDndDrop({
        draggedId: state.draggedId,
        targetAudience: aud,
        targetTopic: top,
        copy,
      });
    },
    [dragState, reorderState, audiences, topics, onDndDrop, onReorder],
  );

  const pending = editApi.pendingAction;
  const sourceAudiences = useMemo(() => {
    const s = new Set<string>();
    for (const id of editApi.selection.mcIds) {
      const m = messageById.get(id);
      if (m) s.add(m.audience);
    }
    return s;
  }, [editApi.selection.mcIds, messageById]);

  if (audiences.length === 0 || topics.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        Add at least one audience and one topic to populate the grid.
      </div>
    );
  }

  const rows = transposed ? topics : audiences;
  const cols = transposed ? audiences : topics;
  const rowLabel = transposed ? "Topic" : "Audience";
  const colLabel = transposed ? "Audience" : "Topic";
  const rowKind: "audience" | "topic" = transposed ? "topic" : "audience";
  const colKind: "audience" | "topic" = transposed ? "audience" : "topic";

  // For the toolbar Copy/Move flow we need to highlight columns whose dimension
  // matches "audience". When transposed=true (default), columns are audiences.
  // When transposed=false, columns are topics and there is no audience target
  // picker on column headers — the picker becomes inert for that orientation.
  const colsAreAudiences = transposed;

  const dragOverlay =
    editMode && dragState ? (
      <div className="mc-chip mc-chip--ghost mc-chip--selected pointer-events-none flex items-center gap-1 rounded border-2 border-dashed border-slate-700 bg-slate-100/90 px-1.5 py-1 text-xs">
        <span className="font-mono">
          {(() => {
            const m = messageById.get(dragState.draggedId);
            return m ? `MC${m.number}${m.variant}` : "MC";
          })()}
        </span>
        {dragState.ids.length > 1 ? (
          <span className="rounded-full bg-slate-900 px-1.5 text-[10px] font-semibold text-white">
            {dragState.ids.length}
          </span>
        ) : null}
      </div>
    ) : editMode && reorderState ? (
      <div className="matrix-grid__reorder-overlay pointer-events-none flex items-center gap-1 rounded border-2 border-dashed border-sky-500 bg-white/90 px-2 py-1 text-xs font-semibold text-text-primary shadow dark:bg-slate-800/90">
        <GripHorizontal className="size-3 text-text-tertiary" />
        {reorderState.label || "Reorder"}
      </div>
    ) : null;

  // Audience headers always carry a real orderIndex; topic headers only in DCO
  // (nonDCO topic rows are synthesized client-side, no id to persist).
  const rowReorderable = rowKind === "audience" ? true : topicReorderable;
  const colReorderable = colKind === "audience" ? true : topicReorderable;

  // Hover crosshair: on the cell under the pointer, tint the border-lines that
  // bound its column (this column's + the previous column's right border) and
  // its row (this row's + the previous row's bottom border), plus the two
  // headers. Only border-COLOR changes on already-present borders → zero layout
  // shift, a clean CSS transition, and no conflict with edit-mode drop rings
  // (those are box-shadow). Driven imperatively so hovering never re-renders the
  // grid. Hovering a header alone lights just that one column/row.
  const tableRef = useRef<HTMLTableElement>(null);
  const crossRef = useRef<{ col: string | null; row: string | null }>({
    col: null,
    row: null,
  });
  const colKeyList = cols.map((c) => c.key);
  const rowKeyList = rows.map((r) => r.key);

  function paintCrosshair(col: string | null, row: string | null) {
    const table = tableRef.current;
    if (!table) return;
    if (crossRef.current.col === col && crossRef.current.row === row) return;
    crossRef.current = { col, row };
    table
      .querySelectorAll(".matrix-grid__x--edge-r, .matrix-grid__x--edge-b")
      .forEach((el) =>
        el.classList.remove("matrix-grid__x--edge-r", "matrix-grid__x--edge-b"),
      );
    if (col) {
      const i = colKeyList.indexOf(col);
      for (const k of [col, colKeyList[i - 1]].filter(Boolean) as string[])
        table
          .querySelectorAll(`[data-col-key="${CSS.escape(k)}"]`)
          .forEach((el) => el.classList.add("matrix-grid__x--edge-r"));
    }
    if (row) {
      const i = rowKeyList.indexOf(row);
      for (const k of [row, rowKeyList[i - 1]].filter(Boolean) as string[])
        table
          .querySelectorAll(`[data-row-key="${CSS.escape(k)}"]`)
          .forEach((el) => el.classList.add("matrix-grid__x--edge-b"));
    }
  }

  function handleCrossOver(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest(
      "[data-col-key],[data-row-key]",
    ) as HTMLElement | null;
    paintCrosshair(el?.dataset.colKey ?? null, el?.dataset.rowKey ?? null);
  }

  const grid = (
    <div className="matrix-grid h-full overflow-auto">
      <table
        ref={tableRef}
        onMouseOver={handleCrossOver}
        onMouseLeave={() => paintCrosshair(null, null)}
        className="border-separate border-spacing-0"
      >
        <thead className="matrix-grid__head">
          <tr>
            <th className="matrix-grid__corner sticky left-0 top-0 z-30 h-20 min-w-[180px] border-b border-r border-border bg-surface-alt p-0 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              <div className="flex h-full min-h-20 flex-col items-center justify-center gap-1 p-2">
                <button
                  type="button"
                  onClick={() => setTransposed(!transposed)}
                  title={`Transpose — show ${transposed ? "audiences" : "topics"} as rows`}
                  aria-label="Transpose matrix"
                  className="matrix-grid__transpose-btn inline-flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <span>{rowLabel}</span>
                  <span className="text-base font-normal text-text-tertiary">
                    {transposed ? "╱" : "╲"}
                  </span>
                  <span>{colLabel}</span>
                </button>
                <label
                  className="matrix-grid__hide-inactive inline-flex cursor-pointer items-center gap-1 text-[10px] font-normal normal-case tracking-normal text-text-secondary"
                  title="Hide INACTIVE audiences and topics (never hides MCs)"
                >
                  <input
                    type="checkbox"
                    checked={hideInactive}
                    onChange={(e) => setHideInactive(e.target.checked)}
                    className="size-3 accent-sky-600"
                  />
                  Hide inactive
                </label>
              </div>
            </th>
            {cols.map((c) => {
              const isAudCol = colsAreAudiences;
              const colInactive = c.status === "INACTIVE";
              const isPickable = !!pending && isAudCol;
              const isTargetSelected =
                isPickable && pending!.targetAudienceKeys.has(c.key);
              const isDisabled =
                isPickable &&
                pending!.kind === "move" &&
                sourceAudiences.has(c.key);
              return (
                <th
                  key={c.id}
                  className={clsx(
                    "matrix-grid__col-header group sticky top-0 z-20 border-b border-r border-border bg-surface-alt align-top text-left font-medium text-text-primary",
                    density === "dense"
                      ? "matrix-grid__col-header--dense h-40 min-h-40 w-7 min-w-7 max-w-7 p-0"
                      : "h-20 min-h-20 min-w-[160px] p-0",
                    isTargetSelected &&
                      "matrix-grid__col-header--target bg-emerald-50",
                    isDisabled &&
                      "matrix-grid__col-header--target-disabled opacity-50",
                    isAudCol && audienceEdgeClasses(c as Audience),
                  )}
                  data-col-key={c.key}
                  title={c.key}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (isPickable && !isDisabled) {
                        editApi.toggleTargetAudience(c.key);
                      } else {
                        onOpenHeader(colKind, c.key);
                      }
                    }}
                    disabled={isDisabled}
                    className={clsx(
                      "matrix-grid__col-header-btn block size-full text-left transition hover:bg-black/5 dark:hover:bg-white/10",
                      density === "dense" ? "p-1" : "p-2",
                      editMode && colReorderable && "pb-3.5",
                    )}
                    aria-label={`Open ${colKind} ${c.name}`}
                  >
                    {density === "dense" ? (
                      <div className="matrix-grid__col-header-label--vertical flex h-full items-end justify-center">
                        <span
                          className={clsx(
                            "font-semibold text-[10px] [writing-mode:vertical-rl] [transform:rotate(180deg)] truncate max-h-full",
                            colInactive
                              ? "matrix-grid__col-header-label--inactive text-text-disabled"
                              : "text-text-primary",
                          )}
                        >
                          {c.name}
                        </span>
                      </div>
                    ) : (
                      <>
                        <div
                          className={clsx(
                            "matrix-grid__col-header-label font-semibold",
                            density === "compact" ? "text-[10px]" : "text-xs",
                            colInactive &&
                              "matrix-grid__col-header-label--inactive text-text-disabled",
                          )}
                        >
                          {c.name}
                        </div>
                        {density === "detailed" ? (
                          <div className="matrix-grid__col-header-key truncate font-mono text-[10px] text-text-tertiary">
                            {c.key}
                          </div>
                        ) : null}
                      </>
                    )}
                  </button>
                  {editMode ? (
                    <button
                      type="button"
                      title={`Duplicate ${colKind} — ${c.name}`}
                      aria-label={`Duplicate ${colKind} ${c.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicateHeader(colKind, c.id);
                      }}
                      className="matrix-grid__header-dup-btn absolute right-0.5 top-0.5 z-10 hidden rounded border border-slate-300 bg-surface-alt p-0.5 text-text-tertiary shadow-sm hover:border-slate-500 hover:text-text-primary group-hover:inline-flex focus-visible:inline-flex"
                    >
                      <Copy className="size-3" />
                    </button>
                  ) : null}
                  {editMode && colReorderable ? (
                    <>
                      <HeaderDropZone
                        kind={colKind}
                        id={c.id}
                        active={!!reorderState && reorderState.kind === colKind}
                      />
                      <HeaderReorderHandle
                        kind={colKind}
                        id={c.id}
                        label={c.name}
                        orientation="col"
                      />
                    </>
                  ) : null}
                </th>
              );
            })}
            {editMode ? (
              // MM5-style: a wide trailing column whose whole cell is the add
              // button (audiences are columns by default).
              <th className="matrix-grid__col-add sticky top-0 z-20 min-w-[160px] border-b border-r border-border bg-surface-alt p-0">
                <button
                  type="button"
                  title={`Add ${colKind}`}
                  aria-label={`Add ${colKind}`}
                  onClick={() => onAddHeader(colKind)}
                  className="matrix-grid__header-add-btn flex size-full min-h-20 items-center justify-center p-2 text-text-tertiary transition hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
                >
                  <Plus className="size-5" />
                </button>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="matrix-grid__row">
              <th
                className={clsx(
                  "matrix-grid__row-header group sticky left-0 z-10 border-b border-r border-border bg-surface-alt text-left font-medium text-text-primary",
                  density === "dense" ? "min-w-[140px] p-0" : "min-w-[180px] p-0",
                  !transposed && audienceEdgeClasses(r as Audience, "right"),
                )}
                data-row-key={r.key}
                title={r.key}
              >
                <button
                  type="button"
                  onClick={() => onOpenHeader(rowKind, r.key)}
                  className={clsx(
                    "matrix-grid__row-header-btn block size-full text-left transition hover:bg-black/5 dark:hover:bg-white/10",
                    density === "dense" ? "p-1" : "p-2",
                    editMode && rowReorderable && "pl-4",
                  )}
                  aria-label={`Open ${rowKind} ${r.name}`}
                >
                  <div
                    className={clsx(
                      "matrix-grid__row-header-label font-semibold",
                      density === "detailed" ? "text-xs" : "text-[10px]",
                      r.status === "INACTIVE" &&
                        "matrix-grid__row-header-label--inactive text-text-disabled",
                    )}
                  >
                    {r.name}
                  </div>
                  {density === "detailed" ? (
                    <div className="matrix-grid__row-header-key font-mono text-[10px] text-text-tertiary">
                      {r.key}
                    </div>
                  ) : null}
                </button>
                {editMode ? (
                  <button
                    type="button"
                    title={`Duplicate ${rowKind} — ${r.name}`}
                    aria-label={`Duplicate ${rowKind} ${r.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicateHeader(rowKind, r.id);
                    }}
                    className="matrix-grid__header-dup-btn absolute right-0.5 top-0.5 z-10 hidden rounded border border-slate-300 bg-surface-alt p-0.5 text-text-tertiary shadow-sm hover:border-slate-500 hover:text-text-primary group-hover:inline-flex focus-visible:inline-flex"
                  >
                    <Copy className="size-3" />
                  </button>
                ) : null}
                {editMode && rowReorderable ? (
                  <>
                    <HeaderDropZone
                      kind={rowKind}
                      id={r.id}
                      active={!!reorderState && reorderState.kind === rowKind}
                    />
                    <HeaderReorderHandle
                      kind={rowKind}
                      id={r.id}
                      label={r.name}
                      orientation="row"
                    />
                  </>
                ) : null}
              </th>
              {cols.map((c) => {
                const audKey = transposed ? c.key : r.key;
                const topKey = transposed ? r.key : c.key;
                const list = cells.get(`${audKey}\0${topKey}`) ?? [];
                if (!editMode) {
                  return (
                    <PlainCell
                      key={c.id}
                      audience={audKey}
                      topic={topKey}
                      colKey={c.key}
                      rowKey={r.key}
                      messages={list}
                      density={density}
                      onOpenMessage={onOpenMessage}
                    />
                  );
                }
                // Pending-action ghost previews: one ghost per
                // (selected MC × target audience) in the matching cells.
                const ghosts =
                  pending && pending.targetAudienceKeys.has(audKey)
                    ? [...editApi.selection.mcIds]
                        .map((id) => messageById.get(id))
                        .filter(
                          (m): m is Message => !!m && m.topic === topKey,
                        )
                    : [];
                return (
                  <EditableCell
                    key={c.id}
                    audience={audKey}
                    topic={topKey}
                    colKey={c.key}
                    rowKey={r.key}
                    messages={list}
                    ghosts={ghosts}
                    density={density}
                    editApi={editApi}
                    onOpenMessage={onOpenMessage}
                    onCreateInCell={onCreateInCell}
                    dropDisabled={
                      !!editApi.selection.topic &&
                      topKey !== editApi.selection.topic
                    }
                  />
                );
              })}
            </tr>
          ))}
          {editMode ? (
            // MM5-style: a tall trailing row whose sticky header cell is the add
            // button (topics are rows by default); a spanning fill completes the
            // band across the columns.
            <tr className="matrix-grid__row-add">
              <th
                className={clsx(
                  "sticky left-0 z-10 border-b border-r border-border bg-surface-alt p-0",
                  density === "dense" ? "min-w-[140px]" : "min-w-[180px]",
                )}
              >
                <button
                  type="button"
                  title={`Add ${rowKind}`}
                  aria-label={`Add ${rowKind}`}
                  onClick={() => onAddHeader(rowKind)}
                  className="matrix-grid__header-add-btn flex size-full min-h-16 items-center justify-center p-2 text-text-tertiary transition hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
                >
                  <Plus className="size-5" />
                </button>
              </th>
              <td
                colSpan={cols.length + 1}
                className="matrix-grid__row-add-fill border-b border-border bg-slate-50/50 dark:bg-white/[0.03]"
                aria-hidden="true"
              />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );

  if (!editMode) return grid;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {grid}
      <DragOverlay dropAnimation={null}>{dragOverlay}</DragOverlay>
    </DndContext>
  );
}

// Always-visible grip that drags a header to reorder it (edit mode only).
// Orientation picks the icon + placement: rows grip on the left edge, columns
// grip along the bottom (above the strategy/platform colour border). Only
// rendered inside the DndContext, so useDraggable is safe.
function HeaderReorderHandle({
  kind,
  id,
  label,
  orientation,
}: {
  kind: "audience" | "topic";
  id: number;
  label: string;
  orientation: "row" | "col";
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `ro:${kind}:${id}`,
    data: { label },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={-1}
      aria-label={`Drag to reorder ${label}`}
      title="Drag to reorder"
      onClick={(e) => e.stopPropagation()}
      className={clsx(
        "z-20 flex cursor-grab touch-none items-center justify-center text-text-tertiary hover:text-text-primary active:cursor-grabbing",
        orientation === "row"
          ? "matrix-grid__row-reorder absolute inset-y-0 left-0 w-3.5"
          : "matrix-grid__col-reorder absolute inset-x-0 bottom-0 h-3",
        isDragging && "opacity-40",
      )}
    >
      {orientation === "row" ? (
        <GripVertical className="size-3" />
      ) : (
        <GripHorizontal className="size-3" />
      )}
    </div>
  );
}

// Invisible drop target covering a whole header cell; pointer-events-none so it
// never blocks the header button — dnd-kit collision is geometry-based, not
// pointer-based. Highlights when a compatible reorder drag is over it.
function HeaderDropZone({
  kind,
  id,
  active,
}: {
  kind: "audience" | "topic";
  id: number;
  active: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `rod:${kind}:${id}` });
  return (
    <div
      ref={setNodeRef}
      aria-hidden="true"
      className={clsx(
        "pointer-events-none absolute inset-0 z-10",
        active && isOver && "ring-2 ring-inset ring-sky-500 bg-sky-500/10",
      )}
    />
  );
}

// Read-only cell — no useDroppable, no ghost previews, no add button. Used
// when editApi.editMode is false (the default). Keeps non-edit-mode renders
// hook-free per cell so the 13k+ grid stays responsive.
function PlainCell({
  audience,
  topic,
  colKey,
  rowKey,
  messages,
  density,
  onOpenMessage,
}: {
  audience: string;
  topic: string;
  colKey: string;
  rowKey: string;
  messages: Message[];
  density: Density;
  onOpenMessage: (id: number) => void;
}) {
  return (
    <td
      data-col-key={colKey}
      data-row-key={rowKey}
      className={clsx(
        "matrix-grid__cell border-b border-r border-border",
        density === "dense"
          ? // dense: vertically centre the dot cluster in the row height
            "matrix-grid__cell--dense w-7 min-w-7 max-w-7 p-0.5 align-middle"
          : "min-w-[160px] p-1.5 align-top",
        // M3: uniform cell background (empty and filled alike) so the M1
        // "Color by" band sits on a clean base; the has-messages class stays
        // as a semantic hook (no CSS of its own).
        "bg-surface",
        messages.length > 0 && "matrix-grid__cell--has-messages",
      )}
      data-audience={audience}
      data-topic={topic}
    >
      <div
        className={clsx(
          "flex flex-wrap",
          density === "dense" ? "gap-0.5 justify-center" : "gap-1",
          density === "compact" && "gap-1.5",
        )}
      >
        {messages.map((m) => (
          <PlainChip
            key={m.id}
            message={m}
            density={density}
            onClick={() => onOpenMessage(m.id)}
          />
        ))}
      </div>
    </td>
  );
}

function EditableCell({
  audience,
  topic,
  colKey,
  rowKey,
  messages,
  ghosts,
  density,
  editApi,
  onOpenMessage,
  onCreateInCell,
  dropDisabled,
}: {
  audience: string;
  topic: string;
  colKey: string;
  rowKey: string;
  messages: Message[];
  ghosts: Message[];
  density: Density;
  editApi: EditApi;
  onOpenMessage: (id: number) => void;
  onCreateInCell: (audience: string, topic: string) => void;
  dropDisabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${audience}\0${topic}`,
    disabled: dropDisabled,
  });
  const pending = editApi.pendingAction;
  // For move, dim source-cell chips so the relocation reads visually.
  const isSourceCellForPendingMove =
    pending?.kind === "move" &&
    !!editApi.selection.topic &&
    topic === editApi.selection.topic &&
    messages.some((m) => editApi.selection.mcIds.has(m.id));

  return (
    <td
      ref={setNodeRef}
      data-col-key={colKey}
      data-row-key={rowKey}
      className={clsx(
        "matrix-grid__cell group border-b border-r border-border",
        density === "dense"
          ? // dense: vertically centre the dot cluster in the row height
            "matrix-grid__cell--dense w-7 min-w-7 max-w-7 p-0.5 align-middle"
          : "min-w-[160px] p-1.5 align-top",
        // M3: uniform cell background (see PlainCell) — filled cells keep the
        // has-messages hook; the drop-target rings below are unaffected.
        "bg-surface",
        messages.length > 0 && "matrix-grid__cell--has-messages",
        isOver &&
          !dropDisabled &&
          "matrix-grid__cell--drop-target ring-2 ring-emerald-400",
        isOver &&
          dropDisabled &&
          "matrix-grid__cell--drop-rejected ring-2 ring-rose-400",
      )}
      data-audience={audience}
      data-topic={topic}
    >
      <div
        className={clsx(
          "flex flex-wrap",
          density === "dense" ? "gap-0.5 justify-center" : "gap-1",
          density === "compact" && "gap-1.5",
        )}
      >
        {messages.map((m) =>
          m.archivedAt ? (
            // Archived chips (visible via the Show archived toggle) open the
            // editor but are never selectable/draggable — the server's move
            // guard checks status only, not archivedAt, so the UI closes it.
            <PlainChip
              key={m.id}
              message={m}
              density={density}
              onClick={() => onOpenMessage(m.id)}
            />
          ) : (
            <EditableChip
              key={m.id}
              message={m}
              density={density}
              editApi={editApi}
              ghostSource={isSourceCellForPendingMove}
              onClick={() => onOpenMessage(m.id)}
            />
          ),
        )}
        {ghosts.map((g) => (
          <GhostChip key={`g:${g.id}`} message={g} density={density} />
        ))}
        {density !== "dense" ? (
          <button
            type="button"
            title="New MC in this cell"
            onClick={() => onCreateInCell(audience, topic)}
            className="cell-add-btn hidden items-center gap-1 rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-slate-500 hover:text-slate-700 group-hover:inline-flex focus-visible:inline-flex"
          >
            <Plus className="size-3" />
            new
          </button>
        ) : (
          // Dense: no room for the "new" pill — a small round +, revealed on
          // cell hover, keeps the affordance consistent with the wider views.
          <button
            type="button"
            title="New MC in this cell"
            aria-label="New MC in this cell"
            onClick={() => onCreateInCell(audience, topic)}
            className="cell-add-btn cell-add-btn--dense hidden size-4 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-500 hover:border-slate-500 hover:text-slate-700 group-hover:inline-flex focus-visible:inline-flex"
          >
            <Plus className="size-2.5" />
          </button>
        )}
      </div>
    </td>
  );
}

// Read-only chip — no useDraggable, no useLongPress. Mirrors the McChip
// rendering from before the edit-mode feature shipped.
function PlainChip({
  message,
  density,
  onClick,
}: {
  message: Message;
  density: Density;
  onClick: () => void;
}) {
  const label = `MC${message.number}${message.variant}`;
  const dot = STATUS_COLOR[message.status ?? ""] ?? "bg-slate-300";
  const archived = message.archivedAt !== null;

  if (density === "dense") {
    return (
      <button
        onClick={onClick}
        title={`${label} · ${message.name ?? "(unnamed)"}`}
        aria-label={label}
        className={clsx(
          "mc-chip mc-chip--dense size-2.5 cursor-pointer rounded-full transition hover:ring-2 hover:ring-border-subtle",
          dot,
          archived && "mc-chip--archived row--archived",
        )}
      />
    );
  }
  if (density === "compact") {
    return (
      <button
        onClick={onClick}
        title={`${label} · ${message.name ?? "(unnamed)"}`}
        className={clsx(
          "mc-chip mc-chip--compact inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] transition hover:border-border-subtle hover:bg-surface-alt",
          archived && "mc-chip--archived row--archived",
        )}
      >
        <span className={clsx("mc-chip__dot status-dot size-1.5 rounded-full", dot)} />
        <span
          className={clsx(
            "mc-chip__label font-mono text-text-primary",
            archived && "row--archived__title",
          )}
        >
          {label}
        </span>
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      title={`${label} · ${message.name ?? "(unnamed)"}`}
      className={clsx(
        "mc-chip mc-chip--detailed flex max-w-full cursor-pointer flex-col items-start gap-0.5 rounded border border-border bg-surface px-1.5 py-1 text-xs transition hover:border-border-subtle hover:bg-surface-alt",
        archived && "mc-chip--archived row--archived",
      )}
    >
      <span className="mc-chip__line mc-chip__line--label inline-flex items-center gap-1.5">
        <span className={clsx("mc-chip__dot status-dot size-1.5 rounded-full", dot)} />
        <span
          className={clsx(
            "mc-chip__label font-mono text-text-primary",
            archived && "row--archived__title",
          )}
        >
          {label}
        </span>
      </span>
      {message.name ? (
        <span className="mc-chip__line mc-chip__line--name max-w-full truncate text-[10px] text-text-secondary">
          {message.name}
        </span>
      ) : null}
    </button>
  );
}

function EditableChip({
  message,
  density,
  editApi,
  ghostSource,
  onClick,
}: {
  message: Message;
  density: Density;
  editApi: EditApi;
  ghostSource: boolean;
  onClick: () => void;
}) {
  const label = `MC${message.number}${message.variant}`;
  const dot = STATUS_COLOR[message.status ?? ""] ?? "bg-slate-300";
  const selected = editApi.selection.mcIds.has(message.id);
  const ghostSourceClass =
    ghostSource && selected ? "mc-chip--ghost-source opacity-40" : "";

  const longPress = useLongPress(() => {
    editApi.setEditMode(true);
    editApi.toggleSelect(message);
  });

  const draggable = useDraggable({
    id: `mc:${message.id}`,
  });

  const baseHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      longPress.onPointerDown(e);
      // dnd-kit's PointerSensor listens on the same handler — invoke with the
      // raw event so its activationConstraint (distance:4) kicks in.
      (draggable.listeners?.onPointerDown as
        | ((ev: React.PointerEvent) => void)
        | undefined)?.(e);
    },
    onPointerMove: longPress.onPointerMove,
    onPointerUp: longPress.onPointerUp,
    onPointerLeave: longPress.onPointerLeave,
    onClickCapture: (e: React.MouseEvent) => {
      if (longPress.consumeNextClick()) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      editApi.toggleSelect(message);
    },
  };

  if (density === "dense") {
    return (
      <button
        ref={draggable.setNodeRef}
        {...baseHandlers}
        onClick={onClick}
        title={`${label} · ${message.name ?? "(unnamed)"}`}
        aria-label={label}
        className={clsx(
          "mc-chip mc-chip--dense mc-chip--selectable size-2.5 cursor-pointer rounded-full transition hover:ring-2 hover:ring-border-subtle",
          dot,
          selected && "mc-chip--selected ring-2 ring-slate-900",
          ghostSourceClass,
        )}
      />
    );
  }
  if (density === "compact") {
    return (
      <button
        ref={draggable.setNodeRef}
        {...baseHandlers}
        onClick={onClick}
        title={`${label} · ${message.name ?? "(unnamed)"}`}
        className={clsx(
          "mc-chip mc-chip--compact mc-chip--selectable inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] transition hover:border-border-subtle hover:bg-surface-alt",
          selected && "mc-chip--selected ring-2 ring-slate-900",
          ghostSourceClass,
        )}
      >
        <span className={clsx("mc-chip__dot status-dot size-1.5 rounded-full", dot)} />
        <span className="mc-chip__label font-mono text-text-primary">{label}</span>
      </button>
    );
  }
  return (
    <button
      ref={draggable.setNodeRef}
      {...baseHandlers}
      onClick={onClick}
      title={`${label} · ${message.name ?? "(unnamed)"}`}
      className={clsx(
        "mc-chip mc-chip--detailed mc-chip--selectable flex max-w-full cursor-pointer flex-col items-start gap-0.5 rounded border border-border bg-surface px-1.5 py-1 text-xs transition hover:border-border-subtle hover:bg-surface-alt",
        selected && "mc-chip--selected ring-2 ring-slate-900",
        ghostSourceClass,
      )}
    >
      <span className="mc-chip__line mc-chip__line--label inline-flex items-center gap-1.5">
        <span className={clsx("mc-chip__dot status-dot size-1.5 rounded-full", dot)} />
        <span className="mc-chip__label font-mono text-text-primary">{label}</span>
      </span>
      {message.name ? (
        <span className="mc-chip__line mc-chip__line--name max-w-full truncate text-[10px] text-text-secondary">
          {message.name}
        </span>
      ) : null}
    </button>
  );
}

function GhostChip({
  message,
  density,
}: {
  message: Message;
  density: Density;
}) {
  const label = `MC${message.number}${message.variant}`;
  if (density === "dense") {
    return (
      <span
        title={`Ghost: ${label}`}
        className="mc-chip mc-chip--dense mc-chip--ghost size-2.5 rounded-full border border-dashed border-slate-500 bg-slate-100/40"
      />
    );
  }
  return (
    <span
      title={`Ghost preview: ${label}`}
      className="mc-chip mc-chip--ghost inline-flex items-center gap-1 rounded border border-dashed border-slate-500 bg-slate-100/40 px-1.5 py-0.5 text-[10px] text-slate-600"
    >
      <span className="mc-chip__label font-mono">{label}</span>
    </span>
  );
}
