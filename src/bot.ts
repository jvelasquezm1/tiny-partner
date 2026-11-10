import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { EventsRepository } from "./db/events-repository.js";
import type { MessagesRepository } from "./db/messages-repository.js";
import type { DataAnswerer } from "./answer/data-answerer.js";
import type { Conversations } from "./conversation.js";
import type { Decider, Intent } from "./decide/decider.js";
import { DecidersUnavailableError } from "./decide/fallback-decider.js";
import type { FollowUpResolver } from "./decide/follow-up.js";
import { ExtractionError, type EventExtractor } from "./extract/extract-event.js";
import type { BabyEvent } from "./extract/event-schema.js";
import { statesUnclearClockTime, timeReadings } from "./extract/event-time.js";
import type { PendingEvents } from "./pending-events.js";
import { NO_SOURCE_REPLY, type GuidanceAnswerer } from "./rag/guidance-answerer.js";

export const URGENT_REPLY =
  "⚠️ Esto puede ser urgente. Llama al 112 o a tu pediatra ahora. Este bot no da consejo médico.";
// When no decider works we cannot rule out an emergency, so the reply points to one.
export const UNAVAILABLE_REPLY =
  "⚠️ Ahora mismo no puedo procesar mensajes. Si es urgente, llama al 112 o a tu pediatra.";
const OTHER_REPLY =
  "Puedo apuntar tomas, sueño y pañales (\"tomó 120 ml\") y responder sobre lo apuntado (\"¿cuándo comió?\").";
// Haiku 5.5 runs safety classifiers with no fallback model: a declined step gets a reply, never silence.
export const UNREADABLE_EVENT_REPLY = "No he podido apuntarlo. Escríbelo de otra forma, por ejemplo: «tomó 120 ml a las 15h».";
export const NO_DATA_ANSWER_REPLY = "No he podido responder eso ahora. Prueba a preguntarlo de otra forma.";
export const CANCELLED_REPLY = "❌ No he apuntado nada.";
export const EXPIRED_CHOICE_REPLY = "Esta pregunta ya no está activa: vuelve a escribirlo.";

export interface BotDeps {
  decider: Decider;
  /** Rewrites a follow-up so it stands alone, from the chat's recent turns. */
  followUps: FollowUpResolver;
  conversations: Pick<Conversations, "recent" | "add">;
  extractor: Pick<EventExtractor, "extract">;
  events: EventsRepository;
  messages: Pick<MessagesRepository, "record">;
  /** Events whose time the parent still has to pick (see timeReadings). */
  pending: Pick<PendingEvents, "add" | "take">;
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
    const durationMs = Math.round(performance.now() - started);
    // Never the message text: it is the family's data.
    console.log(`msg chat=${ctx.chat.id} outcome=${outcome} decider=${deps.decider.name} ${durationMs}ms`);
    // After the reply: a failed write costs a stat, never an answer.
    await deps.messages
      .record({ chatId: ctx.chat.id, outcome, decider: deps.decider.name, durationMs })
      .catch((error) => console.error("could not record message stats", error));
  });
  bot.callbackQuery(/^when:([\w-]+):(\d+|cancel)$/, (ctx) => handleTimeChoice(ctx, ctx.match[1]!, ctx.match[2]!, deps));
}

/** What the bot did with a message, for the log line and the admin page's stats. */
export type Outcome = Intent | "no_source" | "urgent" | "unavailable";

