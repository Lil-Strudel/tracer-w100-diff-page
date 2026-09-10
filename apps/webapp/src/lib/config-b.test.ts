// Config B -- REAL TRACER, MOCKED W100.
//
// Exercises the Tracer client, the slug -> _id lookup, the three-collection
// fan-out and the station mapping against genuinely live Tracer responses,
// with W100 mocked so every branch (empty, 404, all -1, hard error) can be
// asserted exactly.
//
// Live Tracer entries currently all have `timeIn: null`, so synthetic times
// are overlaid onto the *real* entry objects -- preserving their real shape,
// including the rows that omit `timeOut` entirely.

import { describe, it, expect, beforeAll } from "vitest";
import { TracerAPI, type TracerSnapshot, type Entry } from "./tracer";
import { W100API, W100Error } from "./w100";
import { mapStations, w100IdForStation, displayedW100Id } from "./stations";
import { diffStation } from "./diff";
import { mockFetch, isoAt } from "./fixtures";
import w100StationFixture from "./w100-stations.fixture.json";

const tracer = new TracerAPI();
let snap: TracerSnapshot;

beforeAll(async () => {
  snap = await tracer.getSnapshot();
}, 60_000);

describe("Config B: live Tracer client", () => {
  it("resolves the w100-26 slug to an event id", () => {
    expect(snap.event.slug).toBe("w100-26");
    expect(snap.event._id).toMatch(/^[a-f0-9]{24}$/);
  });

  it("fans out to all three collections", () => {
    expect(snap.stations.length).toBeGreaterThan(0);
    expect(snap.participants.length).toBeGreaterThan(0);
    expect(Array.isArray(snap.entries)).toBe(true);
  });

  it("every entry points at a real station and participant", () => {
    const stationIds = new Set(snap.stations.map((s) => s.id));
    const participantIds = new Set(snap.participants.map((p) => p.id));
    for (const e of snap.entries) {
      expect(stationIds.has(e.stationId)).toBe(true);
      expect(participantIds.has(e.participantId)).toBe(true);
    }
  });

  it("participants carry no contact details (we never fetch W100's PII roster)", () => {
    for (const p of snap.participants.slice(0, 25)) {
      expect(p).not.toHaveProperty("EmailAddress");
      expect(p).not.toHaveProperty("CellPhone");
    }
  });
});

