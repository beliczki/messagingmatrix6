"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

// Mounted once in AppShell. Owns a single EventSource('/api/events') for the
// tab. The connection serves two purposes (spec §4.11):
//  1. Presence — server-side addConnection / removeConnection drive `live`
//     in /api/users.
//  2. Live sync — each broadcast `message` carries the written entity type;
//     we invalidate the matching TanStack Query key so a peer write refreshes
//     this tab immediately, instead of leaving it stale until the next save.
//
// Closes the connection on visibilitychange:hidden so a backgrounded tab
// stops counting as "live", and reopens on visible. Also reconnects on
// browser online/offline transitions. SSE does not replay events missed
// while disconnected, so a re-open refetches everything to catch up.
export function usePresenceConnection(): void {
  const esRef = useRef<EventSource | null>(null);
  // True once the connection has been closed at least once — so the next
  // open() knows it is a re-open and must catch up on missed events.
  const wasClosed = useRef(false);
  const qc = useQueryClient();

  useEffect(() => {
    function open() {
      if (esRef.current) return;
      try {
        esRef.current = new EventSource("/api/events", { withCredentials: true });
      } catch {
        // EventSource may throw in some restricted contexts; presence simply
        // won't register, which is acceptable.
        return;
      }
      // The `hello` frame carries an explicit `event:` line so it dispatches
      // as a typed event — only broadcast frames reach `onmessage`.
      esRef.current.onmessage = (ev) => {
        const data = JSON.parse(ev.data) as { entity?: string };
        if (data.entity) {
          qc.invalidateQueries({ queryKey: [data.entity] });
        }
      };
      // Re-opening after the tab was hidden / went offline: peer writes that
      // landed while we were disconnected were never delivered, so this tab
      // is stale. Refetch all active queries. Skipped on the first mount —
      // the queries fetch on their own then.
      if (wasClosed.current) {
        wasClosed.current = false;
        qc.invalidateQueries();
      }
    }

    function close() {
      const es = esRef.current;
      if (!es) return;
      es.close();
      esRef.current = null;
      wasClosed.current = true;
    }

    function onVisibility() {
      if (document.visibilityState === "visible") open();
      else close();
    }

    function onOnline() {
      if (document.visibilityState === "visible") open();
    }

    function onOffline() {
      close();
    }

    if (document.visibilityState === "visible") open();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      close();
    };
  }, [qc]);
}
