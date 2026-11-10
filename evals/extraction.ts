/**
 * Extraction eval: real messages → expected event, scored field by field.
 * It scores what the bot does with the extraction, not the raw model output: the time it saves or
 * offers first, and whether it asks (the model's ambiguousTime or the words). Haiku often returns
 * "a las 9" sent at 07:30 as 09:00 that day, still ahead; the bot then asks with 21:00 first.
 * Times match within ±5 minutes. Exits non-zero below the threshold so CI fails.
 * Spends real API tokens: run it on PRs that touch src/extract, not on every commit.
 */
import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { EventExtractor } from "../src/extract/extract-event.js";
import { statesUnclearClockTime, timeReadings } from "../src/extract/event-time.js";
import type { ExtractedEvent } from "../src/extract/event-schema.js";

const THRESHOLD = 0.9;
const TIME_TOLERANCE_MS = 5 * 60 * 1000;
// ambiguousTime decides whether the bot asks the parent which reading of a clock time they meant.
const FIELDS = ["kind", "startedAt", "endedAt", "amountMl", "side", "diaper", "ambiguousTime"] as const;

interface Case {
  text: string;
  now: string;
  expected: Omit<ExtractedEvent, "note">;
}

const cases: Case[] = (await readFile(new URL("./extraction.jsonl", import.meta.url), "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const extractor = new EventExtractor(new Anthropic());
let correct = 0;

for (const testCase of cases) {
  const now = new Date(testCase.now);
  const { ambiguousTime, ...event } = await extractor.extract(testCase.text, now, "Europe/Madrid");
  const asks = ambiguousTime || statesUnclearClockTime(testCase.text);
  const actual = { ...(timeReadings(event, asks, now)?.[0] ?? event), ambiguousTime: asks };
  const misses = FIELDS.filter((field) => !fieldMatches(field, testCase.expected[field], actual[field]));
  correct += FIELDS.length - misses.length;
  console.log(`${misses.length ? "✗" : "✓"} ${testCase.text}${misses.length ? `  (wrong: ${misses.join(", ")})` : ""}`);
}

const accuracy = correct / (cases.length * FIELDS.length);
console.log(`\nfield accuracy: ${(accuracy * 100).toFixed(1)}% over ${cases.length} cases`);
if (accuracy < THRESHOLD) process.exit(1);

function fieldMatches(field: (typeof FIELDS)[number], expected: unknown, actual: unknown): boolean {
  if ((field === "startedAt" || field === "endedAt") && typeof expected === "string" && typeof actual === "string") {
    return Math.abs(Date.parse(expected) - Date.parse(actual)) <= TIME_TOLERANCE_MS;
  }
  return expected === actual;
}
