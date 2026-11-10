import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describeLocalTime } from "../local-time.js";
import { CLAUDE_EFFORT, CLAUDE_MODEL } from "../models.js";
import { ExtractedEventSchema, type ExtractedEvent } from "./event-schema.js";

// No worked example with concrete hours: Haiku copied one ("21:00 the day before") into unrelated messages.
export const EXTRACTION_SYSTEM = `You turn a parent's short message about their baby into one structured event.
The event already happened, so it never starts after the current local time you are given.
Resolve relative times ("an hour ago", "just now") against that time; no time at all means now. Write timestamps in that local time, with its UTC offset.
A clock time without am/pm means its most recent past occurrence.
Set ambiguousTime from the words alone: true when they leave open whether a clock time is morning or evening, even if one reading seems likelier.
Leave a field null when the message does not state it. Never guess amounts.`;

/** The user turn for every extractor. */
export function extractionMessage(text: string, now: Date, timeZone: string): string {
  return `Current local time: ${describeLocalTime(now, timeZone)}\nMessage: ${text}`;
}

export class EventExtractor {
  constructor(private readonly client: Anthropic) {}

  async extract(text: string, now: Date, timeZone: string): Promise<ExtractedEvent> {
    const response = await this.client.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      output_config: { effort: CLAUDE_EFFORT, format: zodOutputFormat(ExtractedEventSchema) },
      system: EXTRACTION_SYSTEM,
      messages: [{ role: "user", content: extractionMessage(text, now, timeZone) }],
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
