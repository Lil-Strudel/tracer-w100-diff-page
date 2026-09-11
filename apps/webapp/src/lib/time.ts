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

/**
 * Volunteers read these off a phone, so the seconds only earn their place when
 * they carry information: a time recorded on the minute renders as "14:07".
 */
function dropZeroSeconds(formatted: string): string {
  return formatted.replace(/:00$/, "");
}

/** "14:07:33", or "14:07" on the minute; null for an unparseable input. */
export function formatRaceTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // en-US with hour12:false renders midnight as "24", which reads as a bug.
  return dropZeroSeconds(hhmmss.format(date).replace(/^24:/, "00:"));
}

/** "Fri 14:07:33" -- used where the day matters, e.g. a 36-hour race. */
export function formatRaceTimeWithDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return dropZeroSeconds(withDay.format(date).replace(/(\s)24:/, "$100:"));
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
