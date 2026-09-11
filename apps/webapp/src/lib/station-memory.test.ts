// localStorage round-trips. vitest runs in node, where `window` does not
// exist, so each test installs a stand-in -- which doubles as a check that
// the module survives a browser that denies storage outright.

import { describe, it, expect, afterEach } from "vitest";
import {
  loadChecks,
  saveChecks,
  loadRememberedStation,
  saveRememberedStation,
  type StoredCheck,
} from "./station-memory";

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    clear: () => map.clear(),
    get length() {
      return map.size;
    },
  };
  (globalThis as { window?: unknown }).window = { localStorage: store };
  return map;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const check = (over: Partial<StoredCheck> = {}): StoredCheck => ({
  verdict: "entered",
  tone: "good",
  message: "Already entered (14:05)",
  at: "2026-09-11T22:44:00.000Z",
  ...over,
});

describe("remembered station", () => {
  it("round-trips the aid station id", () => {
    fakeStorage();
    saveRememberedStation(4);
    expect(loadRememberedStation()).toBe(4);
  });

  it("returns null when there is no storage at all", () => {
    expect(loadRememberedStation()).toBeNull();
  });
});

describe("stored check results", () => {
  it("round-trips a station's results", () => {
    fakeStorage();
    saveChecks(4, { "153-out": check() });
    expect(loadChecks(4)).toEqual({ "153-out": check() });
  });

  it("keeps stations apart, so one aid station cannot answer for another", () => {
    fakeStorage();
    saveChecks(4, { "153-out": check() });
    expect(loadChecks(5)).toEqual({});
  });

  it("starts empty rather than throwing when storage is unavailable", () => {
    expect(loadChecks(4)).toEqual({});
    expect(() => saveChecks(4, { "153-out": check() })).not.toThrow();
  });

  it("drops entries it cannot trust instead of rendering them", () => {
    fakeStorage({
      "w100diff:checks:v1:4": JSON.stringify({
        "153-out": check(),
        "36-out": { tone: "chartreuse", message: "hi", at: "" },
        "73-out": { tone: "good" },
        "99-out": null,
      }),
    });
    expect(Object.keys(loadChecks(4))).toEqual(["153-out"]);
  });

  it("tolerates an unparseable or wrongly-shaped payload", () => {
    fakeStorage({ "w100diff:checks:v1:4": "{oh no" });
    expect(loadChecks(4)).toEqual({});
    fakeStorage({ "w100diff:checks:v1:4": JSON.stringify(["nope"]) });
    expect(loadChecks(4)).toEqual({});
  });

  it("defaults a missing timestamp to empty so the row just omits it", () => {
    fakeStorage({
      "w100diff:checks:v1:4": JSON.stringify({ "153-out": { tone: "warn", message: "Not entered yet" } }),
    });
    expect(loadChecks(4)["153-out"]).toMatchObject({ message: "Not entered yet", at: "" });
  });

  it("reads a verdict off the tone for results stored before verdicts existed", () => {
    // Volunteers already had results in localStorage when grouping shipped;
    // re-checking eighteen runners to regain them would defeat the point.
    fakeStorage({
      "w100diff:checks:v1:4": JSON.stringify({
        "153-out": { tone: "good", message: "Already entered (14:05)", at: "" },
        "36-out": { tone: "warn", message: "Not entered yet", at: "" },
      }),
    });
    const restored = loadChecks(4);
    expect(restored["153-out"].verdict).toBe("entered");
    expect(restored["36-out"].verdict).toBe("action");
  });

  it("prefers a stored verdict over the tone when both are present", () => {
    fakeStorage({
      "w100diff:checks:v1:4": JSON.stringify({
        "153-out": { verdict: "action", tone: "good", message: "hmm", at: "" },
      }),
    });
    expect(loadChecks(4)["153-out"].verdict).toBe("action");
  });
});
