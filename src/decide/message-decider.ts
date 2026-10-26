import { choice, noul, type TypeSafeClient } from "@typesafe-ai/sdk";

export type Intent = "log_event" | "ask_about_data" | "ask_guidance" | "other";

export type Decision =
  | { type: "urgent"; probability: number }
  | { type: "route"; intent: Intent; confidence: number };

// Above this probability we never let a generative model answer: we send the fixed safety reply.
export const URGENT_THRESHOLD = 0.3;

/**
 * System-1 decisions with Jev: cheap, typed, probabilistic. Claude only runs after we know what to do.
 */
export class MessageDecider {
  constructor(private readonly client: TypeSafeClient) {}

  async decide(text: string): Promise<Decision> {
    const { answers } = await this.client.systemOne({
      state: { message: text },
      questions: {
        urgent: noul(
          "Does the parent describe a symptom that may need urgent medical attention, such as fever in a newborn, trouble breathing, blue lips, unresponsiveness, dehydration or a seizure?",
        ),
        intent: choice("What does the parent want?", {
          log_event: "Record a feed, sleep or diaper that happened",
          ask_about_data: "A question about the baby's own logged feeds, sleep or diapers",
          ask_guidance: "A general baby care question that needs trusted guidance",
          other: "Anything else",
        }),
      },
    });

    if (answers.urgent.noul >= URGENT_THRESHOLD) {
      return { type: "urgent", probability: answers.urgent.noul };
    }
    return { type: "route", intent: answers.intent.choice, confidence: answers.intent.confidence };
  }
}
