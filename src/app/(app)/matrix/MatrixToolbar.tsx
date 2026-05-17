"use client";

import {
  X,
  Filter as FilterIcon,
  Users,
  ListTree,
  Pencil,
  Copy,
  ArrowRightLeft,
  Trash2,
  Check,
} from "lucide-react";
import clsx from "clsx";
import { type Filters, type Topic } from "./types";
import { type EditApi } from "./MatrixGrid";
import MultiPill from "../_components/MultiPill";

type Props = {
  filters: Filters;
  setFilters: (f: Filters) => void;
  productOptions: string[];
  statusOptions: string[];
  counts: {
    audiences: number;
    topics: number;
    messages: number;
    visible: number;
    visibleAudiences: number;
    visibleTopics: number;
  };
  editApi: EditApi;
  topicNameByKey: Map<string, Topic>;
};

export default function MatrixToolbar(p: Props) {
  const activeFilters =
    p.filters.products.size + p.filters.statuses.size + (p.filters.search ? 1 : 0);
  const { editApi } = p;
  const selectedCount = editApi.selection.mcIds.size;
  const showSelectionActions = editApi.editMode && selectedCount > 0;
  const pending = editApi.pendingAction;
  const moveTargetReady =
    pending?.kind === "move" && pending.targetAudienceKeys.size === 1;
  const copyTargetReady =
    pending?.kind === "copy" && pending.targetAudienceKeys.size > 0;
  const applyReady = moveTargetReady || copyTargetReady;
  const selectedTopic =
    editApi.selection.topic && p.topicNameByKey.get(editApi.selection.topic);

  return (
    <div className="toolbar matrix-toolbar sticky top-0 z-40 flex min-h-12 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4">
      <div className="matrix-toolbar__brand flex items-baseline gap-2">
        <div className="matrix-toolbar__title text-sm font-semibold text-slate-900">Matrix</div>
      </div>

      <div className="input-box input-box--with-icon relative ml-2">
        <FilterIcon className="input-box__icon pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder="Filter… a: t: s: p: mc: OR …"
          title='Free text searches all fields. Prefixes: a: (audience), t: (topic), s: (strategy), p: (platform), mc: (MC#). a:/t:/s:/p: also hide non-matching rows/columns. AND implicit, OR explicit. Quote "two words" for phrases.'
          value={p.filters.search}
          onChange={(e) =>
            p.setFilters({ ...p.filters, search: e.target.value })
          }
          className="input-box__field w-72 rounded-md border border-slate-300 py-1 pl-7 pr-2 text-xs focus:border-slate-500 focus:outline-none"
        />
      </div>

      <MultiPill
        label="Product"
        values={p.filters.products}
        options={p.productOptions}
        onChange={(s) => p.setFilters({ ...p.filters, products: s })}
      />
      <MultiPill
        label="Status"
        values={p.filters.statuses}
        options={p.statusOptions}
        onChange={(s) => p.setFilters({ ...p.filters, statuses: s })}
      />

      {activeFilters > 0 ? (
        <button
          onClick={() =>
            p.setFilters({
              products: new Set(),
              statuses: new Set(),
              search: "",
            })
          }
          className="toolbar-btn flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
        >
          <X className="size-3" />
          Clear
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => editApi.setEditMode(!editApi.editMode)}
        title={editApi.editMode ? "Exit edit mode" : "Enter edit mode"}
        className={clsx(
          "toolbar-btn toolbar-btn--toggle inline-flex items-center gap-1 rounded px-2 py-1 text-xs",
          editApi.editMode
            ? "toolbar-btn--toggle--active bg-slate-900 text-white hover:bg-slate-800"
            : "text-slate-700 hover:bg-slate-100",
        )}
      >
        <Pencil className="size-3" />
        Edit
      </button>

      {showSelectionActions ? (
        <div className="selection-actions selection-actions--inline ml-1 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
          <span className="selection-actions__count font-semibold text-slate-700">
            {selectedCount} selected
            {selectedTopic ? (
              <span className="ml-1 text-slate-500">
                · topic {selectedTopic.name}
              </span>
            ) : null}
          </span>
          {!pending ? (
            <>
              <button
                type="button"
                onClick={() => editApi.beginPending("copy")}
                className="selection-actions__btn selection-actions__btn--copy inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-1 text-white hover:bg-slate-800"
              >
                <Copy className="size-3" />
                Copy
              </button>
              <button
                type="button"
                onClick={() => editApi.beginPending("move")}
                className="selection-actions__btn selection-actions__btn--move inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100"
              >
                <ArrowRightLeft className="size-3" />
                Move
              </button>
              <button
                type="button"
                disabled
                title="Bulk delete — coming in v2"
                className="selection-actions__btn selection-actions__btn--delete inline-flex cursor-not-allowed items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-slate-400"
              >
                <Trash2 className="size-3" />
                Delete
              </button>
              <button
                type="button"
                onClick={editApi.clearSelection}
                className="selection-actions__btn selection-actions__btn--cancel inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100"
              >
                <X className="size-3" />
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="selection-actions__pending text-slate-500">
                {pending.kind === "copy" ? "Copy" : "Move"} → pick{" "}
                {pending.kind === "move" ? "1 audience" : "audience columns"}
              </span>
              <button
                type="button"
                onClick={editApi.applyPending}
                disabled={!applyReady || editApi.bulkBusy}
                className={clsx(
                  "selection-actions__btn selection-actions__btn--apply inline-flex items-center gap-1 rounded px-2 py-1 text-white",
                  applyReady && !editApi.bulkBusy
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "cursor-not-allowed bg-slate-300",
                )}
              >
                <Check className="size-3" />
                Apply ({pending.targetAudienceKeys.size})
              </button>
              <button
                type="button"
                onClick={editApi.cancelPending}
                className="selection-actions__btn selection-actions__btn--cancel inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100"
              >
                <X className="size-3" />
                Cancel
              </button>
            </>
          )}
        </div>
      ) : null}

      <div
        className="matrix-toolbar__count ml-auto flex items-center gap-2 text-[11px] tabular-nums text-slate-500"
        title={`${p.counts.visible}/${p.counts.messages} messages · ${p.counts.visibleAudiences}/${p.counts.audiences} audiences · ${p.counts.visibleTopics}/${p.counts.topics} topics`}
      >
        <span className="matrix-toolbar__count-item">
          mc: {p.counts.visible}/{p.counts.messages}
        </span>
        <span className="matrix-toolbar__count-item inline-flex items-center gap-1" title="Audiences">
          <Users className="size-3" aria-label="Audiences" />
          {p.counts.visibleAudiences}/{p.counts.audiences}
        </span>
        <span className="matrix-toolbar__count-item inline-flex items-center gap-1" title="Topics">
          <ListTree className="size-3" aria-label="Topics" />
          {p.counts.visibleTopics}/{p.counts.topics}
        </span>
      </div>
    </div>
  );
}
