// Ordering of the work list.
//
// The two config suites cover *which* times are missing against a live API;
// this covers the order they come back in, which is what makes a bib's two
// times sit together on screen. Pure, so no network either way.

import { describe, it, expect } from "vitest";
import { diffStation } from "./diff";
import { entry, isoAt, participant } from "./fixtures";

const STATION = "s-4";

/** Every time missing, so ordering is the only thing under test. */
function orderOf(bibs: number[]): string[] {
  const participants = bibs.map((b) => participant(b));
  const entries = participants.map((p, i) =>
    entry({
      participantId: p.id,
      stationId: STATION,
      timeIn: isoAt(i * 60),
      timeOut: isoAt(i * 60 + 30),
    }),
  );
  const { missing } = diffStation({
    entries,
    participants,
    station: { id: STATION },
    w100Rows: [],
  });
  return missing.map((m) => m.key);
}

describe("work list ordering", () => {
  it("sorts by bib ascending, not by the order Tracer happened to return", () => {
    expect(orderOf([104, 7, 61])).toEqual([
      "7-in",
      "7-out",
      "61-in",
      "61-out",
      "104-in",
      "104-out",
    ]);
  });

  it("compares bibs numerically, so 61 precedes 104", () => {
    const keys = orderOf([104, 61]);
    expect(keys.indexOf("61-in")).toBeLessThan(keys.indexOf("104-in"));
  });

  it("puts a bib's in-time before its out-time", () => {
    // Guards the explicit kind rank: an alphabetical comparison of "in" and
    // "out" gives the same answer by luck, and would not survive a rename.
    const keys = orderOf([42]);
    expect(keys).toEqual(["42-in", "42-out"]);
  });

  it("keeps a bib's two times adjacent, never interleaved with another bib", () => {
    const keys = orderOf([9, 8]);
    expect(keys).toEqual(["8-in", "8-out", "9-in", "9-out"]);
  });

  it("orders a lone out-time among the other bibs by bib, not by kind", () => {
    const p1 = participant(50);
    const p2 = participant(20);
    const entries = [
      // Tracer sometimes omits timeOut entirely rather than nulling it.
      entry({ participantId: p1.id, stationId: STATION, timeIn: isoAt(0), omitTimeOut: true }),
      entry({ participantId: p2.id, stationId: STATION, timeIn: null, timeOut: isoAt(90) }),
    ];
    const { missing } = diffStation({
      entries,
      participants: [p1, p2],
      station: { id: STATION },
      w100Rows: [],
    });
    expect(missing.map((m) => m.key)).toEqual(["20-out", "50-in"]);
  });
});
