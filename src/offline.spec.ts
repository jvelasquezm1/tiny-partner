import { describe, expect, it } from "vitest";
import { extractByKeywords, KeywordDecider } from "./offline.js";

describe("KeywordDecider", () => {
  const decider = new KeywordDecider();
  const decide = async (text: string) => (await decider.decide(text)).decision;

  it("sends symptoms to the safety branch", async () => {
    expect(await decide("tiene fiebre y 2 semanas")).toMatchObject({ type: "urgent" });
  });

  it("routes logs, data questions, guidance and anything else", async () => {
    expect(await decide("tomó 120 ml")).toMatchObject({ intent: "log_event" });
    expect(await decide("¿cuándo comió?")).toMatchObject({ intent: "ask_about_data" });
    expect(await decide("¿es normal que llore tanto?")).toMatchObject({ intent: "ask_guidance" });
    expect(await decide("hola")).toMatchObject({ intent: "other" });
  });
});

describe("extractByKeywords", () => {
  const now = new Date("2026-11-10T14:00:00.000Z");

  it("reads the kind and the bottle volume", () => {
    expect(extractByKeywords("tomó 120 ml", now)).toMatchObject({ kind: "feed", amountMl: 120, startedAt: now.toISOString() });
    expect(extractByKeywords("pañal con caca", now)).toMatchObject({ kind: "diaper", diaper: "dirty", amountMl: null });
    expect(extractByKeywords("se durmió", now)).toMatchObject({ kind: "sleep" });
  });
});
