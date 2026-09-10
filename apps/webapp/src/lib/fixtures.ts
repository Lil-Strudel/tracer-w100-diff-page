// Helpers shared by the two cross-mock configs.

import type { Entry, Participant, Station } from "./tracer";

/**
 * An arbitrary base instant for synthetic Tracer times.
 *
 * The diff compares key *presence*, never time values, so synthetic entries do
 * not need to correspond to W100's elapsed seconds. That deliberately avoids
 * having to parse W100's "Tuesday, 28-Jul-26 05:00:00 MDT" race-start format.
 */
const BASE_MS = Date.parse("2026-09-11T12:00:00.000Z");

export function isoAt(offsetSeconds: number): string {
  return new Date(BASE_MS + offsetSeconds * 1000).toISOString();
}

export function participant(bib: number, id = `p-${bib}`): Participant {
  return {
    _id: id,
    id,
    bibNumber: bib,
    eventId: "evt",
    firstName: "Test",
    lastName: `Runner${bib}`,
  };
}

interface EntryOptions {
  participantId: string;
  stationId: string;
  timeIn?: string | null;
  /** Pass `undefined` to omit the key entirely, as live Tracer entries do. */
  timeOut?: string | null;
  omitTimeOut?: boolean;
}

export function entry(opts: EntryOptions, id = `e-${opts.participantId}`): Entry {
  const base: Entry = {
    _id: id,
    id,
    eventId: "evt",
    participantId: opts.participantId,
    stationId: opts.stationId,
    timeIn: opts.timeIn ?? null,
    createdAt: isoAt(0),
    updatedAt: isoAt(0),
  };
  if (!opts.omitTimeOut) base.timeOut = opts.timeOut ?? null;
  return base;
}

export function station(stationNumber: number, id = `s-${stationNumber}`): Station {
  return {
    _id: id,
    id,
    eventId: "evt",
    name: `STATION ${stationNumber}`,
    distance: stationNumber * 5,
    stationNumber,
    stationNumberDisplayed: `(${String.fromCharCode(65 + stationNumber)})(${stationNumber + 1})`,
    createdAt: isoAt(0),
    updatedAt: isoAt(0),
  };
}

/** A fetch stand-in that answers a route table and records what was requested. */
export function mockFetch(
  routes: Record<string, { status?: number; body: unknown }>,
): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const match = Object.keys(routes).find((r) => url.includes(r));
    if (!match) {
      return new Response(JSON.stringify({ Code: 404, Message: "no route" }), { status: 404 });
    }
    const { status = 200, body } = routes[match];
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as FetchLike & { calls: string[] };
  impl.calls = calls;
  return impl;
}

type FetchLike = typeof fetch;
