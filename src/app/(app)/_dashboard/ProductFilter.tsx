"use client";

import { useRouter } from "next/navigation";
import MultiPill, { ALL_NONE_QUICK_SELECT } from "../_components/MultiPill";

// The dashboard's scope lives in the URL (the page is a server component), so
// the product pill writes there too — a filtered view stays linkable and
// survives a reload, like the day scope beside it.
export default function ProductFilter({
  options,
  counts,
  labels,
  selected,
  query,
}: {
  options: string[];
  /** [DCO cells, nonDCO cells, creatives] per product, whole library. */
  counts: Record<string, number[]>;
  /** Names for those segments, in the same order. */
  labels: string[];
  selected: string[];
  /** The scope params to keep while the product selection changes. */
  query: { d: string; r: string };
}) {
  const router = useRouter();
  return (
    <MultiPill
      label="Product"
      values={new Set(selected)}
      options={options}
      optionCounts={counts}
      countLabels={labels}
      quickSelect={ALL_NONE_QUICK_SELECT}
      onChange={(next) => {
        const params = new URLSearchParams({ d: query.d, r: query.r });
        if (next.size > 0) params.set("p", [...next].join(","));
        router.push(`/?${params.toString()}`);
      }}
    />
  );
}
