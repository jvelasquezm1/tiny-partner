import { describe, expect, it } from "vitest";
import { InvalidRangeError, resolveRange } from "./stats-repository.js";

// 23:30 UTC on the 10th is already the 11th in Madrid.
const now = new Date("2026-11-10T23:30:00Z");

describe("resolveRange", () => {
  it("ends today in the bot's time zone, 14 days by default", () => {
    expect(resolveRange({}, "Europe/Madrid", now)).toEqual({ from: "2026-10-29", to: "2026-11-11" });
    expect(resolveRange({}, "UTC", now)).toEqual({ from: "2026-10-28", to: "2026-11-10" });
  });

  it("takes a number of days or a custom range", () => {
    expect(resolveRange({ days: "7" }, "Europe/Madrid", now)).toEqual({ from: "2026-11-05", to: "2026-11-11" });
    expect(resolveRange({ from: "2026-10-01", to: "2026-10-31" }, "Europe/Madrid", now)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolveRange({ from: "2026-11-03", to: "2026-11-03" }, "Europe/Madrid", now)).toEqual({ from: "2026-11-03", to: "2026-11-03" });
  });

  it("rejects malformed, reversed or too long periods", () => {
    for (const query of [
      { from: "2026-11-01" },
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "nov", to: "2026-11-10" },
      { from: "2026-11-10", to: "2026-11-01" },
      { from: "2026-01-01", to: "2026-04-01" },
      { days: "0" },
      { days: "91" },
      { days: "7.5" },
    ]) {
      expect(() => resolveRange(query, "Europe/Madrid", now), JSON.stringify(query)).toThrow(InvalidRangeError);
    }
  });
});
