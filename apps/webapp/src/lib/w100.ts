// Client for the W100 race server, read through the /w100/* proxy.
//
// W100 sends no CORS headers on any host, so the browser can never reach it
// directly -- `/w100/<path>` is rewritten to https://w100as.web.app/api/<path>
// by CloudFront in production and by the Vite dev proxy locally.
//
// Deliberately NOT exposed here: /runner and /runner/{bib}, which return
// runner email addresses and phone numbers. Names come from Tracer's
// participants instead. /runner/{bib}/times is a different thing -- times
// only, no contact details -- and is used, one bib at a time, to see out-times
// that /aid-station/{id}/times hides.

import type { FetchLike } from "./tracer";

export interface W100Station {
  AidStationID: number;
  AidStationName: string;
  Distance: number;
  Manned: boolean;
  CutoffTime: number;
}

/** A raw row from /aid-station/{id}/times. -1 means "not entered". */
export interface W100RunnerTimes {
  RunnerNumber: number;
  AidStationID: number;
  ElapsedTimeIn: number;
  ElapsedTimeOut: number;
  Locked: number | boolean;
}

export interface W100Status {
  EventName: string;
  OperatingMode: string;
  DatabaseVersion: string;
  RaceServiceVersion: string;
  HighestRunnerNumber: number;
  RaceStartTime: string;
  RaceEndTime: string;
  RaceDay: number;
  ElapsedRaceTime: number;
}

/** Normalized view of one station's times: null instead of -1. */
export interface W100StationTimes {
  byBib: Map<number, { in: number | null; out: number | null }>;
}

export class W100Error extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "W100Error";
  }
}

const ELAPSED_NOT_ENTERED = -1;

/**
 * The real server returns PascalCase `{Code, Message, RootError}` even though
 * openapi.yaml documents lowercase `{code, message}`. Accept either.
 */
function readError(body: unknown, status: number) {
  const b = (body ?? {}) as Record<string, unknown>;
  const code = (b.Code ?? b.code) as number | undefined;
  const message = (b.Message ?? b.message) as string | undefined;
  return { code, message: message ?? `W100 request failed (${status})` };
}

export const W100_PROXY_PREFIX = "/w100";

export class W100API {
  private readonly fetchImpl: FetchLike;

  constructor(
    fetchImpl: FetchLike = fetch,
    private readonly prefix: string = W100_PROXY_PREFIX,
  ) {
    // See the note in tracer.ts: calling a native fetch as a method of this
    // instance throws "Illegal invocation" in browsers.
    this.fetchImpl = (input, init) => fetchImpl(input, init);
  }

  private async request<T>(path: string): Promise<{ data: T | null; status: number }> {
    const res = await this.fetchImpl(`${this.prefix}${path}`);
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (!res.ok) {
      const { code, message } = readError(body, res.status);
      throw new W100Error(message, res.status, code);
    }
    return { data: body as T, status: res.status };
  }

  async getStations(): Promise<W100Station[]> {
    const { data } = await this.request<W100Station[]>("/aid-station");
    return data ?? [];
  }

  async getStatus(): Promise<W100Status> {
    const { data } = await this.request<W100Status>("/query/status");
    if (!data) throw new W100Error("W100 returned an empty status", 200);
    return data;
  }

  /**
   * All recorded times for one aid station, in a single request.
   *
   * A station with nothing recorded yet answers 404 with
   * `{"Code":404,"Message":"No data found in the specified range"}` -- that is
   * an empty station, not a failure, so it is normalized to an empty list.
   * A 400 ("The Aid Station ID is invalid", e.g. station 1 / START) is a real
   * error and propagates.
   */
  async getStationTimes(aidStationId: number): Promise<W100RunnerTimes[]> {
    try {
      const { data } = await this.request<W100RunnerTimes[]>(
        `/aid-station/${aidStationId}/times`,
      );
      return data ?? [];
    } catch (err) {
      if (err instanceof W100Error && err.status === 404) return [];
      throw err;
    }
  }

  /**
   * One runner's times across every aid station.
   *
   * This is the only way to see an out-time that was entered before the
   * matching in-time: /aid-station/{id}/times drops a runner entirely while
   * their ElapsedTimeIn is -1, out-time and all. Called one bib at a time,
   * on demand -- never fanned out across a start list.
   *
   * Note the path: /runner/{bib}/times returns times only. Its parent,
   * /runner/{bib}, returns the runner's email address and phone number and is
   * deliberately never called.
   */
  async getRunnerTimes(bib: number): Promise<W100RunnerTimes[]> {
    try {
      const { data } = await this.request<W100RunnerTimes[]>(`/runner/${bib}/times`);
      return data ?? [];
    } catch (err) {
      // A runner with nothing recorded anywhere answers 404, same as a station.
      if (err instanceof W100Error && err.status === 404) return [];
      throw err;
    }
  }
}

export function indexStationTimes(rows: W100RunnerTimes[]): W100StationTimes {
  const byBib = new Map<number, { in: number | null; out: number | null }>();
  for (const row of rows) {
    byBib.set(row.RunnerNumber, {
      in: row.ElapsedTimeIn === ELAPSED_NOT_ENTERED ? null : row.ElapsedTimeIn,
      out: row.ElapsedTimeOut === ELAPSED_NOT_ENTERED ? null : row.ElapsedTimeOut,
    });
  }
  return { byBib };
}

/**
 * One station's times out of a per-runner response, with -1 normalized away.
 * Returns null when the runner has no row for that station at all.
 */
export function stationTimesFor(
  rows: W100RunnerTimes[],
  aidStationId: number,
): { in: number | null; out: number | null } | null {
  const row = rows.find((r) => r.AidStationID === aidStationId);
  if (!row) return null;
  return {
    in: row.ElapsedTimeIn === ELAPSED_NOT_ENTERED ? null : row.ElapsedTimeIn,
    out: row.ElapsedTimeOut === ELAPSED_NOT_ENTERED ? null : row.ElapsedTimeOut,
  };
}
