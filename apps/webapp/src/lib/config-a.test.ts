// Config A -- REAL W100, MOCKED TRACER.
//
// Exercises the W100 client and the diff against genuinely live W100
// responses. Tracer is synthesized *from the W100 response*, so the expected
// output is exact even though the race has not started and the two systems
// have no overlapping real data yet.
//
// Runs in node, where there is no CORS, so it talks to w100as.web.app directly
// without needing the deployed CloudFront proxy.
//
// W100's race server is a dyndns host that is not always up; the Firebase
// function in front of it then answers 502 "Could not reach race server".
// When that happens the live-transport assertions SKIP LOUDLY and the diff
// assertions fall back to a recorded snapshot, so upstream downtime never
// silently reduces coverage of our own logic.

import { describe, it, expect, beforeAll } from "vitest";
import { W100API, W100Error, indexStationTimes, type W100RunnerTimes } from "./w100";
import { diffStation } from "./diff";
import { entry, participant, station, isoAt } from "./fixtures";
import recordedStation4 from "./w100-station4-times.fixture.json";

const W100_DIRECT = "https://w100as.web.app/api";
const STATION_WITH_DATA = 4; // Big Mountain Pass
const STATION_EMPTY = 15; // Decker Canyon -- answers 404 when nothing recorded
const STATION_INVALID = 1; // START -- W100 rejects with 400

const api = new W100API(fetch, W100_DIRECT);

let live = false;
let rows: W100RunnerTimes[] = recordedStation4 as W100RunnerTimes[];

beforeAll(async () => {
  try {
    const fetched = await api.getStationTimes(STATION_WITH_DATA);
    if (fetched.length > 0) {
      rows = fetched;
      live = true;
    }
  } catch (err) {
    console.warn(
      `\n[Config A] W100 unreachable (${err instanceof Error ? err.message : err}).` +
        `\n[Config A] Live-transport assertions SKIPPED; diff assertions use the recorded snapshot.\n`,
    );
  }
}, 60_000);

describe("Config A: live W100 client", () => {
  it("returns bulk times for a station in a single request", () => {
    if (!live) return void expect(live, "W100 unreachable - see warning above").toBe(false);
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    expect(row).toHaveProperty("RunnerNumber");
    expect(row).toHaveProperty("ElapsedTimeIn");
    expect(row).toHaveProperty("ElapsedTimeOut");
    expect(row.AidStationID).toBe(STATION_WITH_DATA);
  });

  it("treats an empty station's 404 as an empty list, not an error", async () => {
    if (!live) return;
    await expect(api.getStationTimes(STATION_EMPTY)).resolves.toEqual([]);
  });

  it("propagates a genuinely invalid station id as an error", async () => {
    if (!live) return;
    await expect(api.getStationTimes(STATION_INVALID)).rejects.toBeInstanceOf(W100Error);
    await expect(api.getStationTimes(STATION_INVALID)).rejects.toMatchObject({ status: 400 });
  });

  it("reads live race status", async () => {
    if (!live) return;
    const status = await api.getStatus();
    expect(status.EventName).toBeTruthy();
    expect(status.OperatingMode).toBeTruthy();
  });
});

describe("Config A: W100 row normalization", () => {
  it("normalizes W100's -1 sentinel to null", () => {
    const indexed = indexStationTimes([
      { RunnerNumber: 7, AidStationID: 4, ElapsedTimeIn: 100, ElapsedTimeOut: -1, Locked: 0 },
    ]);
    expect(indexed.byBib.get(7)).toEqual({ in: 100, out: null });
  });

  it("the snapshot under test has both complete and half-recorded rows", () => {
    expect(rows.some((r) => r.ElapsedTimeIn !== -1 && r.ElapsedTimeOut !== -1)).toBe(true);
    expect(rows.some((r) => r.ElapsedTimeOut === -1)).toBe(true);
  });
});

