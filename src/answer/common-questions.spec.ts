import { describe, expect, it } from "vitest";
import type { StoredEvent } from "../db/events-repository.js";
import { answerLast, answerToday, startOfLocalDay } from "./common-questions.js";

const TZ = "Europe/Madrid";
const now = new Date("2026-11-10T14:30:00.000Z"); // 15:30 in Madrid

const event = (over: Partial<StoredEvent>): StoredEvent => ({
  id: 1,
  kind: "feed",
  startedAt: "2026-11-10T12:00:00.000Z",
  endedAt: null,
  amountMl: null,
  side: null,
  diaper: null,
  note: null,
  ...over,
});

describe("startOfLocalDay", () => {
  it("is local midnight, not UTC midnight", () => {
    expect(startOfLocalDay(now, TZ).toISOString()).toBe("2026-11-09T23:00:00.000Z");
  });

  it("follows the summer offset", () => {
    expect(startOfLocalDay(new Date("2026-07-01T10:00:00.000Z"), TZ).toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });
});

describe("answerLast", () => {
  it("says when the last feed was and how much", () => {
    expect(answerLast("feed", event({ amountMl: 120 }), now, TZ)).toBe("Última toma a las 13:00 (hace 2 h 30 min), 120 ml.");
  });

  it("reports an ongoing sleep", () => {
    expect(answerLast("sleep", event({ kind: "sleep", startedAt: "2026-11-10T14:00:00.000Z" }), now, TZ)).toBe(
      "Está durmiendo desde las 15:00 (hace 30 min).",
    );
  });

  it("handles an empty log", () => {
    expect(answerLast("diaper", null, now, TZ)).toBe("Aún no hay ningún pañal apuntado.");
  });
});

describe("answerToday", () => {
  it("sums sleep, counting an ongoing sleep up to now", () => {
    const sleeps = [
      event({ kind: "sleep", startedAt: "2026-11-10T08:00:00.000Z", endedAt: "2026-11-10T09:30:00.000Z" }),
      event({ kind: "sleep", startedAt: "2026-11-10T14:00:00.000Z" }),
    ];
    expect(answerToday("sleep", sleeps, now)).toBe("Hoy ha dormido 2 h en 2 sueños.");
  });

  it("counts feeds and bottle volume", () => {
    expect(answerToday("feed", [event({ amountMl: 90 }), event({ amountMl: 120 }), event({})], now)).toBe(
      "Hoy lleva 3 tomas, 210 ml en biberón.",
    );
  });
});
