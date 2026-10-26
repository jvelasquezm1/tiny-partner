import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { Embedder } from "./embedder.js";
import type { GuidanceChunk, GuidanceRepository } from "./guidance-repository.js";
import { Retriever } from "./retriever.js";

const chunk = (id: number): GuidanceChunk => ({ id, sourceTitle: "t", sourceUrl: `https://example.org/${id}`, content: `c${id}` });

describe("Retriever.triage", () => {
  it("passes the top search results through when Jev is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const jev = { systemOne: vi.fn().mockRejectedValue(new Error("jev down")) } as unknown as TypeSafeClient;
    const retriever = new Retriever({} as Embedder, {} as GuidanceRepository, jev);

    const kept = await retriever.triage("¿cada cuánto come?", [1, 2, 3, 4, 5, 6].map(chunk));

    expect(kept.map((c) => c.id)).toEqual([1, 2, 3, 4]);
  });

  it("passes the top search results through when no TypeSafe key is configured", async () => {
    const retriever = new Retriever({} as Embedder, {} as GuidanceRepository, null);

    const kept = await retriever.triage("¿cada cuánto come?", [1, 2, 3, 4, 5, 6].map(chunk));

    expect(kept.map((c) => c.id)).toEqual([1, 2, 3, 4]);
  });
});
