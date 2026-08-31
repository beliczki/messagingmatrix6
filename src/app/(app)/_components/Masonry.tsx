"use client";

import { useEffect, useRef, useState, type Key, type ReactNode } from "react";

// Row-first masonry: adjacent items land in adjacent columns (item 0 → col 0,
// item 1 → col 1, …) instead of stacking vertically inside one column. We
// distribute items round-robin into N flex columns so each column keeps the
// natural masonry effect (variable-height tiles), but the reading order across
// columns matches the input order. Switch to virtualized rows when len > 500
// (deferred — v6 spec lists this as the cutover point).
//
// Round-robin holds the reading order but says nothing about balance: with
// mixed aspect ratios one column can end up several times taller than the next.
// Callers that care more about a flush bottom edge than about strict reading
// order pass `estimateHeight` and get shortest-column-first packing instead.

// Tailwind breakpoints: sm 640, md 768, lg 1024, xl 1280. Largest first.
const AUTO_BREAKPOINTS: Array<[number, number]> = [
  [1280, 5],
  [1024, 4],
  [768, 3],
  [640, 2],
  [0, 1],
];

// Container width drives both the column count and (for balanced packing) the
// column width the height estimate is measured against, so it is one observer.
function useContainerWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => setWidth(el.clientWidth);
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function columnCountFor(width: number): number {
  for (const [bp, n] of AUTO_BREAKPOINTS) if (width >= bp) return n;
  return 1;
}

// `itemKey` is required-in-spirit: callers must supply a stable per-item key.
// Without it React diffs masonry tiles positionally, so any list change (filter
// toggle, sort, etc.) reuses the same component instance for a *different*
// item and stateful children (e.g. iframe previews that lazy-init their html
// from a per-message cache) keep the previous item's render. Falls back to the
// positional index only as a last resort for callers that genuinely have no id.
export function Masonry<T>({
  items,
  render,
  itemKey,
  cols = "auto",
  estimateHeight,
}: {
  items: T[];
  render: (item: T) => ReactNode;
  itemKey?: (item: T, index: number) => Key;
  cols?: "auto" | 1 | 2 | 3 | 4 | 5;
  /**
   * Opt-in balanced packing: return the height (px) the item will occupy at
   * `colWidth`, and each item goes into the currently shortest column instead
   * of the next one round-robin. Callers that know an item's aspect ratio up
   * front (a banner size, an image's stored dimensions) can hand it over before
   * anything loads, which is what keeps columns from ending ragged. The
   * estimate only picks a column — a wrong number costs balance, never
   * correctness — so a rough figure for items of unknown shape is fine.
   */
  estimateHeight?: (item: T, colWidth: number) => number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(containerRef);
  const colCount = cols === "auto" ? columnCountFor(containerWidth) : cols;
  // Matches the gap-3 (0.75rem) between and inside columns below.
  const GAP = 12;
  const colWidth =
    containerWidth > 0
      ? (containerWidth - GAP * (colCount - 1)) / colCount
      : 0;

  const columns: Array<Array<{ item: T; key: Key }>> = Array.from(
    { length: colCount },
    () => [],
  );
  if (estimateHeight && colWidth > 0) {
    const heights = new Array<number>(colCount).fill(0);
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      let shortest = 0;
      for (let c = 1; c < colCount; c++) {
        if (heights[c]! < heights[shortest]!) shortest = c;
      }
      columns[shortest]!.push({ item, key: itemKey ? itemKey(item, i) : i });
      heights[shortest]! +=
        Math.max(0, estimateHeight(item, colWidth)) +
        (columns[shortest]!.length > 1 ? GAP : 0);
    }
  } else {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      columns[i % colCount]!.push({ item, key: itemKey ? itemKey(item, i) : i });
    }
  }

  return (
    <div ref={containerRef} className="masonry flex gap-3">
      {columns.map((col, ci) => (
        <div
          key={ci}
          className="masonry__column flex min-w-0 flex-1 flex-col gap-3"
        >
          {col.map(({ item, key }) => (
            <div key={key} className="masonry__item">
              {render(item)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
