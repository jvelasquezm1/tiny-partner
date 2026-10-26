import type pg from "pg";
import type { BabyEvent, EventKind } from "../extract/event-schema.js";

export interface StoredEvent extends BabyEvent {
  id: number;
}

export class EventsRepository {
  constructor(private readonly pool: pg.Pool) {}

  async insert(chatId: number, event: BabyEvent, sourceText: string): Promise<number> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO events (chat_id, kind, started_at, ended_at, amount_ml, side, diaper, note, source_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [chatId, event.kind, event.startedAt, event.endedAt, event.amountMl, event.side, event.diaper, event.note, sourceText],
    );
    return Number(rows[0]!.id);
  }

  async last(chatId: number, kind: EventKind): Promise<StoredEvent | null> {
    const rows = await this.select(chatId, "kind = $2 ORDER BY started_at DESC LIMIT 1", [kind]);
    return rows[0] ?? null;
  }

  async between(chatId: number, from: string, to: string, kind?: EventKind): Promise<StoredEvent[]> {
    return kind
      ? this.select(chatId, "started_at >= $2 AND started_at < $3 AND kind = $4 ORDER BY started_at", [from, to, kind])
      : this.select(chatId, "started_at >= $2 AND started_at < $3 ORDER BY started_at", [from, to]);
  }

  private async select(chatId: number, where: string, params: unknown[]): Promise<StoredEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT id, kind, started_at, ended_at, amount_ml, side, diaper, note
       FROM events WHERE chat_id = $1 AND ${where}`,
      [chatId, ...params],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      kind: row.kind,
      startedAt: row.started_at.toISOString(),
      endedAt: row.ended_at?.toISOString() ?? null,
      amountMl: row.amount_ml,
      side: row.side,
      diaper: row.diaper,
      note: row.note,
    }));
  }
}