describe("Config A: diff against W100 rows", () => {
  it("reports nothing for bibs W100 already has both times for", () => {
    const complete = rows
      .filter((r) => r.ElapsedTimeIn !== -1 && r.ElapsedTimeOut !== -1)
      .slice(0, 5);
    expect(complete).toHaveLength(5);

    const s = station(3);
    const participants = complete.map((r) => participant(r.RunnerNumber));
    const entries = complete.map((r, i) =>
      entry(
        {
          participantId: `p-${r.RunnerNumber}`,
          stationId: s.id,
          timeIn: isoAt(i * 60),
          timeOut: isoAt(i * 60 + 30),
        },
        `e-complete-${i}`,
      ),
    );

    const result = diffStation({ entries, participants, station: s, w100Rows: rows });
    expect(result.missing).toEqual([]);
    expect(result.tracerTimeCount).toBe(10);
  });

  it("reports only the out-time for bibs whose W100 out is -1", () => {
    const missingOut = rows
      .filter((r) => r.ElapsedTimeIn !== -1 && r.ElapsedTimeOut === -1)
      .slice(0, 5);
    expect(missingOut.length).toBeGreaterThan(0);

    const s = station(3);
    const participants = missingOut.map((r) => participant(r.RunnerNumber));
    const entries = missingOut.map((r, i) =>
      entry(
        {
          participantId: `p-${r.RunnerNumber}`,
          stationId: s.id,
          timeIn: isoAt(i * 60),
          timeOut: isoAt(i * 60 + 30),
        },
        `e-out-${i}`,
      ),
    );

    const result = diffStation({ entries, participants, station: s, w100Rows: rows });
    expect(result.missing).toHaveLength(missingOut.length);
    expect(result.missing.every((m) => m.kind === "out")).toBe(true);
    expect(new Set(result.missing.map((m) => m.bib))).toEqual(
      new Set(missingOut.map((r) => r.RunnerNumber)),
    );
  });

  it("reports both times for bibs W100 has never seen", () => {
    const known = new Set(rows.map((r) => r.RunnerNumber));
    const unknown: number[] = [];
    for (let bib = 9000; unknown.length < 3; bib++) {
      if (!known.has(bib)) unknown.push(bib);
    }

    const s = station(3);
    const participants = unknown.map((bib) => participant(bib));
    const entries = unknown.map((bib, i) =>
      entry(
        {
          participantId: `p-${bib}`,
          stationId: s.id,
          timeIn: isoAt(i * 60),
          timeOut: isoAt(i * 60 + 30),
        },
        `e-unknown-${i}`,
      ),
    );

    const result = diffStation({ entries, participants, station: s, w100Rows: rows });
    expect(result.missing).toHaveLength(6);
    expect(result.missing.filter((m) => m.kind === "in")).toHaveLength(3);
    expect(result.missing.filter((m) => m.kind === "out")).toHaveLength(3);
  });

  it("handles a Tracer entry that omits the timeOut key entirely", () => {
    const known = new Set(rows.map((r) => r.RunnerNumber));
    let bib = 9500;
    while (known.has(bib)) bib++;

    const s = station(3);
    const result = diffStation({
      entries: [
        entry({
          participantId: `p-${bib}`,
          stationId: s.id,
          timeIn: isoAt(0),
          omitTimeOut: true,
        }),
      ],
      participants: [participant(bib)],
      station: s,
      w100Rows: rows,
    });

    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({ bib, kind: "in", key: `${bib}-in` });
  });

  it("ignores entries belonging to a different station", () => {
    const s = station(3);
    const other = station(9);
    const result = diffStation({
      entries: [entry({ participantId: "p-1", stationId: other.id, timeIn: isoAt(0) })],
      participants: [participant(1, "p-1")],
      station: s,
      w100Rows: rows,
    });
    expect(result.missing).toEqual([]);
    expect(result.tracerTimeCount).toBe(0);
  });
});

describe("Config A: W100 outage handling", () => {
  it("maps the Cloud Function's 502 into a W100Error the UI can degrade on", async () => {
    const failing = (async () =>
      new Response(
        JSON.stringify({ code: 502, message: "Could not reach race server: fetch failed" }),
        { status: 502, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    const downApi = new W100API(failing, W100_DIRECT);
    await expect(downApi.getStationTimes(4)).rejects.toMatchObject({
      status: 502,
      message: "Could not reach race server: fetch failed",
    });
  });
});
