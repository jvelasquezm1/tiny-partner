import type { Context } from "grammy";
import { describe as suite, expect, it, vi } from "vitest";
import {
  CANCELLED_REPLY,
  describe,
  EXPIRED_CHOICE_REPLY,
  handleText,
  handleTimeChoice,
  UNAVAILABLE_REPLY,
  URGENT_REPLY,
  type BotDeps,
} from "./bot.js";
import { Conversations } from "./conversation.js";
import { DecidersUnavailableError } from "./decide/fallback-decider.js";
import type { Decision } from "./decide/decider.js";
import type { BabyEvent } from "./extract/event-schema.js";
import { PendingEvents } from "./pending-events.js";
import { NO_SOURCE_REPLY } from "./rag/guidance-answerer.js";

const feed: BabyEvent = {
  kind: "feed",
  startedAt: "2026-11-10T14:00:00.000Z",
  endedAt: null,
  amountMl: 120,
  side: null,
  diaper: null,
  note: null,
};
// 17:00 in Madrid, the same day as the feed (15:00 there).
const now = new Date("2026-11-10T16:00:00.000Z");

function setup(decision: Decision) {
  const reply = vi.fn();
  const ctx = { chat: { id: 7 }, reply, answerCallbackQuery: vi.fn(), editMessageText: vi.fn() } as unknown as Context;
  const deps = {
    decider: { name: "fake", decide: vi.fn().mockResolvedValue({ decision, usage: { inputTokens: 0, outputTokens: 0 } }) },
    followUps: { resolve: vi.fn(async (message: string) => message) },
    conversations: new Conversations(),
    extractor: { extract: vi.fn().mockResolvedValue({ ...feed, ambiguousTime: false }) },
    events: { insert: vi.fn().mockResolvedValue(1) },
    dataAnswerer: { answer: vi.fn().mockResolvedValue("Hace 2 horas.") },
    guidanceAnswerer: { answer: vi.fn() },
    pending: new PendingEvents(),
    allowedUserIds: new Set([1]),
    timeZone: "Europe/Madrid",
  } as unknown as BotDeps;
  return { ctx, deps, reply };
}

suite("handleText", () => {
  it("answers an urgent message with the fixed safety reply and never calls an LLM", async () => {
    const { ctx, deps, reply } = setup({ type: "urgent", probability: 0.9 });
    expect(await handleText(ctx, "tiene 39 de fiebre y 2 semanas", deps)).toBe("urgent");
    expect(reply).toHaveBeenCalledWith(URGENT_REPLY);
    expect(deps.extractor.extract).not.toHaveBeenCalled();
    expect(deps.dataAnswerer.answer).not.toHaveBeenCalled();
  });

  it("extracts and stores a logged event", async () => {
    const { ctx, deps, reply } = setup({ type: "route", intent: "log_event", confidence: 0.95 });
    await handleText(ctx, "tomó 120 ml a las 15h", deps, now);
    expect(deps.events.insert).toHaveBeenCalledWith(7, feed, "tomó 120 ml a las 15h");
    expect(reply).toHaveBeenCalledWith("✅ Toma 15:00, 120 ml");
  });

  it("asks morning or evening instead of guessing, and saves only the reading the parent picks", async () => {
    const { ctx, deps, reply } = setup({ type: "route", intent: "log_event", confidence: 0.95 });
    vi.mocked(deps.extractor.extract).mockResolvedValue({ ...feed, ambiguousTime: true });
    await handleText(ctx, "tomó 120 ml a las 3", deps, now);
    expect(deps.events.insert).not.toHaveBeenCalled();

    const [question, { reply_markup }] = reply.mock.calls[0]!;
    expect(question).toBe("⏰ ¿Cuándo fue la toma de 120 ml?");
    const buttons = reply_markup.inline_keyboard.flat();
    expect(buttons.map((button: { text: string }) => button.text)).toEqual(["Hoy 15:00", "Hoy 03:00", "Cancelar"]);

    const [, id] = buttons[1].callback_data.split(":");
    await handleTimeChoice(ctx, id, "1", deps, now);
    expect(deps.events.insert).toHaveBeenCalledWith(7, { ...feed, startedAt: "2026-11-10T02:00:00.000Z" }, "tomó 120 ml a las 3");
    expect(ctx.editMessageText).toHaveBeenLastCalledWith("✅ Toma 03:00, 120 ml");

    // A second tap on the same question saves nothing more.
    await handleTimeChoice(ctx, id, "0", deps, now);
    expect(deps.events.insert).toHaveBeenCalledOnce();
    expect(ctx.editMessageText).toHaveBeenLastCalledWith(EXPIRED_CHOICE_REPLY);
  });

  it("asks when the time has not come yet, and saves nothing when the parent cancels", async () => {
    const { ctx, deps, reply } = setup({ type: "route", intent: "log_event", confidence: 0.95 });
    const early = new Date("2026-11-10T06:30:00.000Z"); // 07:30 in Madrid
    vi.mocked(deps.extractor.extract).mockResolvedValue({ ...feed, startedAt: "2026-11-10T08:00:00.000Z", ambiguousTime: false });
    await handleText(ctx, "tomó 120 ml a las 9 de la mañana", deps, early);

    const buttons = reply.mock.calls[0]![1].reply_markup.inline_keyboard.flat();
    expect(buttons.map((button: { text: string }) => button.text)).toEqual(["Ayer 09:00", "Dom, 8 nov 09:00", "Cancelar"]);
    await handleTimeChoice(ctx, buttons[2].callback_data.split(":")[1], "cancel", deps, early);
    expect(deps.events.insert).not.toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalledWith(CANCELLED_REPLY);
  });

  it("tells the parent to call emergency services when no decider is available", async () => {
    const { ctx, deps, reply } = setup({ type: "route", intent: "other", confidence: 1 });
    vi.mocked(deps.decider.decide).mockRejectedValue(new DecidersUnavailableError([]));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await handleText(ctx, "no respira bien", deps)).toBe("unavailable");
    expect(reply).toHaveBeenCalledWith(UNAVAILABLE_REPLY);
  });

  it("routes data questions to the data answerer", async () => {
    const { ctx, deps, reply } = setup({ type: "route", intent: "ask_about_data", confidence: 0.9 });
    await handleText(ctx, "¿cuándo comió?", deps);
    expect(reply).toHaveBeenCalledWith("Hace 2 horas.");
  });

  it("tells a sourced guidance answer apart from the no-source reply", async () => {
    const { ctx, deps } = setup({ type: "route", intent: "ask_guidance", confidence: 0.9 });
    vi.mocked(deps.guidanceAnswerer.answer).mockResolvedValueOnce("Boca arriba [1].").mockResolvedValueOnce(NO_SOURCE_REPLY);
    expect(await handleText(ctx, "¿cómo lo acuesto?", deps)).toBe("ask_guidance");
    expect(await handleText(ctx, "¿qué vacunas le tocan?", deps)).toBe("no_source");
  });
});

