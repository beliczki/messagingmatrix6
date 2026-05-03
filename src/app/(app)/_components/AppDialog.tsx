"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Visible label for the dialog (used as the X-button aria-label only). */
  ariaLabel: string;
  children: ReactNode;
};

export default function AppDialog({ open, onClose, ariaLabel, children }: Props) {
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
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-stretch bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="app-dialog modal relative m-auto flex h-[90vh] w-[90vw] max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${ariaLabel}`}
          className="modal__close absolute right-3 top-3 z-10 rounded p-1.5 text-slate-500 hover:bg-slate-100"
        >
          <X className="size-5" />
        </button>
        {children}
      </div>
    </div>
  );
}
