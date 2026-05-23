"use client";

import { useRef, type ReactNode } from "react";
import clsx from "clsx";

type Props = {
  onClose: () => void;
  /**
   * Per-dialog layout/z-index utilities, e.g. "z-50 items-stretch" or
   * "z-[100] items-center justify-center p-4". The invariant backdrop look
   * (fixed inset-0, flex, tint, blur) is baked in.
   */
  className?: string;
  /** Optional ARIA role for the backdrop element (e.g. "presentation"). */
  role?: string;
  children: ReactNode;
};

// Shared dialog backdrop. Closes only on a click that both STARTS and ENDS on
// the bare backdrop itself. A text selection dragged out of an input onto the
// backdrop no longer closes the dialog: the `click` event targets the lowest
// common ancestor of mousedown+mouseup (the backdrop), but the press began
// inside the panel, so `pressedSelf` is false and onClose is skipped.
export default function ModalBackdrop({
  onClose,
  className,
  role,
  children,
}: Props) {
  const pressedSelf = useRef(false);
  return (
    <div
      role={role}
      className={clsx(
        "modal-backdrop fixed inset-0 flex bg-slate-900/40 backdrop-blur-sm",
        className,
      )}
      onMouseDown={(e) => {
        pressedSelf.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedSelf.current && e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}
