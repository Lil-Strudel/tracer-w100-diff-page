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

/** Month abbreviations as W100 spells them in RaceStartTime. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Parses W100's race start -- "Friday, 11-Sep-26 05:00:00 MDT" -- to epoch ms.
 *
 * Tracer's `event.startDate` is deliberately NOT used for this: the live
 * w100-26 event reads 2026-09-11T06:00:00Z, five hours before the 05:00 MDT
 * gun, so comparing against it would mark every time misaligned.
 *
 * The zone abbreviation carries the offset, which is why it is read rather
 * than inferred: Mountain is UTC-6 on MDT and UTC-7 on MST, and the Wasatch
 * runs close enough to the November switch to make that worth honouring.
 */
export function parseRaceStart(raceStartTime: string | null | undefined): number | null {
  if (!raceStartTime) return null;
  const m = raceStartTime.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+(MDT|MST)/);
  if (!m) return null;
  const month = MONTHS.findIndex((name) => name.toLowerCase() === m[2].toLowerCase());
  if (month < 0) return null;
  const offsetHours = m[7] === "MDT" ? 6 : 7;
  return Date.UTC(
    2000 + Number(m[3]),
    month,
    Number(m[1]),
    Number(m[4]) + offsetHours,
    Number(m[5]),
    Number(m[6]),
  );
}

/** Whole seconds from race start, in the same units as W100's Elapsed* fields. */
export function elapsedSeconds(iso: string, raceStartMs: number): number {
  return Math.round((Date.parse(iso) - raceStartMs) / 1000);
}

/** Renders a W100 elapsed value as race-local wall clock, the way Tracer's is. */
export function formatElapsed(elapsed: number | null, raceStartMs: number | null): string | null {
  if (elapsed === null || raceStartMs === null) return null;
  return formatRaceTime(new Date(raceStartMs + elapsed * 1000).toISOString());
}
