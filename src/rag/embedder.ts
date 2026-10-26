import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Local embeddings: no API key, no per-token cost. Multilingual (Spanish and English questions
 * match English or Spanish sources), MIT licensed, quantized to run on a small CPU.
 * The model downloads once on first use and is cached on disk.
 */
export const EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
/** Must match the vector(...) dimension in the latest guidance_chunks migration. */
export const EMBEDDING_DIMENSION = 384;
const BATCH = 16;

export class Embedder {
  private extractor: Promise<FeatureExtractionPipeline> | null = null;

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    // e5 models are trained with these prefixes; leaving them out degrades retrieval.
    for (let i = 0; i < texts.length; i += BATCH) {
      vectors.push(...(await this.embed(texts.slice(i, i + BATCH).map((text) => `passage: ${text}`))));
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([`query: ${text}`]);
    return vector!;
  }

  private async embed(input: string[]): Promise<number[][]> {
    this.extractor ??= pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" });
    const output = await (await this.extractor)(input, { pooling: "mean", normalize: true });
    return output.tolist() as number[][];
  }
}
