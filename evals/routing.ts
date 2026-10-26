/**
 * Router benchmark: Jev vs Claude on the same labeled messages.
 * Reports intent accuracy, urgent recall (a missed urgency is the costly error),
 * urgent precision, latency and tokens. Writes evals/results/routing.md for the README.
 * Spends real API tokens on both providers.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { ClaudeDecider } from "../src/decide/claude-decider.js";
import type { Decider, Intent } from "../src/decide/decider.js";
import { MessageDecider } from "../src/decide/message-decider.js";

// Claude Opus 5.5 list price per million tokens. Check https://www.anthropic.com/pricing before publishing numbers.
const CLAUDE_USD_PER_MTOK = { input: 4, output: 20 };

interface Case {
  text: string;
  urgent: boolean;
  intent: Intent;
}

interface Row {
  decider: string;
  intentAccuracy: number;
  urgentRecall: number;
  urgentPrecision: number;
  p50Ms: number;
  p95Ms: number;
  tokensPerMessage: number;
  usdPer1kMessages: number | null;
}

const cases: Case[] = (await readFile(new URL("./routing.jsonl", import.meta.url), "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const deciders: Decider[] = [new MessageDecider(new TypeSafeClient()), new ClaudeDecider(new Anthropic())];
const rows: Row[] = [];
for (const decider of deciders) rows.push(await run(decider));

const table = [
  "| Router | Intent accuracy | Urgent recall | Urgent precision | p50 | p95 | Tokens / msg | $ / 1k msgs |",
  "|---|---|---|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      `| ${r.decider} | ${pct(r.intentAccuracy)} | ${pct(r.urgentRecall)} | ${pct(r.urgentPrecision)} | ${r.p50Ms} ms | ${r.p95Ms} ms | ${r.tokensPerMessage.toFixed(0)} | ${r.usdPer1kMessages === null ? "n/a" : `$${r.usdPer1kMessages.toFixed(2)}`} |`,
  ),
].join("\n");

console.log(`\n${table}\n\n${cases.length} labeled messages, run ${new Date().toISOString().slice(0, 10)}`);
await mkdir(new URL("./results/", import.meta.url), { recursive: true });
await writeFile(new URL("./results/routing.md", import.meta.url), `${table}\n`);

async function run(decider: Decider): Promise<Row> {
  let intentHits = 0;
  let intentTotal = 0;
  let truePositives = 0;
  let falsePositives = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const latencies: number[] = [];

  for (const testCase of cases) {
    const start = performance.now();
    const { decision, usage } = await decider.decide(testCase.text);
    latencies.push(performance.now() - start);
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;

    const predictedUrgent = decision.type === "urgent";
    if (predictedUrgent && testCase.urgent) truePositives++;
    if (predictedUrgent && !testCase.urgent) falsePositives++;
    // Intent only matters when the message is not urgent: urgent ones never reach routing.
    if (!testCase.urgent) {
      intentTotal++;
      if (decision.type === "route" && decision.intent === testCase.intent) intentHits++;
      else console.log(`  ${decider.name} ✗ "${testCase.text}" → ${decision.type === "route" ? decision.intent : "urgent"} (expected ${testCase.intent})`);
    } else if (!predictedUrgent) {
      console.log(`  ${decider.name} ✗ MISSED URGENT "${testCase.text}"`);
    }
  }

  const urgentTotal = cases.filter((c) => c.urgent).length;
  const sorted = [...latencies].sort((a, b) => a - b);
  const percentile = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!);
  return {
    decider: decider.name,
    intentAccuracy: intentHits / intentTotal,
    urgentRecall: truePositives / urgentTotal,
    urgentPrecision: truePositives + falsePositives === 0 ? 0 : truePositives / (truePositives + falsePositives),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    tokensPerMessage: (inputTokens + outputTokens) / cases.length,
    // Jev's price is not published in its SDK; fill it in from typesafe.ai before comparing cost.
    usdPer1kMessages:
      decider instanceof ClaudeDecider
        ? ((inputTokens * CLAUDE_USD_PER_MTOK.input + outputTokens * CLAUDE_USD_PER_MTOK.output) / 1e6 / cases.length) * 1000
        : null,
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}
