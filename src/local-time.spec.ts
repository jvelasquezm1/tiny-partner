import { describe, expect, it } from "vitest";
import { describeLocalTime, toLocalIso } from "./local-time.js";

describe("local time", () => {
  it("writes an instant in the parent's clock with its offset, in winter and in summer", () => {
    expect(toLocalIso(new Date("2026-11-10T07:15:00Z"), "Europe/Madrid")).toBe("2026-11-10T08:15:00+01:00");
    expect(toLocalIso(new Date("2026-07-10T07:15:00Z"), "Europe/Madrid")).toBe("2026-07-10T09:15:00+02:00");
    expect(toLocalIso(new Date("2026-11-10T07:15:00Z"), "UTC")).toBe("2026-11-10T07:15:00+00:00");
    // The same instant, so the timestamp still parses to it.
    expect(Date.parse(toLocalIso(new Date("2026-11-10T07:15:00Z"), "Europe/Madrid"))).toBe(Date.parse("2026-11-10T07:15:00Z"));
  });

  it("describes the current time with weekday, date and offset", () => {
    expect(describeLocalTime(new Date("2026-11-10T06:30:00Z"), "Europe/Madrid")).toBe("Tuesday 2026-11-10 07:30 (Europe/Madrid, GMT+01:00)");
  });
});
