// The one piece of state that outlives a page load: which aid station you are
// standing at.
//
// Nothing else is persisted, and that is deliberate. "Mark done" used to be
// stored per station in localStorage, which meant two volunteers entering
// times from two phones each saw their own idea of what was finished and
// neither saw the other's. A reload now starts from what Tracer and W100
// actually say, which is the only thing both devices agree on.

const STATION_KEY = "w100diff:station:v1";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Private browsing and some embedded webviews throw on access.
    return null;
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
