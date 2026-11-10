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
