export interface Turn {
  role: "parent" | "bot";
  text: string;
}

/** A follow-up comes within minutes; past this the next message starts a new conversation. */
const TTL_MS = 30 * 60_000;
/** Three exchanges are enough to read "¿y por qué no?" without paying for a long history. */
const MAX_TURNS = 6;
/** Guidance replies carry sources and a disclaimer: the start says what was answered. */
const MAX_CHARS = 500;

/**
 * The last turns of each chat, so a follow-up ("¿Por qué no conmigo?") can be read in context. In
 * memory only, never stored or logged: it is the family's own words. A restart forgets it.
 */
export class Conversations {
  private readonly chats = new Map<number, { turns: Turn[]; updatedAt: number }>();

  recent(chatId: number, now = Date.now()): Turn[] {
    const chat = this.chats.get(chatId);
    if (chat && now - chat.updatedAt > TTL_MS) this.chats.delete(chatId);
    return [...(this.chats.get(chatId)?.turns ?? [])];
  }

  add(chatId: number, role: Turn["role"], text: string, now = Date.now()): void {
    const turns = [...this.recent(chatId, now), { role, text: text.slice(0, MAX_CHARS) }].slice(-MAX_TURNS);
    this.chats.set(chatId, { turns, updatedAt: now });
  }
}
