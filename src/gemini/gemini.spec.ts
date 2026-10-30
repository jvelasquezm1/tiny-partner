import type { GoogleGenAI } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import type { EventsRepository } from "../db/events-repository.js";
import { NO_SOURCE_REPLY, renderWithCitations } from "../rag/guidance-answerer.js";
import type { GuidanceChunk } from "../rag/guidance-repository.js";
import { GeminiDataAgent, GeminiDecider, GeminiWriter } from "./gemini.js";

const clientReturning = (...responses: object[]) => {
  const generateContent = vi.fn();
  for (const response of responses) generateContent.mockResolvedValueOnce(response);
  return { client: { models: { generateContent } } as unknown as GoogleGenAI, generateContent };
};

const passage = (sourceUrl: string): GuidanceChunk =>
  ({ sourceUrl, sourceTitle: `Title ${sourceUrl}`, content: "..." }) as GuidanceChunk;

describe("GeminiDecider", () => {
  it("turns the structured output into a decision", async () => {
    const { client } = clientReturning({ text: JSON.stringify({ urgent: false, intent: "log_event" }) });

    const { decision } = await new GeminiDecider(client).decide("tomó 120 ml");

    expect(decision).toEqual({ type: "route", intent: "log_event", confidence: 1 });
  });

  it("fails when the output does not match the schema", async () => {
    const { client } = clientReturning({ text: JSON.stringify({ intent: "dance" }) });

    await expect(new GeminiDecider(client).decide("hola")).rejects.toThrow(/no decision/);
  });
});

describe("GeminiWriter", () => {
  it("maps the 1-based passage numbers onto the passages", async () => {
    const sentences = [
      { text: "Boca arriba.", passages: [1] },
      { text: "Sin mantas.", passages: [2] },
    ];
    const { client } = clientReturning({ text: JSON.stringify({ sentences }) });
    const passages = [passage("https://a"), passage("https://b")];

    const blocks = await new GeminiWriter(client).write("¿cómo duerme?", passages);

    expect(renderWithCitations(blocks!, passages)).toMatch(/^Boca arriba\.\[1\] Sin mantas\.\[2\]/);
  });

  it("stays silent when no sentence cites a passage", async () => {
    const { client } = clientReturning({ text: JSON.stringify({ sentences: [{ text: "Seguro que sí.", passages: [] }] }) });
    const passages = [passage("https://a")];

    const blocks = await new GeminiWriter(client).write("¿es normal?", passages);

    expect(renderWithCitations(blocks!, passages)).toBe(NO_SOURCE_REPLY);
  });
});

describe("GeminiDataAgent", () => {
  it("runs the requested tool and answers with its result", async () => {
    const last = vi.fn().mockResolvedValue({ kind: "feed", startedAt: "2026-10-30T08:00:00Z" });
    const modelTurn = { role: "model", parts: [{ functionCall: { id: "c1", name: "last_event", args: { kind: "feed" } } }] };
    const { client, generateContent } = clientReturning(
      { functionCalls: modelTurn.parts.map((p) => p.functionCall), candidates: [{ content: modelTurn }] },
      { text: "Comió a las 9:00." },
    );

    const answer = await new GeminiDataAgent(client, { last } as unknown as EventsRepository).answer(7, "¿cuándo comió?", new Date(), "Europe/Madrid");

    expect(answer).toBe("Comió a las 9:00.");
    expect(last).toHaveBeenCalledWith(7, "feed");
    expect(generateContent.mock.calls[1]![0].contents).toHaveLength(3);
  });
});
