import { choice, noul, type TypeSafeClient } from "@typesafe-ai/sdk";
import { INTENT_DESCRIPTIONS, URGENT_DESCRIPTION, URGENT_THRESHOLD, type Decided, type Decider } from "./decider.js";

/**
 * System-1 decisions with Jev: cheap, typed, probabilistic. Claude only runs after we know what to do.
 */
export class MessageDecider implements Decider {
  readonly name = "jev";

  constructor(private readonly client: TypeSafeClient) {}

  async decide(text: string): Promise<Decided> {
    const { answers, usage } = await this.client.systemOne({
      state: { message: text },
      questions: {
        urgent: noul(`Does the parent describe ${URGENT_DESCRIPTION}?`),
        intent: choice("What does the parent want?", INTENT_DESCRIPTIONS),
      },
    });
    const tokens = { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 };

    if (answers.urgent.noul >= URGENT_THRESHOLD) {
      return { decision: { type: "urgent", probability: answers.urgent.noul }, usage: tokens };
    }
    return {
      decision: { type: "route", intent: answers.intent.choice, confidence: answers.intent.confidence },
      usage: tokens,
    };
  }
}
