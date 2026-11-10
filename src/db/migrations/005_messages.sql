-- One row per message, for the admin page's usage stats: what the bot did with it, never its text.
CREATE TABLE IF NOT EXISTS messages (
  id          bigserial PRIMARY KEY,
  chat_id     bigint      NOT NULL,
  outcome     text        NOT NULL,
  decider     text        NOT NULL,
  duration_ms integer     NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages (created_at);
