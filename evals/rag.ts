/**
 * RAG eval over your ingested guidance. Copy rag.example.jsonl to rag.jsonl and write one line per
 * question with the url of the source that answers it (questions no source answers: expectedSourceUrl null).
 *
 *   recall@8 (search)  expected source among the hybrid-search candidates
 *   recall (triage)    expected source still there after Jev's relevance check
 *   no-source correct  unanswerable questions get the "no reliable source" reply
 *   faithfulness       Claude as judge: is every claim in the reply supported by the passages it cited?
 *
 * Spends tokens on Voyage, Jev and Claude.
 */
import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import pg from "pg";
import { VoyageAIClient } from "voyageai";
import { z } from "zod";
import { Embedder } from "../src/rag/embedder.js";
import { GuidanceAnswerer, NO_SOURCE_REPLY } from "../src/rag/guidance-answerer.js";
import { GuidanceRepository, type GuidanceChunk } from "../src/rag/guidance-repository.js";
import { Retriever } from "../src/rag/retriever.js";

interface Case {
  question: string;
  expectedSourceUrl: string | null;
}

const Verdict = z.object({
  faithful: z.boolean(),
  unsupportedClaims: z.array(z.string()),
});

const env = z.object({ DATABASE_URL: z.url(), VOYAGE_API_KEY: z.string().min(1) }).parse(process.env);
const cases: Case[] = (await readFile(new URL("./rag.jsonl", import.meta.url), "utf8").catch(() => {
  throw new Error("evals/rag.jsonl not found: copy rag.example.jsonl and label questions against your own sources");
}))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const anthropic = new Anthropic();
const retriever = new Retriever(
  new Embedder(new VoyageAIClient({ apiKey: env.VOYAGE_API_KEY })),
  new GuidanceRepository(pool),
  new TypeSafeClient(),
);
const answerer = new GuidanceAnswerer(anthropic, retriever);

const answerable = cases.filter((c) => c.expectedSourceUrl);
const unanswerable = cases.filter((c) => !c.expectedSourceUrl);
let searchHits = 0;
let triageHits = 0;
let noSourceCorrect = 0;
let judged = 0;
let faithful = 0;

try {
  for (const testCase of answerable) {
    const candidates = await retriever.candidates(testCase.question);
    const kept = await retriever.triage(testCase.question, candidates);
    const has = (chunks: GuidanceChunk[]) => chunks.some((c) => c.sourceUrl === testCase.expectedSourceUrl);
    if (has(candidates)) searchHits++;
    if (has(kept)) triageHits++;

    const { text, passages } = await answerer.respond(testCase.question);
    if (text === NO_SOURCE_REPLY) {
      console.log(`✗ no answer: "${testCase.question}"`);
      continue;
    }
    judged++;
    const verdict = await judge(testCase.question, text, passages);
    if (verdict.faithful) faithful++;
    else console.log(`✗ unfaithful: "${testCase.question}"\n    ${verdict.unsupportedClaims.join("\n    ")}`);
  }

  for (const testCase of unanswerable) {
    const { text } = await answerer.respond(testCase.question);
    if (text === NO_SOURCE_REPLY) noSourceCorrect++;
    else console.log(`✗ answered without a source: "${testCase.question}"`);
  }
} finally {
  await pool.end();
}

const ratio = (hits: number, total: number) => (total === 0 ? "n/a" : `${((hits / total) * 100).toFixed(0)}% (${hits}/${total})`);
console.log(`
recall@8 (search)   ${ratio(searchHits, answerable.length)}
recall (triage)     ${ratio(triageHits, answerable.length)}
no-source correct   ${ratio(noSourceCorrect, unanswerable.length)}
faithfulness        ${ratio(faithful, judged)}`);

async function judge(question: string, reply: string, passages: GuidanceChunk[]): Promise<z.infer<typeof Verdict>> {
  const response = await anthropic.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 2048,
    output_config: { effort: "low", format: zodOutputFormat(Verdict) },
    system:
      "You check whether an answer is grounded. List every factual claim in the answer that the passages do not state or directly imply. faithful is true only when that list is empty. Ignore the source list and disclaimer.",
    messages: [
      {
        role: "user",
        content: `Question: ${question}\n\nPassages:\n${passages.map((p, i) => `[${i}] ${p.content}`).join("\n\n")}\n\nAnswer:\n${reply}`,
      },
    ],
  });
  if (!response.parsed_output) throw new Error(`judge returned no verdict (stop_reason: ${response.stop_reason})`);
  return response.parsed_output;
}