export async function handleText(ctx: Context, message: string, deps: BotDeps, now = new Date()): Promise<Outcome> {
  const chatId = ctx.chat!.id;
  // Every step reads the message as it stands alone: "¿Por qué no conmigo?" becomes the question it follows up.
  const text = await standalone(chatId, message, deps);
  deps.conversations.add(chatId, "parent", text);
  const reply = async (answer: string, other?: Parameters<Context["reply"]>[1]) => {
    deps.conversations.add(chatId, "bot", answer);
    await (other ? ctx.reply(answer, other) : ctx.reply(answer));
  };
  let decision;
  try {
    ({ decision } = await deps.decider.decide(text));
  } catch (error) {
    if (!(error instanceof DecidersUnavailableError)) throw error;
    console.error("no decider available", error.causes);
    await reply(UNAVAILABLE_REPLY);
    return "unavailable";
  }

  if (decision.type === "urgent") {
    await reply(URGENT_REPLY);
    return "urgent";
  }

  switch (decision.intent) {
    case "log_event": {
      let extracted;
      try {
        extracted = await deps.extractor.extract(text, now, deps.timeZone);
      } catch (error) {
        if (!(error instanceof ExtractionError)) throw error;
        console.warn("could not extract an event", error.stopReason);
        await reply(UNREADABLE_EVENT_REPLY);
        return decision.intent;
      }
      const { ambiguousTime, ...event } = extracted;
      // A time that is not clear is asked, never guessed: nothing is saved until the parent picks one.
      const readings = timeReadings(event, ambiguousTime || statesUnclearClockTime(text), now);
      if (readings) {
        const id = deps.pending.add(chatId, text, readings);
        const keyboard = new InlineKeyboard();
        readings.forEach((reading, i) => keyboard.text(capitalize(when(reading, deps.timeZone, now, "hoy ")), `when:${id}:${i}`));
        await reply(`⏰ ¿Cuándo fue ${subject(event)}?`, { reply_markup: keyboard.row().text("Cancelar", `when:${id}:cancel`) });
        return decision.intent;
      }
      await deps.events.insert(chatId, event, text);
      await reply(`✅ ${describe(event, deps.timeZone, now)}`);
      return decision.intent;
    }
    case "ask_about_data":
      // A declined or empty answer would be an empty Telegram message, which Telegram rejects.
      await reply((await deps.dataAnswerer.answer(chatId, text, now, deps.timeZone)) || NO_DATA_ANSWER_REPLY);
      return decision.intent;
    case "ask_guidance": {
      const answer = await deps.guidanceAnswerer.answer(text);
      await reply(answer);
      return answer === NO_SOURCE_REPLY ? "no_source" : decision.intent;
    }
    case "other":
      await reply(OTHER_REPLY);
      return decision.intent;
  }
}

/** Reads a message in the light of the chat's recent turns; alone if there are none or the rewrite fails. */
async function standalone(chatId: number, message: string, deps: BotDeps): Promise<string> {
  const turns = deps.conversations.recent(chatId);
  if (turns.length === 0) return message;
  try {
    return await deps.followUps.resolve(message, turns);
  } catch (error) {
    console.warn("could not read the message as a follow-up, reading it alone", error);
    return message;
  }
}

/** The parent tapped one of the offered times, or Cancelar: the event is saved then, never before. */
export async function handleTimeChoice(ctx: Context, id: string, choice: string, deps: BotDeps, now = new Date()): Promise<void> {
  const entry = deps.pending.take(id, ctx.chat!.id);
  const event = choice === "cancel" ? undefined : entry?.readings[Number(choice)];
  if (entry && event) await deps.events.insert(ctx.chat!.id, event, entry.sourceText);
  await ctx.answerCallbackQuery();
  // Editing the question also removes its buttons.
  await ctx.editMessageText(!entry ? EXPIRED_CHOICE_REPLY : event ? `✅ ${describe(event, deps.timeZone, now)}` : CANCELLED_REPLY);
}

export function describe(event: BabyEvent, timeZone: string, now: Date): string {
  const range = when(event, timeZone, now);
  switch (event.kind) {
    case "feed":
      return `Toma ${range}${event.amountMl ? `, ${event.amountMl} ml` : ""}${event.side ? ` (${event.side})` : ""}`;
    case "sleep":
      return `Sueño ${range}`;
    case "diaper":
      return `Pañal ${range}${event.diaper ? ` (${event.diaper})` : ""}`;
  }
}

/** The event's time, with its day whenever it is not today: "21:00", "ayer 21:00", "lun, 3 nov 21:00". */
function when(event: BabyEvent, timeZone: string, now: Date, today = ""): string {
  const time = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone });
  const range = event.endedAt ? `${time(event.startedAt)}–${time(event.endedAt)}` : time(event.startedAt);
  const localDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
  const start = new Date(event.startedAt);
  if (localDay(start) === localDay(now)) return `${today}${range}`;
  if (localDay(start) === localDay(new Date(now.getTime() - 86_400_000))) return `ayer ${range}`;
  return `${start.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", timeZone })} ${range}`;
}

function subject(event: BabyEvent): string {
  switch (event.kind) {
    case "feed":
      return `la toma${event.amountMl ? ` de ${event.amountMl} ml` : ""}`;
    case "sleep":
      return "el sueño";
    case "diaper":
      return "el pañal";
  }
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
