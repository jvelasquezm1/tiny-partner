import type pg from "pg";
import type { Outcome } from "../bot.js";

/** What the bot did with one message, as the log line says it. Never the message text. */
export interface HandledMessage {
  chatId: number;
  outcome: Outcome;
  decider: string;
  durationMs: number;
}

export class MessagesRepository {
  constructor(private readonly pool: pg.Pool) {}

  async record(message: HandledMessage): Promise<void> {
    await this.pool.query("INSERT INTO messages (chat_id, outcome, decider, duration_ms) VALUES ($1, $2, $3, $4)", [
      message.chatId,
      message.outcome,
      message.decider,
      message.durationMs,
    ]);
  }
}
