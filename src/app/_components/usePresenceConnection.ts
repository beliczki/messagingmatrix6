"use client";

import { useEffect, useRef } from "react";

// Mounted once in AppShell. Owns a single EventSource('/api/events') for
// the tab. The SSE connection is the presence signal — server-side
// addConnection / removeConnection drive `live` in /api/users.
//
// Closes the connection on visibilitychange:hidden so a backgrounded tab
// stops counting as "live", and reopens on visible. Also reconnects on
// browser online/offline transitions.
export function usePresenceConnection(): void {
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    function open() {
      if (esRef.current) return;
      try {
        esRef.current = new EventSource("/api/events", { withCredentials: true });
      } catch {
        // EventSource may throw in some restricted contexts; presence simply
        // won't register, which is acceptable.
      }
    }

    function close() {
      const es = esRef.current;
      if (!es) return;
      es.close();
      esRef.current = null;
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
  }, []);
}
