import { randomUUID } from "node:crypto";
import type { BabyEvent } from "./extract/event-schema.js";

/** Long enough to answer after settling the baby; past it the parent writes the event again. */
const TTL_MS = 30 * 60_000;

export interface PendingEvent {
  chatId: number;
  sourceText: string;
  /** The readings offered as buttons, in button order. */
  readings: BabyEvent[];
  expiresAt: number;
}

/**
 * Events waiting for the parent to pick their time, by the short id their buttons carry. Kept in
 * memory: nothing is saved until a pick, so a restart only means writing the event again.
 */
export class PendingEvents {
  private readonly pending = new Map<string, PendingEvent>();

  add(chatId: number, sourceText: string, readings: BabyEvent[], now = Date.now()): string {
    for (const [id, entry] of this.pending) if (entry.expiresAt <= now) this.pending.delete(id);
    const id = randomUUID().slice(0, 8);
    this.pending.set(id, { chatId, sourceText, readings, expiresAt: now + TTL_MS });
    return id;
  }

  /** Removes the entry as it returns it, so a second tap cannot save the event twice. */
  take(id: string, chatId: number, now = Date.now()): PendingEvent | null {
    const entry = this.pending.get(id);
    if (!entry || entry.chatId !== chatId) return null;
    this.pending.delete(id);
    return entry.expiresAt > now ? entry : null;
  }
}
