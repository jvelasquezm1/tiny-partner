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
import { Embedder } from "./rag/embedder.js";
import { GuidanceAnswerer } from "./rag/guidance-answerer.js";
import { GuidanceRepository } from "./rag/guidance-repository.js";
import { Retriever } from "./rag/retriever.js";

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
// Fail fast so the fallbacks kick in within seconds: worst case ~2 attempts × 3 s instead of 3 × 10 s.
const jev = new TypeSafeClient({ apiKey: env.TYPESAFE_API_KEY, timeout: 3_000, retry: { maxRetries: 1 } });
const events = new EventsRepository(pool);
const retriever = new Retriever(
  new Embedder(),
  new GuidanceRepository(pool),
  jev,
);

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
registerHandlers(bot, {
  decider: new FallbackDecider(new MessageDecider(jev), new ClaudeDecider(anthropic)),
  extractor: new EventExtractor(anthropic),
  events,
  dataAnswerer: new DataAnswerer(anthropic, jev, events),
  guidanceAnswerer: new GuidanceAnswerer(anthropic, retriever),
  allowedUserIds: env.ALLOWED_TELEGRAM_USER_IDS,
  timeZone: env.TZ,
});
bot.catch((err) => console.error("handler failed", err.error));

process.once("SIGTERM", () => bot.stop());
process.once("SIGINT", () => bot.stop());
await bot.start({ onStart: (me) => console.log(`@${me.username} running`) });
await pool.end();
