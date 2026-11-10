/**
 * "Tuesday 2026-11-10 07:30 (Europe/Madrid, GMT+01:00)": the current time in the parent's own clock,
 * for every prompt that resolves times. Models left to convert UTC themselves misplaced "a las 9"
 * and asked the parent when "today" starts.
 */
export function describeLocalTime(now: Date, timeZone: string): string {
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone, ...options }).format(now);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(now)
    .find(({ type }) => type === "timeZoneName")?.value;
  return `${part({ weekday: "long" })} ${part({})} ${part({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} (${timeZone}, ${offset})`;
}

/**
 * An instant as the parent's clock reads it, with its offset: "2026-11-10T08:15:00+01:00". Tool results
 * use it so the model never converts UTC: given 07:15Z, it sometimes reported a feed at 07:15.
 */
export function toLocalIso(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  );
  const offset = parts.timeZoneName!.replace("GMT", "") || "+00:00";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}
