// "Mark Done" state.
//
// Semantics chosen deliberately:
//   - a page load restores dismissals, so closing the tab does not lose work
//   - pressing Refresh clears them, so anything still missing in W100 comes
//     back -- that is what makes the button mean what a volunteer expects
//
// Stored per aid station so two volunteers' stations never interfere.

const DISMISS_PREFIX = "w100diff:dismissed:v1:";
const STATION_KEY = "w100diff:station:v1";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Private browsing and some embedded webviews throw on access.
    return null;
  }
}

export function loadDismissed(w100StationId: number): Set<string> {
  const store = storage();
  if (!store) return new Set();
  try {
    const raw = store.getItem(DISMISS_PREFIX + w100StationId);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((k) => typeof k === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function saveDismissed(w100StationId: number, keys: Set<string>): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(DISMISS_PREFIX + w100StationId, JSON.stringify([...keys]));
  } catch {
    // Quota or a locked-down browser -- dismissals degrade to in-memory only.
  }
}

export function clearDismissed(w100StationId: number): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(DISMISS_PREFIX + w100StationId);
  } catch {
    /* ignore */
  }
}

export function loadRememberedStation(): number | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STATION_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function saveRememberedStation(w100StationId: number): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STATION_KEY, String(w100StationId));
  } catch {
    /* ignore */
  }
}
