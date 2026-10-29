/**
 * RAG eval over your ingested guidance. Copy rag.example.jsonl to rag.jsonl and write one line per
 * question with the url of the source that answers it (questions no source answers: expectedSourceUrl null).
 * Add expectedText, a phrase the answering chunk contains, to score the chunk instead of the whole source:
 * with few sources, "some chunk of the right page" is too easy to hit.
 *
 *   recall@8 (search)  expected chunk among the hybrid-search candidates
 *   recall@4 (search)  expected chunk among the top 4, what reaches Claude when triage is skipped
 *   recall (triage)    expected chunk still there after Jev's relevance check
 *   no-source correct  unanswerable questions get the "no reliable source" reply
 *   faithfulness       Claude as judge: is every claim in the reply supported by the passages it cited?
 *
 * Search metrics are free (local embeddings + Postgres). The rest spend tokens on Jev and Claude and
 * run only when ANTHROPIC_API_KEY and TYPESAFE_API_KEY are both set.
 */
import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import pg from "pg";
import { z } from "zod";
import { Embedder } from "../src/rag/embedder.js";
import { GuidanceAnswerer, NO_SOURCE_REPLY } from "../src/rag/guidance-answerer.js";
import { GuidanceRepository, type GuidanceChunk } from "../src/rag/guidance-repository.js";
import { Retriever } from "../src/rag/retriever.js";

interface Case {
  question: string;
  expectedSourceUrl: string | null;
  expectedText?: string;
}

const Verdict = z.object({
  faithful: z.boolean(),
  unsupportedClaims: z.array(z.string()),
});

const env = z
  .object({ DATABASE_URL: z.url(), ANTHROPIC_API_KEY: z.string().optional(), TYPESAFE_API_KEY: z.string().optional() })
  .parse(process.env);
const withModels = Boolean(env.ANTHROPIC_API_KEY && env.TYPESAFE_API_KEY);
if (!withModels) console.log("ANTHROPIC_API_KEY or TYPESAFE_API_KEY not set: search metrics only\n");
const cases: Case[] = (await readFile(new URL("./rag.jsonl", import.meta.url), "utf8").catch(() => {
  throw new Error("evals/rag.jsonl not found: copy rag.example.jsonl and label questions against your own sources");
}))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const anthropic = withModels ? new Anthropic() : null;
const retriever = new Retriever(new Embedder(), new GuidanceRepository(pool), withModels ? new TypeSafeClient() : null);
const answerer = anthropic ? new GuidanceAnswerer(anthropic, retriever) : null;

const answerable = cases.filter((c) => c.expectedSourceUrl);
const unanswerable = cases.filter((c) => !c.expectedSourceUrl);
let searchHits = 0;
let topHits = 0;
let triageHits = 0;
let noSourceCorrect = 0;
let judged = 0;
let faithful = 0;

try {
  for (const testCase of answerable) {
    const candidates = await retriever.candidates(testCase.question);
    const has = (chunks: GuidanceChunk[]) => chunks.some((chunk) => answers(testCase, chunk));
    if (has(candidates)) searchHits++;
    if (has(candidates.slice(0, 4))) topHits++;
    else console.log(`✗ not in top 4: "${testCase.question}"`);
    if (!answerer || !anthropic) continue;

    if (has(await retriever.triage(testCase.question, candidates))) triageHits++;
    const { text, passages } = await answerer.respond(testCase.question);
    if (text === NO_SOURCE_REPLY) {
      console.log(`✗ no answer: "${testCase.question}"`);
      continue;
    }
    judged++;
    const verdict = await judge(anthropic, testCase.question, text, passages);
    if (verdict.faithful) faithful++;
    else console.log(`✗ unfaithful: "${testCase.question}"\n    ${verdict.unsupportedClaims.join("\n    ")}`);
  }

  for (const testCase of unanswerable) {
    if (!answerer) break;
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
recall@4 (search)   ${ratio(topHits, answerable.length)}
recall (triage)     ${withModels ? ratio(triageHits, answerable.length) : "skipped"}
no-source correct   ${withModels ? ratio(noSourceCorrect, unanswerable.length) : "skipped"}
faithfulness        ${withModels ? ratio(faithful, judged) : "skipped"}`);

function answers(testCase: Case, chunk: GuidanceChunk): boolean {
  if (chunk.sourceUrl !== testCase.expectedSourceUrl) return false;
  return !testCase.expectedText || normalize(chunk.content).includes(normalize(testCase.expectedText));
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

async function judge(client: Anthropic, question: string, reply: string, passages: GuidanceChunk[]): Promise<z.infer<typeof Verdict>> {
  const response = await client.messages.parse({
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
