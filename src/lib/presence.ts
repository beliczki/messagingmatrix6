// In-memory presence registry. Single-process by design (see plan).
// Keyed by userId. A user is "live" while they have at least one open
// SSE connection. A short grace window on removeConnection prevents flicker
// during refreshes / SPA navigations.

const GRACE_MS = 8_000;

type Entry = {
  connections: Set<string>;
  lastSeen: number;
  pendingRemoval: ReturnType<typeof setTimeout> | null;
};

const byUser = new Map<string, Entry>();

function getOrCreate(userId: string): Entry {
  let e = byUser.get(userId);
  if (!e) {
    e = { connections: new Set(), lastSeen: Date.now(), pendingRemoval: null };
    byUser.set(userId, e);
  }
  return e;
}

export function addConnection(userId: string, connectionId: string): void {
  const e = getOrCreate(userId);
  if (e.pendingRemoval) {
    clearTimeout(e.pendingRemoval);
    e.pendingRemoval = null;
  }
  e.connections.add(connectionId);
  e.lastSeen = Date.now();
}

export function removeConnection(userId: string, connectionId: string): void {
  const e = byUser.get(userId);
  if (!e) return;
  e.connections.delete(connectionId);
  e.lastSeen = Date.now();
  if (e.connections.size === 0) {
    if (e.pendingRemoval) clearTimeout(e.pendingRemoval);
    e.pendingRemoval = setTimeout(() => {
      const cur = byUser.get(userId);
      if (cur && cur.connections.size === 0) {
        // Keep the entry so getLastSeen still works; just clear the
        // pending-removal handle. Connections set already empty.
        cur.pendingRemoval = null;
      }
    }, GRACE_MS);
  }
}

export function isLive(userId: string): boolean {
  const e = byUser.get(userId);
  if (!e) return false;
  if (e.connections.size > 0) return true;
  // In the grace window, treat as live so quick refreshes don't flicker.
  return e.pendingRemoval !== null;
}

export function getLastSeen(userId: string): number | null {
  const e = byUser.get(userId);
  return e ? e.lastSeen : null;
}
