import type { Bot, Context } from "grammy";
import type { EventsRepository } from "./db/events-repository.js";
import type { DataAnswerer } from "./answer/data-answerer.js";
import type { Decider, Intent } from "./decide/decider.js";
import { DecidersUnavailableError } from "./decide/fallback-decider.js";
import type { EventExtractor } from "./extract/extract-event.js";
import type { BabyEvent } from "./extract/event-schema.js";
import type { GuidanceAnswerer } from "./rag/guidance-answerer.js";

export const URGENT_REPLY =
  "⚠️ Esto puede ser urgente. Llama al 112 o a tu pediatra ahora. Este bot no da consejo médico.";
// When no decider works we cannot rule out an emergency, so the reply points to one.
export const UNAVAILABLE_REPLY =
  "⚠️ Ahora mismo no puedo procesar mensajes. Si es urgente, llama al 112 o a tu pediatra.";
const OTHER_REPLY =
  "Puedo apuntar tomas, sueño y pañales (\"tomó 120 ml\") y responder sobre lo apuntado (\"¿cuándo comió?\").";

export interface BotDeps {
  decider: Decider;
  extractor: Pick<EventExtractor, "extract">;
  events: EventsRepository;
  dataAnswerer: Pick<DataAnswerer, "answer">;
  guidanceAnswerer: Pick<GuidanceAnswerer, "answer">;
  allowedUserIds: Set<number>;
  timeZone: string;
}

export function registerHandlers(bot: Bot, deps: BotDeps): void {
  bot.use(async (ctx, next) => {
    if (ctx.from && deps.allowedUserIds.has(ctx.from.id)) await next();
    else console.log(`ignored user=${ctx.from?.id ?? "unknown"}: not in ALLOWED_TELEGRAM_USER_IDS`);
  });
  bot.on("message:text", async (ctx) => {
    const started = performance.now();
    const outcome = await handleText(ctx, ctx.message.text, deps);
    // Never the message text: it is the family's data.
    console.log(`msg chat=${ctx.chat.id} outcome=${outcome} decider=${deps.decider.name} ${Math.round(performance.now() - started)}ms`);
  });
}

/** What the bot did with a message, for the log line. */
export type Outcome = Intent | "urgent" | "unavailable";

export async function handleText(ctx: Context, text: string, deps: BotDeps): Promise<Outcome> {
  const chatId = ctx.chat!.id;
  const now = new Date();
  let decision;
  try {
    ({ decision } = await deps.decider.decide(text));
  } catch (error) {
    if (!(error instanceof DecidersUnavailableError)) throw error;
    console.error("no decider available", error.causes);
    await ctx.reply(UNAVAILABLE_REPLY);
    return "unavailable";
  }

  if (decision.type === "urgent") {
    await ctx.reply(URGENT_REPLY);
    return "urgent";
  }

  switch (decision.intent) {
    case "log_event": {
      const event = await deps.extractor.extract(text, now, deps.timeZone);
      await deps.events.insert(chatId, event, text);
      await ctx.reply(`✅ ${describe(event, deps.timeZone)}`);
      return decision.intent;
    }
    case "ask_about_data":
      await ctx.reply(await deps.dataAnswerer.answer(chatId, text, now, deps.timeZone));
      return decision.intent;
    case "ask_guidance":
      await ctx.reply(await deps.guidanceAnswerer.answer(text));
      return decision.intent;
    case "other":
      await ctx.reply(OTHER_REPLY);
      return decision.intent;
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
