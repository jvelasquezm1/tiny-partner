import type pg from "pg";
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL } from "../rag/embedder.js";

/** How the bot is running, fixed at startup (see main.ts). */
export interface RuntimeMode {
  offline: boolean;
  generator: "Claude" | "Gemini";
  jev: boolean;
}

export interface Stats {
  mode: RuntimeMode;
  embedding: { model: string; dimension: number };
  messages: {
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

const DAYS = 14;

/** The last DAYS local days, oldest first, each joined to the rows of `table` whose `column` falls on it. */
const lastDays = (table: string, column: string) =>
  `generate_series((now() AT TIME ZONE $1)::date - ${DAYS - 1}, (now() AT TIME ZONE $1)::date, interval '1 day') AS d
   LEFT JOIN ${table} t ON (t.${column} AT TIME ZONE $1)::date = d::date`;

/** The admin page's numbers, read straight from the tables: nothing is precomputed. */
export class StatsRepository {
  constructor(
    private readonly pool: pg.Pool,
    private readonly timeZone: string,
    private readonly mode: RuntimeMode,
  ) {}

  async load(): Promise<Stats> {
    const [outcomes, latency, messagesPerDay, kinds, households, eventsPerDay, chunks] = await Promise.all([
      this.query("SELECT outcome AS key, count(*)::int AS count FROM messages GROUP BY outcome"),
      this.query(
        `SELECT round(avg(duration_ms))::int AS avg_ms,
                round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_ms
         FROM messages`,
      ),
      this.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day, count(t.id)::int AS count
         FROM ${lastDays("messages", "created_at")} GROUP BY d ORDER BY d`,
        [this.timeZone],
      ),
      this.query("SELECT kind::text AS key, count(*)::int AS count FROM events GROUP BY kind"),
      this.query("SELECT count(*)::int AS count FROM (SELECT chat_id FROM events UNION SELECT chat_id FROM messages) chats"),
      this.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day,
                (count(t.id) FILTER (WHERE t.kind = 'feed'))::int AS feed,
                (count(t.id) FILTER (WHERE t.kind = 'sleep'))::int AS sleep,
                (count(t.id) FILTER (WHERE t.kind = 'diaper'))::int AS diaper
         FROM ${lastDays("events", "started_at")} GROUP BY d ORDER BY d`,
        [this.timeZone],
      ),
      this.query("SELECT round(avg(length(content)))::int AS avg_chars FROM guidance_chunks"),
    ]);

    return {
      mode: this.mode,
      embedding: { model: EMBEDDING_MODEL, dimension: EMBEDDING_DIMENSION },
      messages: {
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
