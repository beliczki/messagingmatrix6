"use client";

import { useEffect } from "react";
import { DASHBOARD_VIEW_COOKIE } from "@/lib/dashboard-view";

/** A year: long enough that the dashboard keeps its shape between campaigns. */
const MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Writes the current dashboard view to a cookie so a bare `/` can restore it.
 *
 * A cookie and not localStorage because the reader is the server component
 * itself — see `dashboard-view.ts`. All the encoding happens on the server; this
 * only stores the string it is handed, and rewrites it only when it changes.
 */
export default function RememberView({ value }: { value: string }) {
  useEffect(() => {
    document.cookie = `${DASHBOARD_VIEW_COOKIE}=${encodeURIComponent(
      value,
    )}; path=/; max-age=${MAX_AGE}; samesite=lax`;
  }, [value]);
  return null;
}
