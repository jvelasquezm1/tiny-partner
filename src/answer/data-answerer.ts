import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { choice, type TypeSafeClient } from "@typesafe-ai/sdk";
import { z } from "zod";
import type { EventsRepository, StoredEvent } from "../db/events-repository.js";
import { EventKindSchema } from "../extract/event-schema.js";
import { describeLocalTime, toLocalIso } from "../local-time.js";
import { CLAUDE_EFFORT, CLAUDE_MODEL } from "../models.js";
import {
  answerLast,
  answerToday,
  COMMON_QUESTION_DESCRIPTIONS,
  isToday,
  KIND_OF,
  startOfLocalDay,
  type CommonQuestion,
} from "./common-questions.js";

// Below this, a template could answer the wrong question: let the model handle it.
export const COMMON_QUESTION_CONFIDENCE = 0.8;

export const DATA_SYSTEM = `You answer a parent's questions about their baby's logged feeds, sleep and diapers.
Use the tools to read the log; never invent events. Answer in the parent's language, in one or two short sentences.
"Today" runs from 00:00 local time to now and "yesterday" is the whole local day before: work out those bounds from the current local time you are given, with its UTC offset, and never ask the parent for them.
If nothing is logged for the question, say so in one sentence.
You summarize data only: do not give medical advice.`;

/** The user turn for every data agent. */
export function dataQuestionMessage(question: string, now: Date, timeZone: string): string {
  return `Current local time: ${describeLocalTime(now, timeZone)}\nQuestion: ${question}`;
}

/** Answers what no template covers, reading the log through tools. One per model provider. */
export interface DataAgent {
  answer(chatId: number, question: string, now: Date, timeZone: string): Promise<string>;
}

export interface LogTool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  inputSchema: S;
  run(input: z.infer<S>): Promise<string>;
}

const defineTool = <S extends z.ZodObject>(tool: LogTool<S>) => tool;

/**
 * The log as tools, shared by every provider so they all see the same data the same way. Times come
 * back in the parent's clock, like the current time in the question.
 */
export function logTools(events: EventsRepository, chatId: number, timeZone: string) {
  const local = (event: StoredEvent | null) =>
    event && {
      ...event,
      startedAt: toLocalIso(new Date(event.startedAt), timeZone),
      endedAt: event.endedAt && toLocalIso(new Date(event.endedAt), timeZone),
    };
  return {
    lastEvent: defineTool({
      name: "last_event",
      description: "The most recent logged event of a kind.",
      inputSchema: z.object({ kind: EventKindSchema }),
      run: async ({ kind }) => JSON.stringify(local(await events.last(chatId, kind))),
    }),
    eventsBetween: defineTool({
      name: "events_between",
      description: "Logged events in a time range [from, to), optionally of one kind. Timestamps are ISO 8601.",
      inputSchema: z.object({ from: z.string(), to: z.string(), kind: EventKindSchema.optional() }),
      run: async ({ from, to, kind }) => JSON.stringify((await events.between(chatId, from, to, kind)).map(local)),
    }),
  };
}

export class DataAnswerer {
  constructor(
    private readonly agent: DataAgent,
    /** Null when no TypeSafe key is configured: the agent answers everything. */
    private readonly jev: TypeSafeClient | null,
    private readonly events: EventsRepository,
  ) {}

  /** Common questions cost one Jev call and one SQL query; only the rest reach the model. */
  /** If Jev is down, the model answers everything: slower and pricier, never unanswered. */
  async answer(chatId: number, question: string, now: Date, timeZone: string): Promise<string> {
    const common = await this.classify(question);
    if (common) return this.answerCommon(chatId, common, now, timeZone);
    return this.agent.answer(chatId, question, now, timeZone);
  }

  private async classify(question: string): Promise<CommonQuestion | null> {
    if (!this.jev) return null;
    try {
      const { answers } = await this.jev.systemOne({
        state: { question },
        questions: { kind: choice("Which question about the baby's log is this?", COMMON_QUESTION_DESCRIPTIONS) },
      });
      const { choice: kind, confidence } = answers.kind;
      return kind !== "other" && confidence >= COMMON_QUESTION_CONFIDENCE ? kind : null;
    } catch (error) {
      console.warn("jev unavailable, answering with the model", error);
      return null;
    }
  }

  private async answerCommon(chatId: number, question: CommonQuestion, now: Date, timeZone: string): Promise<string> {
    const kind = KIND_OF[question];
    if (!isToday(question)) return answerLast(kind, await this.events.last(chatId, kind), now, timeZone);
    const events = await this.events.between(chatId, startOfLocalDay(now, timeZone).toISOString(), now.toISOString(), kind);
    return answerToday(kind, events, now);
  }
}

export class ClaudeDataAgent implements DataAgent {
  constructor(
    private readonly client: Anthropic,
    private readonly events: EventsRepository,
  ) {}

  async answer(chatId: number, question: string, now: Date, timeZone: string): Promise<string> {
    const { lastEvent, eventsBetween } = logTools(this.events, chatId, timeZone);
    const message = await this.client.beta.messages.toolRunner({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      output_config: { effort: CLAUDE_EFFORT },
      system: DATA_SYSTEM,
      tools: [betaZodTool(lastEvent), betaZodTool(eventsBetween)],
      messages: [{ role: "user", content: dataQuestionMessage(question, now, timeZone) }],
    });

    return message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
  }
}
