/**
 * Extraction eval: real messages → expected event, scored field by field.
 * Times match within ±5 minutes. Exits non-zero below the threshold so CI fails.
 * Spends real API tokens: run it on PRs that touch src/extract, not on every commit.
 */
import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { EventExtractor } from "../src/extract/extract-event.js";
import type { BabyEvent } from "../src/extract/event-schema.js";

const THRESHOLD = 0.9;
const TIME_TOLERANCE_MS = 5 * 60 * 1000;
const FIELDS = ["kind", "startedAt", "endedAt", "amountMl", "side", "diaper"] as const;

interface Case {
  text: string;
  now: string;
  expected: Omit<BabyEvent, "note">;
}

const cases: Case[] = (await readFile(new URL("./extraction.jsonl", import.meta.url), "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const extractor = new EventExtractor(new Anthropic());
let correct = 0;

for (const testCase of cases) {
  const actual = await extractor.extract(testCase.text, new Date(testCase.now), "Europe/Madrid");
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
