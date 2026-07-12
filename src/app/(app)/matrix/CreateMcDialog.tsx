"use client";

import { useEffect } from "react";
import { Plus, SquarePlus, X } from "lucide-react";
import ModalBackdrop from "../_components/ModalBackdrop";

// Occupied-cell "+ new" chooser: a cell may hold multiple MC numbers
// (creative generations), so the user picks which number gets the next
// variant — or mints a brand-new number in the cell.
type Props = {
  open: boolean;
  audience: string;
  topic: string;
  /** Distinct live MC numbers in the cell, ascending. */
  numbers: number[];
  busy: boolean;
  error: string | null;
  onPick: (choice: number | "new") => void;
  onClose: () => void;
};

export default function CreateMcDialog({
  open,
  audience,
  topic,
  numbers,
  busy,
  error,
  onPick,
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

  return (
    <ModalBackdrop onClose={onClose} className="z-50 items-center justify-center">
      <div className="create-mc-dialog modal m-auto flex w-full max-w-xs flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="modal__header flex shrink-0 items-center gap-2 border-b border-slate-100 px-5 py-3">
          <Plus className="size-4 text-slate-700" />
          <h2 className="modal__title text-sm font-semibold text-slate-900">
            New MC in this cell
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
          <p className="create-mc-dialog__cell text-[10px] uppercase tracking-wider text-slate-500">
            {topic} / {audience}
          </p>
          <div className="create-mc-dialog__options mt-3 flex flex-col gap-1.5">
            {numbers.map((n) => (
              <button
                key={n}
                type="button"
                disabled={busy}
                onClick={() => onPick(n)}
                className="create-mc-dialog__option toolbar-btn inline-flex items-center justify-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="size-3" />
                New variant of MC{n}
              </button>
            ))}
            <div className="create-mc-dialog__divider my-1 border-t border-slate-100" />
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick("new")}
              className="create-mc-dialog__option create-mc-dialog__option--new toolbar-btn--primary inline-flex items-center justify-center gap-1.5 rounded bg-slate-900 px-2 py-1.5 text-xs text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SquarePlus className="size-3" />
              New MC number
            </button>
          </div>
          {error ? (
            <div className="create-mc-dialog__error mt-3 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] text-rose-700">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </ModalBackdrop>
  );
}
