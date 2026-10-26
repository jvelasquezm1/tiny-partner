import type { VoyageAIClient } from "voyageai";

export const EMBEDDING_MODEL = "voyage-4";
/** Must match the vector(...) dimension in migrations/001_init.sql. */
export const EMBEDDING_DIMENSION = 1024;
const MAX_BATCH = 128;

export class Embedder {
  constructor(private readonly client: VoyageAIClient) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      vectors.push(...(await this.embed(texts.slice(i, i + MAX_BATCH), "document")));
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([text], "query");
    return vector!;
  }

  private async embed(input: string[], inputType: "query" | "document"): Promise<number[][]> {
    const response = await this.client.embed({
      input,
      model: EMBEDDING_MODEL,
      inputType,
      outputDimension: EMBEDDING_DIMENSION,
    });
    return (response.data ?? [])
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((item) => item.embedding ?? []);
  }
}
