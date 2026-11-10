import type Anthropic from "@anthropic-ai/sdk";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { EventsRepository } from "../db/events-repository.js";
import { ClaudeDataAgent, DataAnswerer, logTools } from "./data-answerer.js";

const agent = { answer: vi.fn().mockResolvedValue("Hace 2 horas.") };

describe("DataAnswerer", () => {
  it("answers with the model when Jev is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const jev = { systemOne: vi.fn().mockRejectedValue(new Error("jev down")) } as unknown as TypeSafeClient;

    const answer = await new DataAnswerer(agent, jev, {} as EventsRepository).answer(7, "¿cuándo comió?", new Date(), "Europe/Madrid");

    expect(answer).toBe("Hace 2 horas.");
    expect(agent.answer).toHaveBeenCalledOnce();
  });

  it("answers with the model when no TypeSafe key is configured", async () => {
    const answer = await new DataAnswerer(agent, null, {} as EventsRepository).answer(7, "¿cuándo comió?", new Date(), "Europe/Madrid");

    expect(answer).toBe("Hace 2 horas.");
  });
});

describe("ClaudeDataAgent", () => {
  it("returns the text of Claude's final message", async () => {
    const toolRunner = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "Hace 2 horas." }] });
    const claude = { beta: { messages: { toolRunner } } } as unknown as Anthropic;

    const answer = await new ClaudeDataAgent(claude, {} as EventsRepository).answer(7, "¿cuándo comió?", new Date(), "Europe/Madrid");

    expect(answer).toBe("Hace 2 horas.");
    expect(toolRunner).toHaveBeenCalledOnce();
  });
});

describe("logTools", () => {
  it("returns event times in the parent's clock, never UTC", async () => {
    const stored = { id: 1, kind: "feed", startedAt: "2026-11-10T07:15:00.000Z", endedAt: null, amountMl: null, side: "left", diaper: null, note: null };
    const events = { last: vi.fn().mockResolvedValue(stored), between: vi.fn().mockResolvedValue([stored]) } as unknown as EventsRepository;
    const { lastEvent, eventsBetween } = logTools(events, 7, "Europe/Madrid");
    expect(JSON.parse(await lastEvent.run({ kind: "feed" })).startedAt).toBe("2026-11-10T08:15:00+01:00");
    const [event] = JSON.parse(await eventsBetween.run({ from: "2026-11-10T00:00:00+01:00", to: "2026-11-10T09:00:00+01:00" }));
    expect(event.startedAt).toBe("2026-11-10T08:15:00+01:00");
  });
});
