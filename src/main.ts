import Anthropic from "@anthropic-ai/sdk";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { Bot } from "grammy";
import pg from "pg";
import { DataAnswerer } from "./answer/data-answerer.js";
import { registerHandlers } from "./bot.js";
import { EventsRepository } from "./db/events-repository.js";
import { ClaudeDecider } from "./decide/claude-decider.js";
import { FallbackDecider } from "./decide/fallback-decider.js";
import { MessageDecider } from "./decide/message-decider.js";
import { loadEnv } from "./env.js";
import { EventExtractor } from "./extract/extract-event.js";
import { offlineDeps } from "./offline.js";
import { Embedder } from "./rag/embedder.js";
import { GuidanceAnswerer } from "./rag/guidance-answerer.js";
import { GuidanceRepository } from "./rag/guidance-repository.js";
import { Retriever } from "./rag/retriever.js";

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const events = new EventsRepository(pool);

function modelDeps(anthropicKey: string) {
  const anthropic = new Anthropic({ apiKey: anthropicKey });
  // Fail fast so the fallbacks kick in within seconds: worst case ~2 attempts × 3 s instead of 3 × 10 s.
  // No key, no Jev: every step takes the same path it takes when Jev is down.
  const jev = env.TYPESAFE_API_KEY
    ? new TypeSafeClient({ apiKey: env.TYPESAFE_API_KEY, timeout: 3_000, retry: { maxRetries: 1 } })
    : null;
  if (!jev) console.log("TYPESAFE_API_KEY not set: running on Claude alone");
  return {
    decider: jev
      ? new FallbackDecider(new MessageDecider(jev), new ClaudeDecider(anthropic))
      : new ClaudeDecider(anthropic),
    extractor: new EventExtractor(anthropic),
    dataAnswerer: new DataAnswerer(anthropic, jev, events),
    guidanceAnswerer: new GuidanceAnswerer(anthropic, new Retriever(new Embedder(), new GuidanceRepository(pool), jev)),
  };
}

if (env.OFFLINE_MODE) console.log("OFFLINE_MODE: keyword rules instead of model calls, replies are not real");
const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
registerHandlers(bot, {
  ...(env.OFFLINE_MODE || !env.ANTHROPIC_API_KEY ? offlineDeps(events) : modelDeps(env.ANTHROPIC_API_KEY)),
  events,
  allowedUserIds: env.ALLOWED_TELEGRAM_USER_IDS,
  timeZone: env.TZ,
});
bot.catch((err) => console.error("handler failed", err.error));

process.once("SIGTERM", () => bot.stop());
process.once("SIGINT", () => bot.stop());
await bot.start({ onStart: (me) => console.log(`@${me.username} running`) });
await pool.end();
