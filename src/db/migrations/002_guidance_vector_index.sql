CREATE INDEX IF NOT EXISTS guidance_chunks_embedding_idx
  ON guidance_chunks USING hnsw (embedding vector_cosine_ops);

-- Re-ingesting a source replaces its chunks.
CREATE INDEX IF NOT EXISTS guidance_chunks_source_url_idx ON guidance_chunks (source_url);
