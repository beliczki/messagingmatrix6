"use client";

import { useEffect } from "react";
import { Archive, ShieldAlert, Trash2, TriangleAlert, X } from "lucide-react";
import ModalBackdrop from "../_components/ModalBackdrop";

// Removal chooser for an edit-mode selection. Two things it has to get right:
//
//  * A selected cell is one AUDIENCE COPY of a card, not the card. MC290a can
//    sit in 32 audiences; deleting 4 of them leaves the card alive. So the
//    dialog counts per card ("4 of 32 audience copies"), never "4 cards".
//  * A card's content only dies with its LAST copy — that group gets an
//    explicit warning, because a purge there is the irreversible one.
//
// Measurement-locked rows (ACTIVE/INACTIVE/ARCHIVED) can only be archived, so
// the delete action turns off whenever the selection holds one.
type Props = {
  open: boolean;
  /** Number of selected cells (= audience copies), not cards. */
  count: number;
  /** Selection grouped per card: how many of its copies are selected, of how many. */
  groups: { label: string; topic: string; selected: number; total: number }[];
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
  count,
  groups,
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
  const lastCopies = groups.filter((g) => g.selected >= g.total);

  return (
    <ModalBackdrop onClose={onClose} className="z-50 items-center justify-center">
      <div className="delete-mc-dialog modal m-auto flex w-full max-w-sm flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="modal__header flex shrink-0 items-center gap-2 border-b border-slate-100 px-5 py-3">
          <Trash2 className="size-4 text-slate-700" />
          <h2 className="modal__title text-sm font-semibold text-slate-900">
            Remove {count} audience cop{count === 1 ? "y" : "ies"}
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
          <p className="delete-mc-dialog__hint text-[10px] leading-snug text-slate-500">
            This removes the selected cells — the card&apos;s placements in those
            audiences. The card itself lives on in its remaining copies.
          </p>

          <div className="delete-mc-dialog__groups mt-3 flex flex-col gap-1">
            {groups.map((g) => {
              const isLast = g.selected >= g.total;
              return (
                <div
                  key={`${g.label}-${g.topic}`}
                  className="delete-mc-dialog__group flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5"
                >
                  <span className="delete-mc-dialog__label rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                    {g.label}
                  </span>
                  <span className="delete-mc-dialog__count text-[10px] text-slate-600">
                    {g.selected} of {g.total} audience cop
                    {g.total === 1 ? "y" : "ies"}
                  </span>
                  {isLast ? (
                    <span className="delete-mc-dialog__last status-badge ml-auto rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-700">
                      last copy
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          {lastCopies.length > 0 ? (
            <div className="delete-mc-dialog__warning mt-3 flex items-start gap-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] leading-relaxed text-rose-700">
              <TriangleAlert className="mt-px size-3 shrink-0" />
              <span>
                {lastCopies.map((g) => g.label).join(", ")}: the selection holds
                the last copy, so a permanent delete takes the card&apos;s
                content (texts, images, trafficking) with it. Archive keeps it
                restorable.
              </span>
            </div>
          ) : null}

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