suite("follow-ups", () => {
  it("reads a follow-up as the question it follows, and remembers both sides", async () => {
    const { ctx, deps, reply } = setup({ type: "route", intent: "ask_guidance", confidence: 0.9 });
    vi.mocked(deps.guidanceAnswerer.answer).mockResolvedValue("No: comparta la habitación, no la cama [1].");
    await handleText(ctx, "¿puedo dormir con el bebé en mi cama?", deps, now);
    // The first message of a conversation is read alone: no rewrite to pay for.
    expect(deps.followUps.resolve).not.toHaveBeenCalled();

    vi.mocked(deps.followUps.resolve).mockResolvedValueOnce("¿Por qué no puedo dormir con el bebé en mi cama?");
    await handleText(ctx, "¿Por qué no conmigo?", deps, now);
    expect(deps.followUps.resolve).toHaveBeenCalledWith("¿Por qué no conmigo?", [
      { role: "parent", text: "¿puedo dormir con el bebé en mi cama?" },
      { role: "bot", text: "No: comparta la habitación, no la cama [1]." },
    ]);
    expect(deps.decider.decide).toHaveBeenLastCalledWith("¿Por qué no puedo dormir con el bebé en mi cama?");
    expect(deps.guidanceAnswerer.answer).toHaveBeenLastCalledWith("¿Por qué no puedo dormir con el bebé en mi cama?");
    expect(reply).toHaveBeenCalledTimes(2);
  });

  it("reads the message alone when the rewrite fails", async () => {
    const { ctx, deps } = setup({ type: "route", intent: "other", confidence: 1 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    deps.conversations.add(7, "parent", "hola");
    vi.mocked(deps.followUps.resolve).mockRejectedValue(new Error("haiku down"));
    await handleText(ctx, "¿y ahora?", deps, now);
    expect(deps.decider.decide).toHaveBeenCalledWith("¿y ahora?");
  });
});

suite("describe", () => {
  it("formats a sleep range in the household time zone", () => {
    const sleep: BabyEvent = { ...feed, kind: "sleep", amountMl: null, endedAt: "2026-11-10T16:30:00.000Z" };
    expect(describe(sleep, "Europe/Madrid", now)).toBe("Sueño 15:00–17:30");
  });

  it("names the day whenever it is not today, so a misread time shows", () => {
    const lastNight: BabyEvent = { ...feed, startedAt: "2026-11-09T20:00:00.000Z" };
    expect(describe(lastNight, "Europe/Madrid", now)).toBe("Toma ayer 21:00, 120 ml");
    expect(describe({ ...feed, startedAt: "2026-11-03T08:00:00.000Z" }, "Europe/Madrid", now)).toBe("Toma mar, 3 nov 09:00, 120 ml");
  });
});
