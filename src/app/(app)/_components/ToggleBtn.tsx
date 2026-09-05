"use client";

import clsx from "clsx";

// One segment of a `toggle-group`. Shared by the matrix View/Density controls
// and the right toolbar's Export switch so the two read as the same control.
export default function ToggleBtn({
  active,
  onClick,
  children,
  title,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      className={clsx(
        "toggle-btn flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1",
        active
          ? "toggle-btn--active bg-slate-900 text-white"
          : "text-slate-700 hover:bg-slate-100",
      )}
    >
      {children}
    </button>
  );
}
