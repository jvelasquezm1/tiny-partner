import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { INTENT_DESCRIPTIONS, INTENTS, URGENT_DESCRIPTION, type Decided, type Decider, type Intent } from "./decider.js";

const DecisionSchema = z.object({
  urgent: z.boolean().describe(`True when the parent describes ${URGENT_DESCRIPTION}`),
  intent: z.enum(INTENTS as [Intent, ...Intent[]]),
});

const SYSTEM = `Classify a parent's message about their baby.
Intents:
${Object.entries(INTENT_DESCRIPTIONS).map(([intent, description]) => `- ${intent}: ${description}`).join("\n")}`;

/** LLM baseline for the router benchmark: same decision, made by a generative model. */
export class ClaudeDecider implements Decider {
  readonly name = "claude-opus-5-5";

  constructor(private readonly client: Anthropic) {}

  async decide(text: string): Promise<Decided> {
    const response = await this.client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 1024,
      output_config: { effort: "low", format: zodOutputFormat(DecisionSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: text }],
    });
    const parsed = response.parsed_output;
    if (!parsed) throw new Error(`no decision (stop_reason: ${response.stop_reason})`);

    const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    return parsed.urgent
      ? { decision: { type: "urgent", probability: 1 }, usage }
      : { decision: { type: "route", intent: parsed.intent, confidence: 1 }, usage };
  }
}
