import type Anthropic from "@anthropic-ai/sdk";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { EventsRepository } from "../db/events-repository.js";
import { DataAnswerer } from "./data-answerer.js";

describe("DataAnswerer", () => {
  it("answers with Claude when Jev is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const toolRunner = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "Hace 2 horas." }] });
    const claude = { beta: { messages: { toolRunner } } } as unknown as Anthropic;
    const jev = { systemOne: vi.fn().mockRejectedValue(new Error("jev down")) } as unknown as TypeSafeClient;

    const answer = await new DataAnswerer(claude, jev, {} as EventsRepository).answer(7, "¿cuándo comió?", new Date(), "Europe/Madrid");

    expect(answer).toBe("Hace 2 horas.");
    expect(toolRunner).toHaveBeenCalledOnce();
  });
});
