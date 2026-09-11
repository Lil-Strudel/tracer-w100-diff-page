import { describe, it, expect } from "vitest";
import {
  formatRaceTime,
  formatRaceTimeWithDay,
  formatElapsed,
  parseRaceStart,
  elapsedSeconds,
} from "./time";

describe("race-local time formatting", () => {
  it("renders a UTC instant as Mountain wall clock during MDT", () => {
    // 2026-09-11 is inside daylight time, so Denver is UTC-6.
    expect(formatRaceTime("2026-09-11T18:07:33.000Z")).toBe("12:07:33");
  });

  it("renders a UTC instant as Mountain wall clock during MST", () => {
    // 2026-12-11 is outside daylight time, so Denver is UTC-7.
    expect(formatRaceTime("2026-12-11T18:07:33.000Z")).toBe("11:07:33");
  });

  it("renders midnight as 00, not 24", () => {
    expect(formatRaceTime("2026-09-11T06:00:00.000Z")).toBe("00:00");
  });

  it("drops the seconds when a time lands on the minute", () => {
    expect(formatRaceTime("2026-09-11T18:07:00.000Z")).toBe("12:07");
  });

  it("keeps the seconds when they carry information", () => {
    expect(formatRaceTime("2026-09-11T18:07:01.000Z")).toBe("12:07:01");
    // Zero seconds only -- a zero minute is not a reason to trim.
    expect(formatRaceTime("2026-09-11T18:00:33.000Z")).toBe("12:00:33");
  });

  it("includes the weekday when asked, for a race that runs past midnight", () => {
    expect(formatRaceTimeWithDay("2026-09-12T04:30:00.000Z")).toMatch(/^Fri,? 22:30$/);
    expect(formatRaceTimeWithDay("2026-09-12T04:30:15.000Z")).toMatch(/^Fri,? 22:30:15$/);
  });

  it("returns null for absent or unparseable input", () => {
    expect(formatRaceTime(null)).toBeNull();
    expect(formatRaceTime(undefined)).toBeNull();
    expect(formatRaceTime("")).toBeNull();
    expect(formatRaceTime("not a date")).toBeNull();
  });
});

describe("weekday", () => {
  it("names the race-local day, not the UTC one", async () => {
    const { weekday } = await import("./time");
    // 04:30Z on Saturday is still Friday evening in Denver.
    expect(weekday("2026-09-12T04:30:00.000Z")).toBe("Fri");
    expect(weekday("2026-09-12T18:30:00.000Z")).toBe("Sat");
  });

  it("returns null for absent input", async () => {
    const { weekday } = await import("./time");
    expect(weekday(null)).toBeNull();
    expect(weekday("nope")).toBeNull();
  });
});

describe("parseRaceStart", () => {
  it("reads the live 2026 race start off W100's status", () => {
    // The string W100 actually served during the race, and the instant every
    // ElapsedTime* value on the server is measured from.
    expect(parseRaceStart("Friday, 11-Sep-26 05:00:00 MDT")).toBe(
      Date.parse("2026-09-11T11:00:00.000Z"),
    );
  });

  it("honours the zone abbreviation rather than assuming daylight time", () => {
    expect(parseRaceStart("Friday, 11-Sep-26 05:00:00 MST")).toBe(
      Date.parse("2026-09-11T12:00:00.000Z"),
    );
  });

  it("returns null rather than a wrong instant for anything it cannot read", () => {
    expect(parseRaceStart(null)).toBeNull();
    expect(parseRaceStart("")).toBeNull();
    expect(parseRaceStart("2026-09-11T11:00:00Z")).toBeNull();
    expect(parseRaceStart("Friday, 11-Zzz-26 05:00:00 MDT")).toBeNull();
  });

  it("does not accept Tracer's event start, which is five hours early", () => {
    // Guards the trap this replaced: w100-26 reports startDate 06:00Z against
    // an 11:00Z gun, so comparing times against it flags the whole field.
    expect(parseRaceStart("2026-09-11T06:00:00.000Z")).toBeNull();
  });
});

describe("elapsedSeconds", () => {
  it("round-trips a real W100 elapsed value", () => {
    // Runner 153's departure from BIG MTN: 32700s after the gun is 14:05 MDT.
    const raceStart = parseRaceStart("Friday, 11-Sep-26 05:00:00 MDT")!;
    expect(elapsedSeconds("2026-09-11T20:05:00.000Z", raceStart)).toBe(32700);
    expect(formatElapsed(32700, raceStart)).toBe("14:05");
  });

  it("formats nothing when the race start is unknown", () => {
    expect(formatElapsed(32700, null)).toBeNull();
    expect(formatElapsed(null, 0)).toBeNull();
  });
});
