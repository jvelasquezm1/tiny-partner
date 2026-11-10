import type pg from "pg";
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL } from "../rag/embedder.js";

/** How the bot is running, fixed at startup (see main.ts). */
export interface RuntimeMode {
  offline: boolean;
  generator: "Claude" | "Gemini";
  jev: boolean;
}

/** Local dates in the bot's time zone, YYYY-MM-DD, both inclusive. */
export interface DateRange {
  from: string;
  to: string;
}

/** The admin page's period: a number of days ending today, or a custom from/to. Query-string values, unchecked. */
export interface RangeQuery {
  days?: string | null;
  from?: string | null;
  to?: string | null;
}

/** The requested period is malformed or too long; the message is for the person choosing it. */
export class InvalidRangeError extends Error {}

export interface Stats {
  mode: RuntimeMode;
  embedding: { model: string; dimension: number };
  messages: {
    /** The period every message number below covers. */
    range: DateRange;
    /** Counts by Outcome (see bot.ts); outcomes with no messages are absent. */
    byOutcome: Record<string, number>;
    avgMs: number | null;
    p95Ms: number | null;
    perDay: { day: string; count: number }[];
  };
  events: {
    byKind: Record<string, number>;
    households: number;
    perDay: { day: string; feed: number; sleep: number; diaper: number }[];
  };
  guidance: { avgChunkChars: number | null };
}

const DEFAULT_DAYS = 14;
/** One column per day: past this the columns get too thin to read or hover. */
export const MAX_RANGE_DAYS = 90;
const DAY_MS = 86_400_000;

/** Resolves ?days=N or ?from=&to= to a range in `timeZone`; neither means the last 14 days. */
export function resolveRange(query: RangeQuery, timeZone: string, now = new Date()): DateRange {
  if (query.from || query.to) {
    const { from, to } = query;
    if (!isDate(from) || !isDate(to) || from > to) throw new InvalidRangeError("Rango de fechas no válido");
    if ((Date.parse(to) - Date.parse(from)) / DAY_MS + 1 > MAX_RANGE_DAYS) {
      throw new InvalidRangeError(`El periodo puede ser de ${MAX_RANGE_DAYS} días como mucho`);
    }
    return { from, to };
  }
  const days = query.days ? Number(query.days) : DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_RANGE_DAYS) {
    throw new InvalidRangeError(`El periodo puede ser de 1 a ${MAX_RANGE_DAYS} días`);
  }
  // en-CA writes dates as YYYY-MM-DD.
  const to = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  return { from: new Date(Date.parse(to) - (days - 1) * DAY_MS).toISOString().slice(0, 10), to };
}

/** A real calendar date: 2026-02-30 parses in some engines, so it must survive the round trip. */
function isDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** $1 is the time zone, $2 and $3 the range's local dates. */
const inRange = (column: string) => `(${column} AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`;
/** Every day of the range, oldest first, each joined to the rows of `table` whose `column` falls on it. */
const daySeries = (table: string, column: string) =>
  `generate_series($2::date, $3::date, interval '1 day') AS d
   LEFT JOIN ${table} t ON (t.${column} AT TIME ZONE $1)::date = d::date`;

/** The admin page's numbers, read straight from the tables: nothing is precomputed. */
export class StatsRepository {
  constructor(
    private readonly pool: pg.Pool,
    private readonly timeZone: string,
    private readonly mode: RuntimeMode,
  ) {}

  /** Message numbers cover the requested period; the events chart always shows the last 14 days. */
  async load(query: RangeQuery = {}): Promise<Stats> {
    const range = resolveRange(query, this.timeZone);
    const messagesRange = [this.timeZone, range.from, range.to];
    const eventsRange = resolveRange({}, this.timeZone);
    const [outcomes, latency, messagesPerDay, kinds, households, eventsPerDay, chunks] = await Promise.all([
      this.query(`SELECT outcome AS key, count(*)::int AS count FROM messages WHERE ${inRange("created_at")} GROUP BY outcome`, messagesRange),
      this.query(
        `SELECT round(avg(duration_ms))::int AS avg_ms,
                round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_ms
         FROM messages WHERE ${inRange("created_at")}`,
        messagesRange,
      ),
      this.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day, count(t.id)::int AS count
         FROM ${daySeries("messages", "created_at")} GROUP BY d ORDER BY d`,
        messagesRange,
      ),
      this.query("SELECT kind::text AS key, count(*)::int AS count FROM events GROUP BY kind"),
      this.query("SELECT count(*)::int AS count FROM (SELECT chat_id FROM events UNION SELECT chat_id FROM messages) chats"),
      this.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day,
                (count(t.id) FILTER (WHERE t.kind = 'feed'))::int AS feed,
                (count(t.id) FILTER (WHERE t.kind = 'sleep'))::int AS sleep,
                (count(t.id) FILTER (WHERE t.kind = 'diaper'))::int AS diaper
         FROM ${daySeries("events", "started_at")} GROUP BY d ORDER BY d`,
        [this.timeZone, eventsRange.from, eventsRange.to],
      ),
      this.query("SELECT round(avg(length(content)))::int AS avg_chars FROM guidance_chunks"),
    ]);

    return {
      mode: this.mode,
      embedding: { model: EMBEDDING_MODEL, dimension: EMBEDDING_DIMENSION },
      messages: {
        range,
        byOutcome: Object.fromEntries(outcomes.map((row) => [row.key, row.count])),
        avgMs: latency[0]?.avg_ms ?? null,
        p95Ms: latency[0]?.p95_ms ?? null,
        perDay: messagesPerDay.map((row) => ({ day: row.day, count: row.count })),
      },
      events: {
        byKind: Object.fromEntries(kinds.map((row) => [row.key, row.count])),
        households: households[0]?.count ?? 0,
        perDay: eventsPerDay.map((row) => ({ day: row.day, feed: row.feed, sleep: row.sleep, diaper: row.diaper })),
      },
      guidance: { avgChunkChars: chunks[0]?.avg_chars ?? null },
    };
  }

  private async query(sql: string, params: unknown[] = []) {
    return (await this.pool.query(sql, params)).rows;
  }
}
