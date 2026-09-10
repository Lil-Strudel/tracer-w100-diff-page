// Tracer stores times as ISO 8601 UTC instants; volunteers need Mountain
// wall-clock. Intl handles the DST boundary correctly regardless of what
// timezone the viewer's device is in.
//
// Note: tracer-time-sync/apps/api/src/index.ts has a hand-rolled
// `formatUtahTime` that mixes the local-time Date constructor with setUTC*.
// It is wrong off Mountain time and is deliberately not reused here.

const RACE_TIME_ZONE = "America/Denver";

const hhmmss = new Intl.DateTimeFormat("en-US", {
  timeZone: RACE_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const weekdayOnly = new Intl.DateTimeFormat("en-US", {
  timeZone: RACE_TIME_ZONE,
  weekday: "short",
});

const withDay = new Intl.DateTimeFormat("en-US", {
  timeZone: RACE_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** "14:07:33" in race-local time, or null for an unparseable input. */
export function formatRaceTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // en-US with hour12:false renders midnight as "24", which reads as a bug.
  return hhmmss.format(date).replace(/^24:/, "00:");
}

/** "Fri 14:07:33" -- used where the day matters, e.g. a 36-hour race. */
export function formatRaceTimeWithDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return withDay.format(date).replace(/(\s)24:/, "$100:");
}

/** "Fri" -- the race runs past midnight, so the day disambiguates a time. */
export function weekday(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return weekdayOnly.format(date);
}

export function formatClockNow(): string {
  return formatRaceTime(new Date().toISOString()) ?? "";
}
