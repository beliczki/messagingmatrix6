"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { todayUtc } from "@/lib/day-scope";

/**
 * Brings the dashboard up to date when its tab is looked at again.
 *
 * A dashboard tab is left open for hours, and nothing about a server-rendered
 * page updates on its own — so what you come back to is the render from
 * whenever you last touched it. Two different things are stale by then, and
 * only one of them is fixed by re-running the queries:
 *
 * - **The data**, which is what `router.refresh()` re-fetches. It re-renders
 *   the server components in place, so no full reload and no lost client state
 *   (the creative strip keeps the pages it has loaded).
 * - **The day itself.** The anchor lives in the URL (`?d=`), so a tab left open
 *   past midnight UTC keeps asking for yesterday's window — today's work is
 *   then genuinely outside it and refreshing the data changes nothing. That
 *   one needs the anchor rolled forward, which is a navigation, not a refresh.
 *
 * The remembered view already refuses to freeze a date for the same reason
 * (see `dashboard-view.ts`); this closes the gap for a tab that never
 * re-navigates. In-app navigation needs none of this — the page is
 * `force-dynamic` and Next's client router cache keeps dynamic segments for 0s.
 *
 * `visibilitychange` only: it is the event for "this tab is being looked at
 * again", and it fires once per switch. No interval — nothing here is waiting
 * for time to pass, it is waiting for you to come back.
 */
export default function DashboardLiveRefresh() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const anchor = params.get("d");
      const today = todayUtc();
      if (anchor && anchor < today) {
        const next = new URLSearchParams(params.toString());
        next.set("d", today);
        router.replace(`/?${next.toString()}`);
        return;
      }
      router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router, params]);

  return null;
}
