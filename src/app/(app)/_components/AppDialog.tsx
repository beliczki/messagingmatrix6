"use client";

import { useEffect, type ReactNode } from "react";
import { Icon } from "@/app/_icons/Icon";
import ModalBackdrop from "./ModalBackdrop";

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
    <ModalBackdrop onClose={onClose} className="z-50 items-stretch">
      <div className="app-dialog modal relative m-auto flex h-[90vh] w-[90vw] max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        {/* Floating, because the dialog does not own its header — but every
            header it hosts is the house `h-12` toolbar band, so the button is
            centred in that band (`top-0 h-12`) rather than pinned a few pixels
            below it. That is what puts it on one line with the header's own
            buttons. */}
        <div className="app-dialog__close absolute right-3 top-0 z-10 flex h-12 items-center">
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${ariaLabel}`}
            className="modal__close rounded p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <Icon name="close" className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </ModalBackdrop>
  );
}
