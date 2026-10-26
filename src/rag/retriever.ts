import { noul, type NoulQuestion, type TypeSafeClient } from "@typesafe-ai/sdk";
import type { Embedder } from "./embedder.js";
import { reciprocalRankFusion } from "./fuse.js";
import type { GuidanceChunk, GuidanceRepository } from "./guidance-repository.js";

const CANDIDATES_PER_SEARCH = 20;
const CANDIDATES_TO_TRIAGE = 8;
const MAX_PASSAGES = 4;
export const RELEVANCE_THRESHOLD = 0.5;

/**
 * Hybrid retrieval (vector + full text, fused by rank), then Jev triage:
 * one typed yes/no per candidate, "does this passage help answer the question?".
 * Only passages above the threshold reach the generative model.
 */
export class Retriever {
  constructor(
    private readonly embedder: Embedder,
    private readonly guidance: GuidanceRepository,
    private readonly jev: TypeSafeClient,
  ) {}

  async retrieve(question: string): Promise<GuidanceChunk[]> {
    return this.triage(question, await this.candidates(question));
  }

  /** Hybrid search only, before triage. Public so the eval can measure each stage. */
  async candidates(question: string): Promise<GuidanceChunk[]> {
    const [byMeaning, byWords] = [
      await this.guidance.nearest(await this.embedder.embedQuery(question), CANDIDATES_PER_SEARCH),
      await this.guidance.fullText(question, CANDIDATES_PER_SEARCH),
    ];
    return reciprocalRankFusion([byMeaning, byWords], (chunk) => chunk.id).slice(0, CANDIDATES_TO_TRIAGE);
  }

  async triage(question: string, candidates: GuidanceChunk[]): Promise<GuidanceChunk[]> {
    if (candidates.length === 0) return [];

    const questions: Record<string, NoulQuestion> = {};
    const passages: Record<string, string> = {};
    candidates.forEach((chunk, i) => {
      passages[`p${i}`] = chunk.content;
      questions[`p${i}`] = noul(`Does passage p${i} contain information that helps answer the parent's question?`);
    });
    const { answers } = await this.jev.systemOne({ state: { question, passages }, questions });

    return candidates
      .map((chunk, i) => ({ chunk, relevance: answers[`p${i}`]?.noul ?? 0 }))
      .filter(({ relevance }) => relevance >= RELEVANCE_THRESHOLD)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, MAX_PASSAGES)
      .map(({ chunk }) => chunk);
  }
}
