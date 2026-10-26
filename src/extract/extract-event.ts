import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { BabyEventSchema, type BabyEvent } from "./event-schema.js";

// Haiku: extraction runs on every logged event, so it is the cheapest model that passes eval:extraction.
export const EXTRACTION_MODEL = "claude-haiku-4-5";

const SYSTEM = `You turn a parent's short message about their baby into one structured event.
Resolve relative times ("at 3", "an hour ago", "just now") against the current time you are given, in the parent's time zone.
A time without am/pm means the most recent past occurrence of that time.
Leave a field null when the message does not state it. Never guess amounts.`;

export class EventExtractor {
  constructor(private readonly client: Anthropic) {}

  async extract(text: string, now: Date, timeZone: string): Promise<BabyEvent> {
    const response = await this.client.messages.parse({
      model: EXTRACTION_MODEL,
      max_tokens: 1024,
      output_config: { format: zodOutputFormat(BabyEventSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: `Current time: ${now.toISOString()} (${timeZone})\nMessage: ${text}` }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new ExtractionError(text, response.stop_reason);
    }
    return response.parsed_output;
  }
}

export class ExtractionError extends Error {
  constructor(readonly sourceText: string, readonly stopReason: string | null) {
    super(`could not extract an event (stop_reason: ${stopReason})`);
    this.name = "ExtractionError";
  }
}
