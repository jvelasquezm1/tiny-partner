import { createPartFromFunctionResponse, createUserContent, type Content, type GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { DATA_SYSTEM, logTools, type DataAgent, type LogTool } from "../answer/data-answerer.js";
import { DECIDER_SYSTEM, DecisionSchema } from "../decide/claude-decider.js";
import type { Turn } from "../conversation.js";
import type { Decided, Decider } from "../decide/decider.js";
import { FOLLOW_UP_SYSTEM, FollowUpSchema, followUpPrompt, type FollowUpResolver } from "../decide/follow-up.js";
import { ExtractedEventSchema, type ExtractedEvent } from "../extract/event-schema.js";
import { EXTRACTION_SYSTEM, ExtractionError, extractionMessage } from "../extract/extract-event.js";
import { GUIDANCE_SYSTEM, type CitedText, type GroundedWriter } from "../rag/guidance-answerer.js";
import type { GuidanceChunk } from "../rag/guidance-repository.js";
import type { EventsRepository } from "../db/events-repository.js";

/**
 * Gemini stands in for Claude when only GEMINI_API_KEY is set: same prompts, schemas and tools,
 * so the bot behaves the same and the evals stay comparable. Flash: cheap enough for every step.
 */
export const GEMINI_MODEL = "gemini-3.8-flash";

// A runaway tool loop costs money and leaves the parent waiting: a data question needs two or three calls.
const MAX_TOOL_ROUNDS = 5;

/** Gemini accepts a subset of JSON Schema that does not include the `$schema` key Zod adds. */
function jsonSchema(schema: z.ZodType) {
  const { $schema: _, ...rest } = z.toJSONSchema(schema);
  return rest;
}

/** One call constrained to a Zod schema, validated again on our side. */
async function generateObject<S extends z.ZodType>(client: GoogleGenAI, schema: S, system: string, user: string) {
  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: user,
    config: { systemInstruction: system, responseMimeType: "application/json", responseJsonSchema: jsonSchema(schema) },
  });
  const parsed = response.text ? schema.safeParse(JSON.parse(response.text)) : null;
  return {
    output: parsed?.success ? parsed.data : null,
    finishReason: response.candidates?.[0]?.finishReason ?? null,
    usage: { inputTokens: response.usageMetadata?.promptTokenCount ?? 0, outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0 },
  };
}

export class GeminiDecider implements Decider {
  readonly name = GEMINI_MODEL;

  constructor(private readonly client: GoogleGenAI) {}

  async decide(text: string): Promise<Decided> {
    const { output, finishReason, usage } = await generateObject(this.client, DecisionSchema, DECIDER_SYSTEM, text);
    if (!output) throw new Error(`no decision (finish_reason: ${finishReason})`);
    return output.urgent
      ? { decision: { type: "urgent", probability: 1 }, usage }
      : { decision: { type: "route", intent: output.intent, confidence: 1 }, usage };
  }
}

export class GeminiFollowUpResolver implements FollowUpResolver {
  constructor(private readonly client: GoogleGenAI) {}

  async resolve(message: string, turns: Turn[]): Promise<string> {
    const { output } = await generateObject(this.client, FollowUpSchema, FOLLOW_UP_SYSTEM, followUpPrompt(message, turns));
    return output?.message.trim() || message;
  }
}

export class GeminiExtractor {
  constructor(private readonly client: GoogleGenAI) {}

  async extract(text: string, now: Date, timeZone: string): Promise<ExtractedEvent> {
    const user = extractionMessage(text, now, timeZone);
    const { output, finishReason } = await generateObject(this.client, ExtractedEventSchema, EXTRACTION_SYSTEM, user);
    if (!output) throw new ExtractionError(text, finishReason);
    return output;
  }
}

export class GeminiDataAgent implements DataAgent {
  constructor(
    private readonly client: GoogleGenAI,
    private readonly events: EventsRepository,
  ) {}

  async answer(chatId: number, question: string, now: Date, timeZone: string): Promise<string> {
    const tools: LogTool[] = Object.values(logTools(this.events, chatId));
    const config = {
      systemInstruction: DATA_SYSTEM,
      tools: [{ functionDeclarations: tools.map(({ name, description, inputSchema }) => ({ name, description, parametersJsonSchema: jsonSchema(inputSchema) })) }],
    };
    const contents: Content[] = [createUserContent(`Current time: ${now.toISOString()} (${timeZone})\nQuestion: ${question}`)];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.client.models.generateContent({ model: GEMINI_MODEL, contents, config });
      const calls = response.functionCalls;
      if (!calls?.length) return response.text?.trim() ?? "";

      // The model turn goes back as is: Gemini needs its own thought signatures to continue.
      const modelTurn = response.candidates?.[0]?.content;
      if (modelTurn) contents.push(modelTurn);
      const results = [];
      for (const call of calls) {
        const tool = tools.find((t) => t.name === call.name);
        const output = tool ? await tool.run(tool.inputSchema.parse(call.args ?? {})) : `unknown tool ${call.name}`;
        results.push(createPartFromFunctionResponse(call.id ?? "", call.name ?? "", { output }));
      }
      contents.push(createUserContent(results));
    }
    throw new Error(`no answer after ${MAX_TOOL_ROUNDS} tool rounds`);
  }
}

const CitedAnswerSchema = z.object({
  sentences: z.array(
    z.object({
      text: z.string(),
      passages: z.array(z.number().int()).describe("Numbers of the passages that support this sentence"),
    }),
  ),
});

/**
 * Gemini has no citations API like Claude's, so it reports which numbered passage backs each sentence.
 * Weaker than Claude's (self-reported, not tied to quoted spans), but a sentence citing nothing still
 * means no answer: renderWithCitations stays the gate.
 */
export class GeminiWriter implements GroundedWriter {
  constructor(private readonly client: GoogleGenAI) {}

  async write(question: string, passages: GuidanceChunk[]): Promise<CitedText[] | null> {
    const documents = passages.map((p, i) => `<passage number="${i + 1}" title="${p.sourceTitle}">\n${p.content}\n</passage>`).join("\n");
    const system = `${GUIDANCE_SYSTEM}\nSplit the answer into sentences and give, for each one, the numbers of the passages that support it.`;
    const { output } = await generateObject(this.client, CitedAnswerSchema, system, `${documents}\n\nQuestion: ${question}`);
    if (!output) return null;
    return output.sentences.map(({ text, passages: numbers }, i) => ({
      text: i === 0 ? text : ` ${text}`,
      documentIndexes: numbers.map((n) => n - 1),
    }));
  }
}
