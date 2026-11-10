-- When each chunk was last ingested, shown on the admin page. Re-ingesting a source replaces its rows.
ALTER TABLE guidance_chunks ADD COLUMN IF NOT EXISTS ingested_at timestamptz NOT NULL DEFAULT now();
