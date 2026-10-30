import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { Bot } from "grammy";
import pg from "pg";
import { ClaudeDataAgent, DataAnswerer, type DataAgent } from "./answer/data-answerer.js";
import { registerHandlers } from "./bot.js";
import { EventsRepository } from "./db/events-repository.js";
import { ClaudeDecider } from "./decide/claude-decider.js";
import type { Decider } from "./decide/decider.js";
import { FallbackDecider } from "./decide/fallback-decider.js";
import { MessageDecider } from "./decide/message-decider.js";
import { loadEnv } from "./env.js";
import { EventExtractor } from "./extract/extract-event.js";
import { GeminiDataAgent, GeminiDecider, GeminiExtractor, GeminiWriter } from "./gemini/gemini.js";
import { offlineDeps } from "./offline.js";
import { Embedder } from "./rag/embedder.js";
import { ClaudeWriter, GuidanceAnswerer, type GroundedWriter } from "./rag/guidance-answerer.js";
import { GuidanceRepository } from "./rag/guidance-repository.js";
import { Retriever } from "./rag/retriever.js";

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const events = new EventsRepository(pool);

interface Models {
  name: string;
  decider: Decider;
  extractor: Pick<EventExtractor, "extract">;
  dataAgent: DataAgent;
  writer: GroundedWriter;
}

function claudeModels(apiKey: string): Models {
  const anthropic = new Anthropic({ apiKey });
  return {
    name: "Claude",
    decider: new ClaudeDecider(anthropic),
    extractor: new EventExtractor(anthropic),
    dataAgent: new ClaudeDataAgent(anthropic, events),
    writer: new ClaudeWriter(anthropic),
  };
}

function geminiModels(apiKey: string): Models {
  const gemini = new GoogleGenAI({ apiKey });
  return {
    name: "Gemini",
    decider: new GeminiDecider(gemini),
    extractor: new GeminiExtractor(gemini),
    dataAgent: new GeminiDataAgent(gemini, events),
    writer: new GeminiWriter(gemini),
  };
}

function modelDeps(models: Models) {
  // Fail fast so the fallbacks kick in within seconds: worst case ~2 attempts × 3 s instead of 3 × 10 s.
  // No key, no Jev: every step takes the same path it takes when Jev is down.
  const jev = env.TYPESAFE_API_KEY
    ? new TypeSafeClient({ apiKey: env.TYPESAFE_API_KEY, timeout: 3_000, retry: { maxRetries: 1 } })
    : null;
  if (!jev) console.log(`TYPESAFE_API_KEY not set: running on ${models.name} alone`);
  return {
    decider: jev ? new FallbackDecider(new MessageDecider(jev), models.decider) : models.decider,
    extractor: models.extractor,
    dataAnswerer: new DataAnswerer(models.dataAgent, jev, events),
    guidanceAnswerer: new GuidanceAnswerer(models.writer, new Retriever(new Embedder(), new GuidanceRepository(pool), jev)),
  };
}

// Claude first; Gemini only when there is no Claude key; keyword rules when there is neither.
function selectDeps() {
  if (env.OFFLINE_MODE) {
    console.log("OFFLINE_MODE: keyword rules instead of model calls, replies are not real");
    return offlineDeps(events);
  }
  if (env.ANTHROPIC_API_KEY) return modelDeps(claudeModels(env.ANTHROPIC_API_KEY));
  console.log("ANTHROPIC_API_KEY not set: using Gemini");
  return modelDeps(geminiModels(env.GEMINI_API_KEY!));
}

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
registerHandlers(bot, {
  ...selectDeps(),
  events,
  allowedUserIds: env.ALLOWED_TELEGRAM_USER_IDS,
  timeZone: env.TZ,
});
bot.catch((err) => console.error("handler failed", err.error));

process.once("SIGTERM", () => bot.stop());
process.once("SIGINT", () => bot.stop());
await bot.start({ onStart: (me) => console.log(`@${me.username} running`) });
await pool.end();
