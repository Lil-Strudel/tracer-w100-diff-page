// What outlives a page load: the aid station you are standing at, and the
// answers W100 gave to the per-runner Check button.
//
// "Mark done" is pointedly NOT here. It used to be, and it meant two
// volunteers entering times from two phones each saw their own idea of what
// was finished and neither saw the other's. A reload starts that from what
// Tracer and W100 actually say, which is the only thing both devices agree on.
//
// A check result is a different kind of thing: not one volunteer's opinion but
// a fact W100 reported, and re-fetching it a bib at a time after every reload
// is exactly the work the button exists to avoid. It is kept per station and
// stamped with when it was taken, because it can go stale -- pressing Check
// again overwrites it.

const STATION_KEY = "w100diff:station:v1";
const CHECKS_PREFIX = "w100diff:checks:v1:";

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

/** A settled Check result, as stored. `at` is when W100 was asked. */
export interface StoredCheck {
  /**
   * Whether anyone still has to do something about this runner. Held
   * separately from `tone` so the grouping does not quietly depend on a colour
   * choice: a future verdict could be green and still be work.
   */
  verdict: "entered" | "action";
  tone: "good" | "warn";
  message: string;
  at: string;
}

export function loadChecks(w100StationId: number): Record<string, StoredCheck> {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(CHECKS_PREFIX + w100StationId);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, StoredCheck> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = value as Partial<StoredCheck>;
      // Anything hand-edited or written by an older build is dropped rather
      // than rendered: a malformed note is worse than no note.
      if ((v?.tone === "good" || v?.tone === "warn") && typeof v.message === "string") {
        out[key] = {
          // Results written before verdicts existed are read back off the tone,
          // which was one-to-one with it -- so an upgrade costs no re-checks.
          verdict: v.verdict === "entered" || v.verdict === "action" ? v.verdict : v.tone === "good" ? "entered" : "action",
          tone: v.tone,
          message: v.message,
          at: typeof v.at === "string" ? v.at : "",
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveChecks(
  w100StationId: number,
  checks: Record<string, StoredCheck>,
): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(CHECKS_PREFIX + w100StationId, JSON.stringify(checks));
  } catch {
    // Quota or a locked-down browser -- results degrade to in-memory only.
  }
}
