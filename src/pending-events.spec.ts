import { describe, expect, it } from "vitest";
import type { BabyEvent } from "./extract/event-schema.js";
import { PendingEvents } from "./pending-events.js";

const reading: BabyEvent = {
  kind: "feed",
  startedAt: "2026-11-09T20:00:00.000Z",
  endedAt: null,
  amountMl: 200,
  side: null,
  diaper: null,
  note: null,
};

describe("PendingEvents", () => {
  it("hands an entry back once, and only to its own chat", () => {
    const pending = new PendingEvents();
    const id = pending.add(7, "tomó 200 ml a las 9", [reading], 0);
    expect(pending.take(id, 8, 1)).toBeNull();
    expect(pending.take(id, 7, 1)?.readings).toEqual([reading]);
    expect(pending.take(id, 7, 1)).toBeNull();
  });

  it("forgets an entry after 30 minutes", () => {
    const pending = new PendingEvents();
    const id = pending.add(7, "tomó 200 ml a las 9", [reading], 0);
    expect(pending.take(id, 7, 30 * 60_000)).toBeNull();
  });
});
