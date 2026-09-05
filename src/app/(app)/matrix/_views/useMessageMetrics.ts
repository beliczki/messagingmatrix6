"use client";

import { useQuery } from "@tanstack/react-query";
import type { MessageMetrics } from "@/lib/sankey-metrics";

export type { MessageMetrics };

/**
 * Per-message delivery for one report period.
 *
 * One query key, one shape, one cache entry — the sankey canvas reads it for the
 * ribbon weights and the toolbar panel reads it for the period list and the
 * coverage line, and neither refetches on the other's behalf.
 */
export function useMessageMetrics(period: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["monitoring", "message-metrics", period ?? "latest"],
    queryFn: async (): Promise<MessageMetrics> => {
      const qs = period ? `?period=${encodeURIComponent(period)}` : "";
      const r = await fetch(`/api/monitoring/message-metrics${qs}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`metrics ${r.status}`);
      return r.json();
    },
    enabled,
  });
}

/** Compact for a canvas label, full for a tooltip. */
export function formatMetric(
  value: number,
  metric: "messages" | "impressions" | "cost",
  compact = false,
): string {
  if (metric === "messages") return String(Math.round(value));
  if (metric === "cost") {
    return compact
      ? `${new Intl.NumberFormat("hu-HU", { notation: "compact", maximumFractionDigits: 1 }).format(value)} Ft`
      : `${new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0 }).format(value)} Ft`;
  }
  return compact
    ? new Intl.NumberFormat("hu-HU", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value)
    : new Intl.NumberFormat("hu-HU").format(value);
}

/** "01/08/2026 00:00:00" → "2026-08". */
export function periodLabel(periodFrom: string): string {
  const m = periodFrom.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}` : periodFrom;
}
