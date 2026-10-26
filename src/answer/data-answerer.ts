import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { choice, type TypeSafeClient } from "@typesafe-ai/sdk";
import { z } from "zod";
import type { EventsRepository } from "../db/events-repository.js";
import { EventKindSchema } from "../extract/event-schema.js";
import {
  answerLast,
  answerToday,
  COMMON_QUESTION_DESCRIPTIONS,
  isToday,
  KIND_OF,
  startOfLocalDay,
  type CommonQuestion,
} from "./common-questions.js";

// Below this, a template could answer the wrong question: let Claude handle it.
export const COMMON_QUESTION_CONFIDENCE = 0.8;

const SYSTEM = `You answer a parent's questions about their baby's logged feeds, sleep and diapers.
Use the tools to read the log; never invent events. Answer in the parent's language, in one or two short sentences.
You summarize data only: do not give medical advice.`;

export class DataAnswerer {
  constructor(
    private readonly client: Anthropic,
    private readonly jev: TypeSafeClient,
    private readonly events: EventsRepository,
  ) {}

  /** Common questions cost one Jev call and one SQL query; only the rest reach Claude. */
  async answer(chatId: number, question: string, now: Date, timeZone: string): Promise<string> {
    const { answers } = await this.jev.systemOne({
      state: { question },
      questions: { kind: choice("Which question about the baby's log is this?", COMMON_QUESTION_DESCRIPTIONS) },
    });
    const { choice: kind, confidence } = answers.kind;
    if (kind !== "other" && confidence >= COMMON_QUESTION_CONFIDENCE) {
      return this.answerCommon(chatId, kind, now, timeZone);
    }
    return this.answerWithClaude(chatId, question, now, timeZone);
  }

  private async answerCommon(chatId: number, question: CommonQuestion, now: Date, timeZone: string): Promise<string> {
    const kind = KIND_OF[question];
    if (!isToday(question)) return answerLast(kind, await this.events.last(chatId, kind), now, timeZone);
    const events = await this.events.between(chatId, startOfLocalDay(now, timeZone).toISOString(), now.toISOString(), kind);
    return answerToday(kind, events, now);
  }

  private async answerWithClaude(chatId: number, question: string, now: Date, timeZone: string): Promise<string> {
    const lastEvent = betaZodTool({
      name: "last_event",
      description: "The most recent logged event of a kind.",
      inputSchema: z.object({ kind: EventKindSchema }),
      run: async ({ kind }) => JSON.stringify(await this.events.last(chatId, kind)),
    });
    const eventsBetween = betaZodTool({
      name: "events_between",
      description: "Logged events in a time range [from, to), optionally of one kind. Timestamps are ISO 8601.",
      inputSchema: z.object({ from: z.string(), to: z.string(), kind: EventKindSchema.optional() }),
      run: async ({ from, to, kind }) => JSON.stringify(await this.events.between(chatId, from, to, kind)),
    });

    const message = await this.client.beta.messages.toolRunner({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      tools: [lastEvent, eventsBetween],
      messages: [{ role: "user", content: `Current time: ${now.toISOString()} (${timeZone})\nQuestion: ${question}` }],
    });

    return message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
  }
}