describe("Config B: station mapping against live Tracer stations", () => {
  it("maps every Tracer station onto a W100 aid station id", () => {
    const { stations, warnings } = mapStations(snap.stations, w100StationFixture);
    expect(stations).toHaveLength(snap.stations.length);
    expect(warnings).toEqual([]);
  });

  it("agrees with the id Tracer encodes in stationNumberDisplayed", () => {
    for (const s of snap.stations) {
      expect(displayedW100Id(s)).toBe(w100IdForStation(s));
    }
  });

  it("aligns names in order without comparing distances", () => {
    // Tracer lists BIG WATER at 56.4mi where W100 says 52.9 -- names and
    // ordinals still line up, so distance is intentionally not asserted.
    const { stations } = mapStations(snap.stations, w100StationFixture);
    const byId = new Map(w100StationFixture.map((s) => [s.AidStationID, s]));
    for (const s of stations) {
      expect(byId.get(s.w100Id)).toBeDefined();
    }
  });

  it("still catches a genuine off-by-one mis-mapping", () => {
    // Shift the W100 list by one so every Tracer station lines up with the
    // wrong aid station; the name check must notice.
    const shifted = w100StationFixture.map((s, i) => ({
      ...s,
      AidStationName: w100StationFixture[(i + 1) % w100StationFixture.length].AidStationName,
    }));
    const { warnings } = mapStations(snap.stations, shifted);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("marks W100 station 1 (START) as not queryable", () => {
    const { stations } = mapStations(snap.stations, w100StationFixture);
    expect(stations.find((s) => s.w100Id === 1)?.queryable).toBe(false);
    expect(stations.filter((s) => s.w100Id !== 1).every((s) => s.queryable)).toBe(true);
  });
});

describe("Config B: diff over real Tracer entries with W100 mocked", () => {
  // Overlay synthetic times onto real entry objects, keeping their real shape.
  function timedEntries(): { entries: Entry[]; stationId: string; expected: number } {
    const stationId = snap.entries[0].stationId;
    const forStation = snap.entries.filter((e) => e.stationId === stationId);
    const entries = forStation.map((e, i) => {
      const copy: Entry = { ...e, timeIn: isoAt(i * 60) };
      // Preserve rows that genuinely omit timeOut; give the rest an out-time.
      if ("timeOut" in e) copy.timeOut = isoAt(i * 60 + 30);
      return copy;
    });
    const expected = entries.reduce(
      (n, e) => n + (e.timeIn ? 1 : 0) + (e.timeOut ? 1 : 0),
      0,
    );
    return { entries, stationId, expected };
  }

  it("lists every Tracer time when W100 returns an empty array", () => {
    const { entries, stationId, expected } = timedEntries();
    const result = diffStation({
      entries,
      participants: snap.participants,
      station: { id: stationId },
      w100Rows: [],
    });
    expect(result.missing).toHaveLength(expected);
    expect(result.degraded).toBe(false);
  });

  it("lists every Tracer time when every W100 row is -1", () => {
    const { entries, stationId, expected } = timedEntries();
    const bibs = new Set(
      entries
        .map((e) => snap.participants.find((p) => p.id === e.participantId)?.bibNumber)
        .filter((b): b is number => b !== undefined),
    );
    const w100Rows = [...bibs].map((RunnerNumber) => ({
      RunnerNumber,
      AidStationID: 4,
      ElapsedTimeIn: -1,
      ElapsedTimeOut: -1,
      Locked: 0,
    }));

    const result = diffStation({
      entries,
      participants: snap.participants,
      station: { id: stationId },
      w100Rows,
    });
    expect(result.missing).toHaveLength(expected);
  });

  it("degrades to an unverified checklist when W100 is unreachable", () => {
    const { entries, stationId, expected } = timedEntries();
    const result = diffStation({
      entries,
      participants: snap.participants,
      station: { id: stationId },
      w100Rows: null,
    });
    expect(result.degraded).toBe(true);
    expect(result.missing).toHaveLength(expected);
  });

  it("produces stable dismissal keys of the form bib-kind", () => {
    const { entries, stationId } = timedEntries();
    const result = diffStation({
      entries,
      participants: snap.participants,
      station: { id: stationId },
      w100Rows: [],
    });
    for (const m of result.missing) {
      expect(m.key).toBe(`${m.bib}-${m.kind}`);
    }
  });
});

describe("Config B: mocked W100 transport behaviour", () => {
  it("turns a 404 'no data' body into an empty list", async () => {
    const f = mockFetch({
      "/aid-station/15/times": {
        status: 404,
        body: { Code: 404, Message: "No data found in the specified range", RootError: null },
      },
    });
    const api = new W100API(f, "/w100");
    await expect(api.getStationTimes(15)).resolves.toEqual([]);
  });

  it("surfaces a PascalCase error body as a W100Error", async () => {
    const f = mockFetch({
      "/aid-station/1/times": {
        status: 400,
        body: { Code: 400, Message: "The Aid Station ID is invalid", RootError: null },
      },
    });
    const api = new W100API(f, "/w100");
    await expect(api.getStationTimes(1)).rejects.toMatchObject({
      status: 400,
      message: "The Aid Station ID is invalid",
    });
  });

  it("also accepts the lowercase error body the OpenAPI spec documents", async () => {
    const f = mockFetch({
      "/aid-station/2/times": { status: 500, body: { code: 500, message: "boom" } },
    });
    const api = new W100API(f, "/w100");
    await expect(api.getStationTimes(2)).rejects.toMatchObject({ status: 500, message: "boom" });
  });

  it("never requests the PII roster endpoint", async () => {
    const f = mockFetch({
      "/aid-station": { body: w100StationFixture },
      "/query/status": { body: { EventName: "x", OperatingMode: "Test" } },
    });
    const api = new W100API(f, "/w100");
    await api.getStations();
    await api.getStatus();
    await api.getStationTimes(4).catch(() => []);
    expect(f.calls.some((u) => /\/runner(\b|\/|$)/.test(u))).toBe(false);
    expect(W100API.prototype).not.toHaveProperty("getRunners");
  });

  it("propagates a hard failure so the UI can enter degraded mode", async () => {
    const failing = (async () => {
      throw new TypeError("network down");
    }) as typeof fetch;
    const api = new W100API(failing, "/w100");
    await expect(api.getStationTimes(4)).rejects.toBeInstanceOf(TypeError);
    expect(W100Error).toBeDefined();
  });
});
