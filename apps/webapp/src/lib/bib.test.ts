import { describe, it, expect } from "vitest";
import { formatBib } from "./bib";

describe("formatBib", () => {
  it("pads to the three digits the race prints on the bib itself", () => {
    expect(formatBib(1)).toBe("001");
    expect(formatBib(19)).toBe("019");
  });

  it("leaves a three-digit bib alone", () => {
    expect(formatBib(153)).toBe("153");
  });

  it("does not truncate a bib that outgrows three digits", () => {
    expect(formatBib(1024)).toBe("1024");
  });
});
