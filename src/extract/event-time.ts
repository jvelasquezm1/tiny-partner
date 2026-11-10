import type { BabyEvent } from "./event-schema.js";

const HOUR_MS = 3_600_000;
/** "Just now" can land a few minutes ahead of the clock. */
const TOLERANCE_MS = 5 * 60_000;

/**
 * The readings of an event's time to offer the parent, most recent first, or null when its time is
 * clear. It is not clear when the clock time could be morning or evening, or when it has not come
 * yet (an event already happened). Then the bot asks rather than guesses. Morning or evening
 * readings are 12 hours apart ("a las 9" at 07:30: yesterday 21:00 or yesterday 09:00); a stated
 * time that is still ahead moves back a day at a time. A range moves as a whole.
 */
export function timeReadings(event: BabyEvent, ambiguousTime: boolean, now: Date): BabyEvent[] | null {
  const ahead = Date.parse(event.endedAt ?? event.startedAt) - (now.getTime() + TOLERANCE_MS);
  if (Number.isNaN(ahead) || (!ambiguousTime && ahead <= 0)) return null;
  const step = (ambiguousTime ? 12 : 24) * HOUR_MS;
  const latest = ahead > 0 ? Math.ceil(ahead / step) * step : 0;
  return [latest, latest + step].map((shift) => movedBack(event, shift));
}

/** Words that settle morning or evening. am/pm also after a digit ("6pm"), so no \b there. */
const PERIOD =
  /(?<![a-z])(?:a\.?m\.?|p\.?m\.?)(?![a-z])|\b(?:mañana|tarde|noche|madrugada|mediod[ií]a|medianoche|morning|afternoon|evening|night|noon|midnight)\b/i;
/** A clock time: an hour after "a las", "at", "de", "from"…, or written h:mm. "de 120 ml" is not one. */
const CLOCK = /\b(?:a\s+las?|at|de|desde|hasta|from|to|until|till)\s+(\d{1,2})(?::\d{2})?\b|\b(\d{1,2}):\d{2}\b/gi;

/**
 * A check on the model's own ambiguousTime, which missed "de 11 a 11:25": the words give an hour
 * from 1 to 12 and nothing that settles morning or evening. When it errs, it errs towards asking.
 */
export function statesUnclearClockTime(text: string): boolean {
  if (PERIOD.test(text)) return false;
  return [...text.matchAll(CLOCK)].some((match) => Number(match[1] ?? match[2]) <= 12);
}

function movedBack(event: BabyEvent, ms: number): BabyEvent {
  const back = (iso: string) => new Date(Date.parse(iso) - ms).toISOString();
  return { ...event, startedAt: back(event.startedAt), endedAt: event.endedAt && back(event.endedAt) };
}
