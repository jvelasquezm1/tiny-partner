import { describe, expect, it } from "vitest";
import type { BabyEvent } from "./event-schema.js";
import { statesUnclearClockTime, timeReadings } from "./event-time.js";

const event = (startedAt: string, endedAt: string | null = null): BabyEvent => ({
  kind: "feed",
  startedAt,
  endedAt,
  amountMl: 200,
  side: null,
  diaper: null,
  note: null,
});
const starts = (readings: BabyEvent[] | null) => readings?.map((reading) => [reading.startedAt, reading.endedAt]);
// 07:30 in Madrid.
const now = new Date("2026-11-10T06:30:00.000Z");

describe("timeReadings", () => {
  it("asks nothing when the time is clear and has passed", () => {
    expect(timeReadings(event("2026-11-10T05:00:00.000Z"), false, now)).toBeNull();
    // "Just now" a couple of minutes ahead of the clock is still now.
    expect(timeReadings(event("2026-11-10T06:32:00.000Z"), false, now)).toBeNull();
  });

  it('offers both readings of "a las 9" at 07:30, most recent first, whichever the model picked', () => {
    const lastNight = [["2026-11-09T20:00:00.000Z", null], ["2026-11-09T08:00:00.000Z", null]];
    expect(starts(timeReadings(event("2026-11-09T20:00:00.000Z"), true, now))).toEqual(lastNight);
    // The model placed it this morning, still ahead: same two readings.
    expect(starts(timeReadings(event("2026-11-10T08:00:00.000Z"), true, now))).toEqual(lastNight);
  });

  it("moves a stated time that has not come yet back a day at a time", () => {
    expect(starts(timeReadings(event("2026-11-10T08:00:00.000Z"), false, now))).toEqual([
      ["2026-11-09T08:00:00.000Z", null],
      ["2026-11-08T08:00:00.000Z", null],
    ]);
  });

  it("reads the words for an hour that could be morning or evening", () => {
    for (const text of ["tomó 200 ml a las 9", "ambos pechos de 11 a 11:25", "durmió de 2 a 4:30", "bottle 90ml at 6", "pañal a las 12"]) {
      expect(statesUnclearClockTime(text), text).toBe(true);
    }
    for (const text of [
      "tomó 120 ml",
      "biberón de 150 ml",
      "biberón de 150 ml a las 21h",
      "a las 9 de la noche tomó 100 ml",
      "a las 9 de la mañana",
      "bottle at 6pm",
      "pañal sucio hace media hora",
      "durmió de 14 a 16:30",
    ]) {
      expect(statesUnclearClockTime(text), text).toBe(false);
    }
  });

  it("moves a range as a whole, by its end", () => {
    // "durmió de 6 a 8" at 07:30: the end has not come yet.
    expect(starts(timeReadings(event("2026-11-10T05:00:00.000Z", "2026-11-10T07:00:00.000Z"), true, now))).toEqual([
      ["2026-11-09T17:00:00.000Z", "2026-11-09T19:00:00.000Z"],
      ["2026-11-09T05:00:00.000Z", "2026-11-09T07:00:00.000Z"],
    ]);
  });
});
