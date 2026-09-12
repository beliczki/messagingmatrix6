"use client";

import { useEffect } from "react";
import type { BroadcastEvent } from "@/lib/events";

// The tab has exactly ONE EventSource, owned by usePresenceConnection — a
// second one would register a second presence connection and show the user as
// live twice. So components that need to SEE broadcast frames (rather than just
// have their queries invalidated) subscribe here, and the hook forwards every
// frame it parses.

type Handler = (e: BroadcastEvent) => void;

const handlers = new Set<Handler>();

/** Called by usePresenceConnection for every broadcast frame it receives. */
export function publishBroadcast(e: BroadcastEvent): void {
  for (const h of handlers) {
    try {
      h(e);
    } catch {
      // A failing subscriber must not cost the others their frame.
    }
  }
}

/** Subscribe to the broadcast frames of one entity for the life of the component. */
export function useBroadcastEvents(entity: string, fn: Handler): void {
  useEffect(() => {
    const handler: Handler = (e) => {
      if (e.entity === entity) fn(e);
    };
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }, [entity, fn]);
}
