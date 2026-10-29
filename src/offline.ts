import { answerLast, answerToday, startOfLocalDay } from "./answer/common-questions.js";
import type { BotDeps } from "./bot.js";
import type { EventsRepository } from "./db/events-repository.js";
import type { Decided, Decider, Decision } from "./decide/decider.js";
import type { BabyEvent, EventKind } from "./extract/event-schema.js";

/**
 * OFFLINE_MODE: keyword rules stand in for every model call, so the whole bot (Telegram, allowlist,
 * safety branch, Postgres, templates) can be tried end to end without an API key or any spend.
 * Model-generated replies are marked 🧪 so a test run is never mistaken for the real thing.
 */
export function offlineDeps(events: EventsRepository): Pick<BotDeps, "decider" | "extractor" | "dataAnswerer" | "guidanceAnswerer"> {
  return {
    decider: new KeywordDecider(),
    extractor: { extract: async (text, now) => extractByKeywords(text, now) },
    dataAnswerer: {
      answer: async (chatId, question, now, timeZone) => {
        const kind = kindOf(question);
        if (/hoy|cu[aá]nt/i.test(question)) {
          const today = await events.between(chatId, startOfLocalDay(now, timeZone).toISOString(), now.toISOString(), kind);
          return answerToday(kind, today, now);
        }
        return answerLast(kind, await events.last(chatId, kind), now, timeZone);
      },
    },
    guidanceAnswerer: { answer: async () => "🧪 Modo offline: aquí respondería Claude con fuentes citadas." },
  };
}

const URGENT = /fiebre|respira|labios azules|convuls|no reacciona|deshidrat/i;
const GUIDANCE = /es normal|deber[ií]a|c[oó]mo (hago|puedo)|consejo/i;
const LOG = /\d|tom[oó]|comi[oó]|biber|pecho|durmi|siesta|despert|pa[ñn]al|caca|pip[ií]/i;

export class KeywordDecider implements Decider {
  readonly name = "keywords";

  async decide(text: string): Promise<Decided> {
    return { decision: this.decision(text), usage: { inputTokens: 0, outputTokens: 0 } };
  }

  private decision(text: string): Decision {
    if (URGENT.test(text)) return { type: "urgent", probability: 1 };
    if (GUIDANCE.test(text)) return { type: "route", intent: "ask_guidance", confidence: 1 };
    if (text.includes("?")) return { type: "route", intent: "ask_about_data", confidence: 1 };
    if (LOG.test(text)) return { type: "route", intent: "log_event", confidence: 1 };
    return { type: "route", intent: "other", confidence: 1 };
  }
}

export function extractByKeywords(text: string, now: Date): BabyEvent {
  const kind = kindOf(text);
  const ml = text.match(/(\d+)\s*ml/i);
  return {
    kind,
    startedAt: now.toISOString(),
    endedAt: null,
    amountMl: kind === "feed" && ml ? Number(ml[1]) : null,
    side: null,
    diaper: kind === "diaper" ? (/caca/i.test(text) ? "dirty" : "wet") : null,
    note: "🧪 offline",
  };
}

function kindOf(text: string): EventKind {
  if (/pa[ñn]al|caca|pip[ií]/i.test(text)) return "diaper";
  if (/durm|sue[ñn]o|siesta|despert/i.test(text)) return "sleep";
  return "feed";
}
