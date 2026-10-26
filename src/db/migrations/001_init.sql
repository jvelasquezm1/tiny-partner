CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE event_kind AS ENUM ('feed', 'sleep', 'diaper');

-- One household per Telegram chat: both parents share a group chat with the bot.
CREATE TABLE IF NOT EXISTS events (
  id          bigserial PRIMARY KEY,
  chat_id     bigint      NOT NULL,
  kind        event_kind  NOT NULL,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  amount_ml   integer,
  side        text CHECK (side IN ('left', 'right', 'both')),
  diaper      text CHECK (diaper IN ('wet', 'dirty', 'both')),
  note        text,
  source_text text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_chat_kind_started_idx ON events (chat_id, kind, started_at DESC);

-- Weekend 2 (RAG): chunks of public pediatric guidance with citations.
-- Set the vector dimension to the one your embedding model returns.
CREATE TABLE IF NOT EXISTS guidance_chunks (
  id           bigserial PRIMARY KEY,
  source_title text   NOT NULL,
  source_url   text   NOT NULL,
  content      text   NOT NULL,
  embedding    vector(1024),
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED
);
CREATE INDEX IF NOT EXISTS guidance_chunks_tsv_idx ON guidance_chunks USING gin (tsv);
