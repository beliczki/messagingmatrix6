"use client";

import {
  X,
  Pencil,
  Copy,
  ArrowRightLeft,
  Trash2,
  Check,
} from "lucide-react";
import clsx from "clsx";
import { type Topic } from "./types";
import { type EditApi } from "./MatrixGrid";

export default function EditModePanel({
  editApi,
  topicNameByKey,
}: {
  editApi: EditApi;
  topicNameByKey: Map<string, Topic>;
}) {
  const selectedCount = editApi.selection.mcIds.size;
  const hasSelection = editApi.editMode && selectedCount > 0;
  const pending = editApi.pendingAction;
  const moveTargetReady =
    pending?.kind === "move" && pending.targetAudienceKeys.size === 1;
  const copyTargetReady =
    pending?.kind === "copy" && pending.targetAudienceKeys.size > 0;
  const applyReady = moveTargetReady || copyTargetReady;
  const selectedTopic =
    editApi.selection.topic && topicNameByKey.get(editApi.selection.topic);

  return (
    <div className="edit-mode-panel rounded-md border border-slate-200 bg-white p-3">
      <div className="edit-mode-panel__title text-[10px] font-medium uppercase tracking-wider text-slate-500">
        Edit mode
      </div>

      <div className="edit-mode-panel__hint mt-1 text-[10px] leading-snug text-slate-500">
        Add / duplicate topics and audiences; add, copy and move Messaging
        Cards.
      </div>

      <button
        type="button"
        onClick={() => editApi.setEditMode(!editApi.editMode)}
        title={editApi.editMode ? "Exit edit mode" : "Enter edit mode"}
        className={clsx(
          "edit-mode-panel__toggle mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded px-2 py-1 text-xs",
          editApi.editMode
            ? "edit-mode-panel__toggle--active bg-slate-900 text-white hover:bg-slate-800"
            : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
        )}
      >
        <Pencil className="size-3" />
        {editApi.editMode ? "Exit edit mode" : "Enter edit mode"}
      </button>

      {hasSelection ? (
        <div className="edit-mode-panel__selection mt-3 border-t border-slate-100 pt-3">
          <div className="edit-mode-panel__count text-[11px] font-semibold text-slate-700">
            {selectedCount} selected
            {selectedTopic ? (
              <span className="block text-[10px] font-normal text-slate-500">
                topic {selectedTopic.name}
              </span>
            ) : null}
          </div>

          {!pending ? (
            <div className="edit-mode-panel__actions mt-2 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => editApi.beginPending("copy")}
                className="selection-actions__btn selection-actions__btn--copy inline-flex items-center justify-center gap-1 rounded bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800"
              >
                <Copy className="size-3" />
                Copy
              </button>
              <button
                type="button"
                onClick={() => editApi.beginPending("move")}
                className="selection-actions__btn selection-actions__btn--move inline-flex items-center justify-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              >
                <ArrowRightLeft className="size-3" />
                Move
              </button>
              <button
                type="button"
                disabled
                title="Bulk delete — coming in v2"
                className="selection-actions__btn selection-actions__btn--delete inline-flex cursor-not-allowed items-center justify-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-400"
              >
                <Trash2 className="size-3" />
                Delete
              </button>
              <button
                type="button"
                onClick={editApi.clearSelection}
                className="selection-actions__btn selection-actions__btn--cancel inline-flex items-center justify-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              >
                <X className="size-3" />
                Cancel
              </button>
            </div>
          ) : (
            <div className="edit-mode-panel__pending mt-2 flex flex-col gap-1.5">
              <span className="selection-actions__pending text-[10px] text-slate-500">
                {pending.kind === "copy" ? "Copy" : "Move"} → pick{" "}
                {pending.kind === "move"
                  ? "1 audience column"
                  : "audience columns"}
              </span>
              <button
                type="button"
                onClick={editApi.applyPending}
                disabled={!applyReady || editApi.bulkBusy}
                className={clsx(
                  "selection-actions__btn selection-actions__btn--apply inline-flex items-center justify-center gap-1 rounded px-2 py-1 text-xs text-white",
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
                className="selection-actions__btn selection-actions__btn--cancel inline-flex items-center justify-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              >
                <X className="size-3" />
                Cancel
              </button>
            </div>
          )}
        </div>
      ) : null}

      {editApi.editMode && editApi.bulkError ? (
        <div className="edit-mode-panel__error mt-3 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] text-rose-700">
          {editApi.bulkError}
        </div>
      ) : null}
    </div>
  );
}
