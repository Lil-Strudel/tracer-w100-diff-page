// Tracer station <-> W100 aid station mapping.
//
// Verified against both live APIs: Tracer numbers its 16 stations 0..15 and
// W100 numbers the same 16 as AidStationID 1..16, in the same order, with
// matching names. Tracer also encodes the W100 id in stationNumberDisplayed --
// "(P)(16)" for FINISH -- which is used as a cross-check.
//
// Distances are NOT compared: Tracer lists BIG WATER at 56.4mi where W100 says
// 52.9, and that discrepancy is not a mapping error.

import type { Station } from "./tracer";
import type { W100Station } from "./w100";

export interface MappedStation {
  tracerId: string;
  tracerName: string;
  stationNumber: number;
  w100Id: number;
  /** W100's name for the station, when the W100 station list was reachable. */
  w100Name?: string;
  /** True when W100 cannot return times for this station at all. */
  queryable: boolean;
}

/** W100 rejects /aid-station/1/times with 400 -- START is not queryable. */
const NON_QUERYABLE_W100_IDS = new Set([1]);

export function w100IdForStation(station: Station): number {
  return station.stationNumber + 1;
}

/** Pulls the trailing "(16)" out of a stationNumberDisplayed like "(P)(16)". */
export function displayedW100Id(station: Station): number | null {
  const groups = station.stationNumberDisplayed?.match(/\((\d+)\)/g);
  if (!groups || groups.length === 0) return null;
  const last = groups[groups.length - 1];
  const n = Number(last.slice(1, -1));
  return Number.isFinite(n) ? n : null;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Tracer abbreviates where W100 spells out -- "BIG MTN" vs "Big Mountain
 * Pass", "DECKER CYN" vs "Decker Canyon" -- so a plain substring test raises
 * false alarms. The authoritative mapping is the ordinal plus the id Tracer
 * encodes in stationNumberDisplayed; this is only a sanity check, so it
 * accepts a shared leading word as well as containment.
 */
function namesLookLikeTheSameStation(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const firstWord = (s: string) => normalizeName(s.split(/[^A-Za-z0-9]+/).filter(Boolean)[0] ?? "");
  const fa = firstWord(a);
  const fb = firstWord(b);
  return fa.length > 0 && fa === fb;
}

export interface MappingResult {
  stations: MappedStation[];
  /** Human-readable problems worth showing the user, empty when all is well. */
  warnings: string[];
}

export function mapStations(
  tracerStations: Station[],
  w100Stations: W100Station[] | null,
): MappingResult {
  const warnings: string[] = [];
  const ordered = [...tracerStations].sort((a, b) => a.stationNumber - b.stationNumber);
  const w100ById = new Map((w100Stations ?? []).map((s) => [s.AidStationID, s]));

  if (w100Stations && w100Stations.length !== ordered.length) {
    warnings.push(
      `Tracer lists ${ordered.length} stations but W100 lists ${w100Stations.length}.`,
    );
  }

  const stations = ordered.map((station) => {
    const w100Id = w100IdForStation(station);
    const displayed = displayedW100Id(station);
    if (displayed !== null && displayed !== w100Id) {
      warnings.push(
        `${station.name}: Tracer shows "${station.stationNumberDisplayed}" but maps to W100 id ${w100Id}.`,
      );
    }
    const match = w100ById.get(w100Id);
    if (w100Stations && !match) {
      warnings.push(`${station.name}: no W100 aid station with id ${w100Id}.`);
    }
    if (match && !namesLookLikeTheSameStation(station.name, match.AidStationName)) {
      warnings.push(
        `Station ${w100Id}: Tracer calls it "${station.name}", W100 calls it "${match.AidStationName}".`,
      );
    }
    return {
      tracerId: station.id,
      tracerName: station.name,
      stationNumber: station.stationNumber,
      w100Id,
      w100Name: match?.AidStationName,
      queryable: !NON_QUERYABLE_W100_IDS.has(w100Id),
    };
  });

  return { stations, warnings };
}
