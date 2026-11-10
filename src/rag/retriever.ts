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
    /** Null when no TypeSafe key is configured: triage is skipped. */
    private readonly jev: TypeSafeClient | null,
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
    // Without triage every candidate goes through: cutting to the top 4 dropped the chunk that answers
    // "¿qué debería hacer mi bebé a los 2 meses?" (5th), and Claude rightly found no source in the rest.
    if (!this.jev) return candidates;

    const questions: Record<string, NoulQuestion> = {};
    const passages: Record<string, string> = {};
    candidates.forEach((chunk, i) => {
      passages[`p${i}`] = chunk.content;
      questions[`p${i}`] = noul(`Does passage p${i} contain information that helps answer the parent's question?`);
    });
    let answers;
    try {
      ({ answers } = await this.jev.systemOne({ state: { question, passages }, questions }));
    } catch (error) {
      // Without triage, pass every candidate through, as with no key: the answer still has to cite
      // them, and an uncited answer is replaced by the no-source reply.
      console.warn("jev unavailable, skipping triage", error);
      return candidates;
    }

    return candidates
      .map((chunk, i) => ({ chunk, relevance: answers[`p${i}`]?.noul ?? 0 }))
      .filter(({ relevance }) => relevance >= RELEVANCE_THRESHOLD)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, MAX_PASSAGES)
      .map(({ chunk }) => chunk);
  }
}
