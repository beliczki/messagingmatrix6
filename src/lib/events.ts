// In-process pub/sub for SSE broadcasts. Spec §4.11.
// Single-process v6 deployment (spec §1.3), so module-level state is fine.

export type BroadcastEvent = {
  entity: string;
  ids: Array<number | string>;
  action: string;
  byUser: string | null;
};

type Listener = (e: BroadcastEvent) => void;

const subscribers = new Map<number, Set<Listener>>();

export function subscribe(clientId: number, fn: Listener): () => void {
  let set = subscribers.get(clientId);
  if (!set) {
    set = new Set();
    subscribers.set(clientId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) subscribers.delete(clientId);
  };
}

export function broadcast(clientId: number, event: BroadcastEvent): void {
  const set = subscribers.get(clientId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch {
      // A failing subscriber must not block the rest.
    }
  }
}

// Test-only — clear all subscribers between integration tests.
export function _resetSubscribersForTests() {
  subscribers.clear();
}
