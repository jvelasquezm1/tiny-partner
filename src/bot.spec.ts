import type { Context } from "grammy";
import { describe as suite, expect, it, vi } from "vitest";
import { describe, handleText, URGENT_REPLY, type BotDeps } from "./bot.js";
import type { Decision } from "./decide/decider.js";
import type { BabyEvent } from "./extract/event-schema.js";

const feed: BabyEvent = {
  kind: "feed",
  startedAt: "2026-11-10T14:00:00.000Z",
  endedAt: null,
  amountMl: 120,
  side: null,
  diaper: null,
  note: null,
};

function setup(decision: Decision) {
  const reply = vi.fn();
  const ctx = { chat: { id: 7 }, reply } as unknown as Context;
  const deps = {
    decider: { name: "fake", decide: vi.fn().mockResolvedValue({ decision, usage: { inputTokens: 0, outputTokens: 0 } }) },
    extractor: { extract: vi.fn().mockResolvedValue(feed) },
    events: { insert: vi.fn().mockResolvedValue(1) },
    dataAnswerer: { answer: vi.fn().mockResolvedValue("Hace 2 horas.") },
    guidanceAnswerer: { answer: vi.fn() },
    allowedUserIds: new Set([1]),
    timeZone: "Europe/Madrid",
  } as unknown as BotDeps;
  return { ctx, deps, reply };
}

suite("handleText", () => {
  it("answers an urgent message with the fixed safety reply and never calls an LLM", async () => {
    const { ctx, deps, reply } = setup({ type: "urgent", probability: 0.9 });
    await handleText(ctx, "tiene 39 de fiebre y 2 semanas", deps);
    expect(reply).toHaveBeenCalledWith(URGENT_REPLY);
    expect(deps.extractor.extract).not.toHaveBeenCalled();
    expect(deps.dataAnswerer.answer).not.toHaveBeenCalled();
  });

  it("extracts and stores a logged event", async () => {
    const { ctx, deps, reply } = setup({ type: "route", intent: "log_event", confidence: 0.95 });
    await handleText(ctx, "tomó 120 ml a las 4", deps);
    expect(deps.events.insert).toHaveBeenCalledWith(7, feed, "tomó 120 ml a las 4");
    expect(reply).toHaveBeenCalledWith("✅ Toma 15:00, 120 ml");
  });

  it("routes data questions to the data answerer", async () => {
    const { ctx, deps, reply } = setup({ type: "route", intent: "ask_about_data", confidence: 0.9 });
    await handleText(ctx, "¿cuándo comió?", deps);
    expect(reply).toHaveBeenCalledWith("Hace 2 horas.");
  });
});

suite("describe", () => {
  it("formats a sleep range in the household time zone", () => {
    const sleep: BabyEvent = { ...feed, kind: "sleep", amountMl: null, endedAt: "2026-11-10T16:30:00.000Z" };
    expect(describe(sleep, "Europe/Madrid")).toBe("Sueño 15:00–17:30");
  });
});
