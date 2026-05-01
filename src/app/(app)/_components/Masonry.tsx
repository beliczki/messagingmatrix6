"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Row-first masonry: adjacent items land in adjacent columns (item 0 → col 0,
// item 1 → col 1, …) instead of stacking vertically inside one column. We
// distribute items round-robin into N flex columns so each column keeps the
// natural masonry effect (variable-height tiles), but the reading order across
// columns matches the input order. Switch to virtualized rows when len > 500
// (deferred — v6 spec lists this as the cutover point).

// Tailwind breakpoints: sm 640, md 768, lg 1024, xl 1280. Largest first.
const AUTO_BREAKPOINTS: Array<[number, number]> = [
  [1280, 5],
  [1024, 4],
  [768, 3],
  [640, 2],
  [0, 1],
];

function useAutoColumnCount(ref: React.RefObject<HTMLElement | null>) {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const w = el.clientWidth;
      for (const [bp, n] of AUTO_BREAKPOINTS) {
        if (w >= bp) {
          setCount(n);
          return;
        }
      }
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return count;
}

export function Masonry<T>({
  items,
  render,
  cols = "auto",
}: {
  items: T[];
  render: (item: T) => ReactNode;
  cols?: "auto" | 1 | 2 | 3 | 4 | 5;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoCount = useAutoColumnCount(containerRef);
  const colCount = cols === "auto" ? autoCount : cols;

  const columns: T[][] = Array.from({ length: colCount }, () => []);
  for (let i = 0; i < items.length; i++) {
    columns[i % colCount]!.push(items[i]!);
  }

  return (
    <div ref={containerRef} className="masonry flex gap-3">
      {columns.map((col, ci) => (
        <div
          key={ci}
          className="masonry__column flex min-w-0 flex-1 flex-col gap-3"
        >
          {col.map((item, i) => (
            <div key={i} className="masonry__item">
              {render(item)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
