"use client";

import { useEffect } from "react";
import { Archive, ShieldAlert, Trash2, X } from "lucide-react";
import ModalBackdrop from "../_components/ModalBackdrop";

// Removal chooser for an edit-mode selection. Two outcomes, not one: archive
// keeps the card (restorable via "Show archived"), delete drops the rows for
// good — the point is that throwaway PREVIEW copies don't have to silt up the
// archive. Measurement-locked rows (ACTIVE/INACTIVE/ARCHIVED) can only be
// archived, so the delete action turns off whenever the selection holds one.
type Props = {
  open: boolean;
  /** MC labels of the selection, e.g. ["MC290a", "MC290a", …]. */
  labels: string[];
  /** Selected rows that are measurement-locked, with the status that locks them. */
  locked: { label: string; status: string }[];
  busy: boolean;
  error: string | null;
  onArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export default function DeleteMcDialog({
  open,
  labels,
  locked,
  busy,
  error,
  onArchive,
  onDelete,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const lockedStatuses = [...new Set(locked.map((l) => l.status))].join(", ");

  return (
    <ModalBackdrop onClose={onClose} className="z-50 items-center justify-center">
      <div className="delete-mc-dialog modal m-auto flex w-full max-w-sm flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="modal__header flex shrink-0 items-center gap-2 border-b border-slate-100 px-5 py-3">
          <Trash2 className="size-4 text-slate-700" />
          <h2 className="modal__title text-sm font-semibold text-slate-900">
            Remove {labels.length} Messaging Card
            {labels.length === 1 ? "" : "s"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="modal__close ml-auto rounded p-1 text-slate-500 hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="modal__body flex-1 overflow-y-auto px-5 py-4">
          <div className="delete-mc-dialog__labels flex flex-wrap gap-1">
            {labels.map((label, i) => (
              <span
                key={`${label}-${i}`}
                className="delete-mc-dialog__label rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700"
              >
                {label}
              </span>
            ))}
          </div>

          {locked.length > 0 ? (
            <div className="delete-mc-dialog__locked mt-3 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800">
              <ShieldAlert className="mt-px size-3 shrink-0" />
              <span>
                {locked.length} row{locked.length === 1 ? "" : "s"} can only be
                archived ({lockedStatuses}) — a measured card&apos;s PMMID still
                anchors its reporting.
              </span>
            </div>
          ) : null}

          <div className="delete-mc-dialog__actions mt-3 flex flex-col gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={onArchive}
              className="delete-mc-dialog__action delete-mc-dialog__action--archive toolbar-btn--primary inline-flex items-center justify-center gap-1.5 rounded bg-slate-900 px-2 py-1.5 text-xs text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Archive className="size-3" />
              Archive (restorable)
            </button>
            <button
              type="button"
              disabled={busy || locked.length > 0}
              title={
                locked.length > 0
                  ? `${locked.length} selected row(s) are ${lockedStatuses} — archive them instead`
                  : undefined
              }
              onClick={onDelete}
              className="delete-mc-dialog__action delete-mc-dialog__action--delete inline-flex items-center justify-center gap-1.5 rounded bg-rose-600 px-2 py-1.5 text-xs text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="size-3" />
              Delete permanently
            </button>
            <button
              type="button"
              onClick={onClose}
              className="delete-mc-dialog__action delete-mc-dialog__action--cancel toolbar-btn inline-flex items-center justify-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
            >
              <X className="size-3" />
              Cancel
            </button>
          </div>

          {error ? (
            <div className="delete-mc-dialog__error mt-3 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] text-rose-700">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </ModalBackdrop>
  );
}
