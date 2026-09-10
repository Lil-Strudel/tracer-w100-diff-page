import { describe, it, expect } from "vitest";
import { formatRaceTime, formatRaceTimeWithDay } from "./time";

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
    expect(formatRaceTime("2026-09-11T06:00:00.000Z")).toBe("00:00:00");
  });

  it("includes the weekday when asked, for a race that runs past midnight", () => {
    expect(formatRaceTimeWithDay("2026-09-12T04:30:00.000Z")).toMatch(/^Fri,? 22:30:00$/);
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
