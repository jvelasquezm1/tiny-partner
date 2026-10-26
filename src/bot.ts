import type { Bot, Context } from "grammy";
import type { EventsRepository } from "./db/events-repository.js";
import type { DataAnswerer } from "./answer/data-answerer.js";
import type { Decider } from "./decide/decider.js";
import type { EventExtractor } from "./extract/extract-event.js";
import type { BabyEvent } from "./extract/event-schema.js";
import type { GuidanceAnswerer } from "./rag/guidance-answerer.js";

export const URGENT_REPLY =
  "⚠️ Esto puede ser urgente. Llama al 112 o a tu pediatra ahora. Este bot no da consejo médico.";
const OTHER_REPLY =
  "Puedo apuntar tomas, sueño y pañales (\"tomó 120 ml\") y responder sobre lo apuntado (\"¿cuándo comió?\").";

export interface BotDeps {
  decider: Decider;
  extractor: EventExtractor;
  events: EventsRepository;
  dataAnswerer: DataAnswerer;
  guidanceAnswerer: GuidanceAnswerer;
  allowedUserIds: Set<number>;
  timeZone: string;
}

export function registerHandlers(bot: Bot, deps: BotDeps): void {
  bot.use(async (ctx, next) => {
    if (ctx.from && deps.allowedUserIds.has(ctx.from.id)) await next();
  });
  bot.on("message:text", (ctx) => handleText(ctx, ctx.message.text, deps));
}

export async function handleText(ctx: Context, text: string, deps: BotDeps): Promise<void> {
  const chatId = ctx.chat!.id;
  const now = new Date();
  const { decision } = await deps.decider.decide(text);

  if (decision.type === "urgent") {
    await ctx.reply(URGENT_REPLY);
    return;
  }

  switch (decision.intent) {
    case "log_event": {
      const event = await deps.extractor.extract(text, now, deps.timeZone);
      await deps.events.insert(chatId, event, text);
      await ctx.reply(`✅ ${describe(event, deps.timeZone)}`);
      return;
    }
    case "ask_about_data":
      await ctx.reply(await deps.dataAnswerer.answer(chatId, text, now, deps.timeZone));
      return;
    case "ask_guidance":
      await ctx.reply(await deps.guidanceAnswerer.answer(text));
      return;
    case "other":
      await ctx.reply(OTHER_REPLY);
      return;
  }
}

export function describe(event: BabyEvent, timeZone: string): string {
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone });
  const range = event.endedAt ? `${time(event.startedAt)}–${time(event.endedAt)}` : time(event.startedAt);
  switch (event.kind) {
    case "feed":
      return `Toma ${range}${event.amountMl ? `, ${event.amountMl} ml` : ""}${event.side ? ` (${event.side})` : ""}`;
    case "sleep":
      return `Sueño ${range}`;
    case "diaper":
      return `Pañal ${range}${event.diaper ? ` (${event.diaper})` : ""}`;
  }
}
