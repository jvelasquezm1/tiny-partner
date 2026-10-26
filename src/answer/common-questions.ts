import type { StoredEvent } from "../db/events-repository.js";
import type { EventKind } from "../extract/event-schema.js";

/** Questions answered with SQL and a template: no LLM call. Anything else goes to Claude. */
export type CommonQuestion = "last_feed" | "last_sleep" | "last_diaper" | "feeds_today" | "sleep_today" | "diapers_today";

export const COMMON_QUESTION_DESCRIPTIONS: Record<CommonQuestion | "other", string> = {
  last_feed: "When the baby last ate",
  last_sleep: "When the baby last slept or how long the last sleep was",
  last_diaper: "When the last diaper change was",
  feeds_today: "How many feeds or how much milk today",
  sleep_today: "How much the baby slept today",
  diapers_today: "How many diapers today",
  other: "Any other question about the logged data",
};

export const KIND_OF: Record<CommonQuestion, EventKind> = {
  last_feed: "feed",
  last_sleep: "sleep",
  last_diaper: "diaper",
  feeds_today: "feed",
  sleep_today: "sleep",
  diapers_today: "diaper",
};

export function isToday(question: CommonQuestion): boolean {
  return question.endsWith("_today");
}

const LABEL: Record<EventKind, string> = { feed: "toma", sleep: "sueño", diaper: "pañal" };

export function answerLast(kind: EventKind, event: StoredEvent | null, now: Date, timeZone: string): string {
  if (!event) return `Aún no hay ningún ${LABEL[kind]} apuntado.`;
  const ago = since(new Date(event.startedAt), now);
  const at = clock(event.startedAt, timeZone);
  switch (kind) {
    case "feed":
      return `Última toma a las ${at} (hace ${ago})${event.amountMl ? `, ${event.amountMl} ml` : ""}${event.side ? `, pecho ${SIDE[event.side]}` : ""}.`;
    case "sleep":
      return event.endedAt
        ? `Último sueño de ${at} a ${clock(event.endedAt, timeZone)} (${duration(Date.parse(event.endedAt) - Date.parse(event.startedAt))}).`
        : `Está durmiendo desde las ${at} (hace ${ago}).`;
    case "diaper":
      return `Último pañal a las ${at} (hace ${ago})${event.diaper ? `, ${DIAPER[event.diaper]}` : ""}.`;
  }
}

export function answerToday(kind: EventKind, events: StoredEvent[], now: Date): string {
  switch (kind) {
    case "feed": {
      const ml = events.reduce((sum, e) => sum + (e.amountMl ?? 0), 0);
      return `Hoy lleva ${plural(events.length, "toma", "tomas")}${ml ? `, ${ml} ml en biberón` : ""}.`;
    }
    case "sleep": {
      const ms = events.reduce((sum, e) => sum + ((e.endedAt ? Date.parse(e.endedAt) : now.getTime()) - Date.parse(e.startedAt)), 0);
      return events.length ? `Hoy ha dormido ${duration(ms)} en ${plural(events.length, "sueño", "sueños")}.` : "Hoy aún no hay sueños apuntados.";
    }
    case "diaper": {
      const dirty = events.filter((e) => e.diaper === "dirty" || e.diaper === "both").length;
      return `Hoy lleva ${plural(events.length, "pañal", "pañales")}${dirty ? `, ${dirty} con caca` : ""}.`;
    }
  }
}

/** Midnight of `now`'s calendar day in `timeZone`, as a UTC instant. */
export function startOfLocalDay(now: Date, timeZone: string): Date {
  const { year, month, day } = partsIn(now, timeZone);
  const guess = Date.UTC(year, month - 1, day);
  const offset = offsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

const SIDE = { left: "izquierdo", right: "derecho", both: "ambos" } as const;
const DIAPER = { wet: "pipí", dirty: "caca", both: "pipí y caca" } as const;

function partsIn(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(date)
      .map((part) => [part.type, Number(part.value)]),
  );
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

function offsetMs(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

function clock(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone });
}

function since(from: Date, now: Date): string {
  return duration(now.getTime() - from.getTime());
}

function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
