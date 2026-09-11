// Classification and ordering of the work list.
//
// The two config suites cover the diff against a live API; this covers which
// bucket a time lands in and the order the buckets come back in, which is what
// makes a list readable on a phone at 2am. Pure, so no network either way.

import { describe, it, expect } from "vitest";
import { byBibThenKind, diffStation, type StationRow } from "./diff";
import { entry, isoAt, participant, RACE_START_MS, elapsedFor } from "./fixtures";

const STATION = "s-4";

function w100Row(bib: number, inSec: number | null, outSec: number | null) {
  return {
    RunnerNumber: bib,
    AidStationID: 4,
    ElapsedTimeIn: inSec ?? -1,
    ElapsedTimeOut: outSec ?? -1,
    Locked: 0,
  };
}

/** In-times only, so ordering is the only thing under test. */
function orderOf(bibs: number[]): string[] {
  const participants = bibs.map((b) => participant(b));
  const entries = participants.map((p, i) =>
    entry({ participantId: p.id, stationId: STATION, timeIn: isoAt(i * 60) }),
  );
  const { toEnter } = diffStation({
    entries,
    participants,
    station: { id: STATION },
    w100Rows: [],
  });
  return toEnter.map((m) => m.key);
}

describe("work list ordering", () => {
  it("sorts by bib ascending, not by the order Tracer happened to return", () => {
    expect(orderOf([104, 7, 61])).toEqual(["7-in", "61-in", "104-in"]);
  });

  it("compares bibs numerically, so 61 precedes 104", () => {
    const keys = orderOf([104, 61]);
    expect(keys.indexOf("61-in")).toBeLessThan(keys.indexOf("104-in"));
  });

  it("puts a bib's in-time before its out-time", () => {
    // Guards the explicit kind rank: an alphabetical comparison of "in" and
    // "out" gives the same answer by luck, and would not survive a rename.
    const row = (bib: number, kind: "in" | "out") => ({ bib, kind }) as StationRow;
    expect([row(42, "out"), row(42, "in")].sort(byBibThenKind).map((r) => r.kind)).toEqual([
      "in",
      "out",
    ]);
  });

  it("orders a lone out-time among the other bibs by bib, not by kind", () => {
    const p1 = participant(50);
    const p2 = participant(20);
    const entries = [
      // Tracer sometimes omits timeOut entirely rather than nulling it.
      entry({ participantId: p1.id, stationId: STATION, timeIn: isoAt(0), omitTimeOut: true }),
      entry({ participantId: p2.id, stationId: STATION, timeIn: null, timeOut: isoAt(90) }),
    ];
    const { toEnter } = diffStation({
      entries,
      participants: [p1, p2],
      station: { id: STATION },
      // Bib 20 has an arrival in W100, so its departure is real work.
      w100Rows: [w100Row(20, 100, null)],
    });
    expect(toEnter.map((m) => m.key)).toEqual(["20-out", "50-in"]);
  });
});

describe("which bucket a time lands in", () => {
  const p = participant(153);

  function classify(opts: {
    timeIn?: string | null;
    timeOut?: string | null;
    w100Rows: ReturnType<typeof w100Row>[] | null;
  }) {
    return diffStation({
      entries: [
        entry({
          participantId: p.id,
          stationId: STATION,
          timeIn: opts.timeIn ?? null,
          timeOut: opts.timeOut ?? null,
        }),
      ],
      participants: [p],
      station: { id: STATION },
      w100Rows: opts.w100Rows,
      raceStartMs: RACE_START_MS,
    });
  }

  it("parks an out-time whose bib W100 has no arrival for", () => {
    // Runner 153's real case: /aid-station/4/times omits him entirely because
    // his in-time is -1, so the out-time he already has in W100 is invisible
    // here. Queueing it told volunteers to re-enter times that were done.
    const r = classify({ timeOut: isoAt(600), w100Rows: [] });
    expect(r.toEnter).toEqual([]);
    expect(r.missingIn.map((m) => m.key)).toEqual(["153-out"]);
  });

  it("parks an out-time when W100's row exists but its in-time is -1", () => {
    const r = classify({ timeOut: isoAt(600), w100Rows: [w100Row(153, null, null)] });
    expect(r.toEnter).toEqual([]);
    expect(r.missingIn.map((m) => m.key)).toEqual(["153-out"]);
  });

  it("queues an out-time once W100 has the arrival behind it", () => {
    const r = classify({ timeOut: isoAt(600), w100Rows: [w100Row(153, 300, null)] });
    expect(r.toEnter.map((m) => m.key)).toEqual(["153-out"]);
    expect(r.missingIn).toEqual([]);
  });

  it("always queues an in-time, since it is what unblocks the rest", () => {
    const r = classify({ timeIn: isoAt(300), w100Rows: [] });
    expect(r.toEnter.map((m) => m.key)).toEqual(["153-in"]);
    expect(r.missingIn).toEqual([]);
  });

  it("drops a time both sides agree on", () => {
    const iso = isoAt(600);
    const r = classify({ timeOut: iso, w100Rows: [w100Row(153, 300, elapsedFor(iso))] });
    expect(r.toEnter).toEqual([]);
    expect(r.missingIn).toEqual([]);
    expect(r.misaligned).toEqual([]);
    expect(r.tracerTimeCount).toBe(1);
  });

  it("flags a time both sides have with different values", () => {
    const iso = isoAt(600);
    const r = classify({ timeOut: iso, w100Rows: [w100Row(153, 300, elapsedFor(iso) - 60)] });
    expect(r.misaligned).toMatchObject([
      { key: "153-out", tracerElapsed: elapsedFor(iso), w100Elapsed: elapsedFor(iso) - 60 },
    ]);
    expect(r.toEnter).toEqual([]);
  });

  it("cannot call a time misaligned without a race start to measure from", () => {
    const iso = isoAt(600);
    const r = diffStation({
      entries: [entry({ participantId: p.id, stationId: STATION, timeOut: iso })],
      participants: [p],
      station: { id: STATION },
      w100Rows: [w100Row(153, 300, 999)],
    });
    expect(r.misaligned).toEqual([]);
    expect(r.toEnter).toEqual([]);
  });

  it("routes everything to the work list when W100 is unreachable", () => {
    const r = classify({ timeIn: isoAt(300), timeOut: isoAt(600), w100Rows: null });
    expect(r.degraded).toBe(true);
    expect(r.toEnter.map((m) => m.key)).toEqual(["153-in", "153-out"]);
    expect(r.missingIn).toEqual([]);
    expect(r.misaligned).toEqual([]);
  });
});
