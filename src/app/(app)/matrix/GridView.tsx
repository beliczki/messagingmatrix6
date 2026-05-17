"use client";

import { useCallback, useMemo, useState } from "react";
import clsx from "clsx";
import { Plus } from "lucide-react";
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

export default function GridView({
  audiences,
  topics,
  messages,
  density,
  transposed,
  setTransposed,
  onOpenMessage,
  onOpenHeader,
  editApi,
  onDndDrop,
  onCreateInCell,
}: {
  audiences: Audience[];
  topics: Topic[];
  messages: Message[];
  density: Density;
  transposed: boolean;
  setTransposed: (v: boolean) => void;
  onOpenMessage: (id: number) => void;
  onOpenHeader: (kind: "audience" | "topic", key: string) => void;
  editApi: EditApi;
  onDndDrop: (args: {
    draggedId: number;
    targetAudience: string;
    targetTopic: string;
    copy: boolean;
  }) => void;
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

  const onDragStart = useCallback(
    (e: DragStartEvent) => {
      const idStr = String(e.active.id);
      if (!idStr.startsWith("mc:")) return;
      const draggedId = Number(idStr.slice(3));
      const ids = editApi.selection.mcIds.has(draggedId)
        ? [...editApi.selection.mcIds]
        : [draggedId];
      setDragState({ draggedId, ids });
    },
    [editApi.selection.mcIds],
  );

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const state = dragState;
      setDragState(null);
      if (!state || !e.over) return;
      const overId = String(e.over.id);
      if (!overId.startsWith("cell:")) return;
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
    [dragState, onDndDrop],
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
    ) : null;

  const grid = (
    <div className="matrix-grid h-full overflow-auto">
      <table className="border-separate border-spacing-0">
        <thead className="matrix-grid__head">
          <tr>
            <th className="matrix-grid__corner sticky left-0 top-0 z-30 h-20 min-w-[180px] border-b border-r border-border bg-surface-alt p-0 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              <div className="flex h-full min-h-20 items-center justify-center p-2">
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
              </div>
            </th>
            {cols.map((c) => {
              const isAudCol = colsAreAudiences;
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
                    "matrix-grid__col-header sticky top-0 z-20 border-b border-r border-border bg-surface-alt align-top text-left font-medium text-text-primary",
                    density === "dense"
                      ? "matrix-grid__col-header--dense h-40 min-h-40 w-7 min-w-7 max-w-7 p-0"
                      : "h-20 min-h-20 min-w-[160px] p-0",
                    isTargetSelected &&
                      "matrix-grid__col-header--target bg-emerald-50",
                    isDisabled &&
                      "matrix-grid__col-header--target-disabled opacity-50",
                  )}
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
                    )}
                    aria-label={`Open ${colKind} ${c.name}`}
                  >
                    {density === "dense" ? (
                      <div className="matrix-grid__col-header-label--vertical flex h-full items-end justify-center">
                        <span className="font-semibold text-[10px] text-text-primary [writing-mode:vertical-rl] [transform:rotate(180deg)] truncate max-h-full">
                          {c.name}
                        </span>
                      </div>
                    ) : (
                      <>
                        <div
                          className={clsx(
                            "matrix-grid__col-header-label font-semibold",
                            density === "compact" ? "text-[10px]" : "text-xs",
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
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="matrix-grid__row">
              <th
                className={clsx(
                  "matrix-grid__row-header sticky left-0 z-10 border-b border-r border-border bg-surface-alt text-left font-medium text-text-primary",
                  density === "dense" ? "min-w-[140px] p-0" : "min-w-[180px] p-0",
                )}
                title={r.key}
              >
                <button
                  type="button"
                  onClick={() => onOpenHeader(rowKind, r.key)}
                  className={clsx(
                    "matrix-grid__row-header-btn block size-full text-left transition hover:bg-black/5 dark:hover:bg-white/10",
                    density === "dense" ? "p-1" : "p-2",
                  )}
                  aria-label={`Open ${rowKind} ${r.name}`}
                >
                  <div
                    className={clsx(
                      "matrix-grid__row-header-label font-semibold",
                      density === "detailed" ? "text-xs" : "text-[10px]",
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

// Read-only cell — no useDroppable, no ghost previews, no add button. Used
// when editApi.editMode is false (the default). Keeps non-edit-mode renders
// hook-free per cell so the 13k+ grid stays responsive.
function PlainCell({
  audience,
  topic,
  messages,
  density,
  onOpenMessage,
}: {
  audience: string;
  topic: string;
  messages: Message[];
  density: Density;
  onOpenMessage: (id: number) => void;
}) {
  return (
    <td
      className={clsx(
        "matrix-grid__cell border-b border-r border-border align-top",
        density === "dense"
          ? "matrix-grid__cell--dense w-7 min-w-7 max-w-7 p-0.5"
          : "min-w-[160px] p-1.5",
        messages.length === 0
          ? "bg-slate-50/50 dark:bg-white/[0.03]"
          : "matrix-grid__cell--has-messages bg-surface",
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
      className={clsx(
        "matrix-grid__cell border-b border-r border-border align-top",
        density === "dense"
          ? "matrix-grid__cell--dense w-7 min-w-7 max-w-7 p-0.5"
          : "min-w-[160px] p-1.5",
        messages.length === 0
          ? "bg-slate-50/50 dark:bg-white/[0.03]"
          : "matrix-grid__cell--has-messages bg-surface",
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
        {messages.map((m) => (
          <EditableChip
            key={m.id}
            message={m}
            density={density}
            editApi={editApi}
            ghostSource={isSourceCellForPendingMove}
            onClick={() => onOpenMessage(m.id)}
          />
        ))}
        {ghosts.map((g) => (
          <GhostChip key={`g:${g.id}`} message={g} density={density} />
        ))}
        {density !== "dense" ? (
          <button
            type="button"
            title="New MC in this cell"
            onClick={() => onCreateInCell(audience, topic)}
            className="cell-add-btn inline-flex items-center gap-1 rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-slate-500 hover:text-slate-700"
          >
            <Plus className="size-3" />
            new
          </button>
        ) : null}
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

  if (density === "dense") {
    return (
      <button
        onClick={onClick}
        title={`${label} · ${message.name ?? "(unnamed)"}`}
        aria-label={label}
        className={clsx(
          "mc-chip mc-chip--dense size-2.5 cursor-pointer rounded-full transition hover:ring-2 hover:ring-border-subtle",
          dot,
        )}
      />
    );
  }
  if (density === "compact") {
    return (
      <button
        onClick={onClick}
        title={`${label} · ${message.name ?? "(unnamed)"}`}
        className="mc-chip mc-chip--compact inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] transition hover:border-border-subtle hover:bg-surface-alt"
      >
        <span className={clsx("mc-chip__dot status-dot size-1.5 rounded-full", dot)} />
        <span className="mc-chip__label font-mono text-text-primary">{label}</span>
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      title={`${label} · ${message.name ?? "(unnamed)"}`}
      className="mc-chip mc-chip--detailed flex max-w-full cursor-pointer flex-col items-start gap-0.5 rounded border border-border bg-surface px-1.5 py-1 text-xs transition hover:border-border-subtle hover:bg-surface-alt"
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
