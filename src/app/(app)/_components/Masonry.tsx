"use client";

import type { ReactNode } from "react";

// CSS-column masonry. Spec §6.4 — `column-count` + `break-inside: avoid` on
// cards. Switch to virtualized rows when len > 500 (deferred to Phase 6
// follow-up; v6 spec lists this as the cutover point).
export function Masonry<T>({
  items,
  render,
  cols = "auto",
}: {
  items: T[];
  render: (item: T) => ReactNode;
  cols?: "auto" | 1 | 2 | 3 | 4 | 5;
}) {
  const colClass =
    cols === "auto"
      ? "columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5"
      : cols === 1
        ? "columns-1"
        : cols === 2
          ? "columns-2"
          : cols === 3
            ? "columns-3"
            : cols === 4
              ? "columns-4"
              : "columns-5";
  return (
    <div className={`masonry ${colClass} gap-3`}>
      {items.map((item, i) => (
        <div key={i} className="masonry__item mb-3 break-inside-avoid">
          {render(item)}
        </div>
      ))}
    </div>
  );
}
