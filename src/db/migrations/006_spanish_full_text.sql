-- Full text in Spanish: stems ("malcrío" and "malcriar" both become "malcri") and drops stopwords,
-- so a parent's question finds the chunk by its words. The guides are in Spanish.
DROP INDEX IF EXISTS guidance_chunks_tsv_idx;
ALTER TABLE guidance_chunks DROP COLUMN tsv;
ALTER TABLE guidance_chunks ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('spanish', content)) STORED;
CREATE INDEX guidance_chunks_tsv_idx ON guidance_chunks USING gin (tsv);
