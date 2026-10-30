import type Anthropic from "@anthropic-ai/sdk";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { EventsRepository } from "../db/events-repository.js";
import { ClaudeDataAgent, DataAnswerer } from "./data-answerer.js";

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
