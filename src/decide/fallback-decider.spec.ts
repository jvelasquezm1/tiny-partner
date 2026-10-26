import { describe, expect, it, vi } from "vitest";
import type { Decided, Decider } from "./decider.js";
import { DecidersUnavailableError, FallbackDecider } from "./fallback-decider.js";

const decided: Decided = { decision: { type: "route", intent: "log_event", confidence: 1 }, usage: { inputTokens: 0, outputTokens: 0 } };
const working = (name: string): Decider => ({ name, decide: vi.fn().mockResolvedValue(decided) });
const failing = (name: string): Decider => ({ name, decide: vi.fn().mockRejectedValue(new Error(`${name} down`)) });

describe("FallbackDecider", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});

  it("uses the primary decider when it works", async () => {
    const fallback = working("claude");
    await expect(new FallbackDecider(working("jev"), fallback).decide("hola")).resolves.toEqual(decided);
    expect(fallback.decide).not.toHaveBeenCalled();
  });

  it("falls back when the primary decider fails", async () => {
    await expect(new FallbackDecider(failing("jev"), working("claude")).decide("hola")).resolves.toEqual(decided);
  });

  it("throws a typed error when both fail", async () => {
    await expect(new FallbackDecider(failing("jev"), failing("claude")).decide("hola")).rejects.toBeInstanceOf(
      DecidersUnavailableError,
    );
  });
});
