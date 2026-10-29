import type pg from "pg";

export interface GuidanceChunk {
  id: number;
  sourceTitle: string;
  sourceUrl: string;
  content: string;
}

export interface NewChunk {
  content: string;
  embedding: number[];
}

const toVector = (embedding: number[]) => `[${embedding.join(",")}]`;

export class GuidanceRepository {
  constructor(private readonly pool: pg.Pool) {}

  /** Replaces every chunk of a source, so re-running ingest after editing a file is safe. */
  async replaceSource(sourceTitle: string, sourceUrl: string, chunks: NewChunk[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM guidance_chunks WHERE source_url = $1", [sourceUrl]);
      for (const chunk of chunks) {
        await client.query(
          "INSERT INTO guidance_chunks (source_title, source_url, content, embedding) VALUES ($1, $2, $3, $4::vector)",
          [sourceTitle, sourceUrl, chunk.content, toVector(chunk.embedding)],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Deletes every source not in `keepUrls`, so a guide removed from guidance/ stops being cited. */
  async deleteSourcesExcept(keepUrls: string[]): Promise<number> {
    const { rowCount } = await this.pool.query("DELETE FROM guidance_chunks WHERE source_url <> ALL($1::text[])", [keepUrls]);
    return rowCount ?? 0;
  }

  async nearest(embedding: number[], limit: number): Promise<GuidanceChunk[]> {
    return this.select("ORDER BY embedding <=> $1::vector LIMIT $2", [toVector(embedding), limit]);
  }

  async fullText(query: string, limit: number): Promise<GuidanceChunk[]> {
    return this.select(
      `WHERE tsv @@ websearch_to_tsquery('simple', $1)
       ORDER BY ts_rank(tsv, websearch_to_tsquery('simple', $1)) DESC LIMIT $2`,
      [query, limit],
    );
  }

  private async select(clause: string, params: unknown[]): Promise<GuidanceChunk[]> {
    const { rows } = await this.pool.query(
      `SELECT id, source_title, source_url, content FROM guidance_chunks ${clause}`,
      params,
    );
    return rows.map((row) => ({
      id: Number(row.id),
      sourceTitle: row.source_title,
      sourceUrl: row.source_url,
      content: row.content,
    }));
  }
}
