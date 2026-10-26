-- Switch from Voyage (1024 dims) to local multilingual-e5-small (384 dims).
-- Old vectors are not comparable with the new model: clear them and re-run `pnpm ingest`.
DROP INDEX IF EXISTS guidance_chunks_embedding_idx;
TRUNCATE guidance_chunks;
ALTER TABLE guidance_chunks ALTER COLUMN embedding TYPE vector(384);
CREATE INDEX guidance_chunks_embedding_idx ON guidance_chunks USING hnsw (embedding vector_cosine_ops);
