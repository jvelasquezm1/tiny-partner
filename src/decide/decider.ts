export type Intent = "log_event" | "ask_about_data" | "ask_guidance" | "other";
export const INTENTS: readonly Intent[] = ["log_event", "ask_about_data", "ask_guidance", "other"];

export type Decision =
  | { type: "urgent"; probability: number }
  | { type: "route"; intent: Intent; confidence: number };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface Decided {
  decision: Decision;
  usage: Usage;
}

/** Decides what to do with a parent's message. Two implementations so the eval can compare them. */
export interface Decider {
  readonly name: string;
  decide(text: string): Promise<Decided>;
}

// Above this probability we never let a generative model answer: we send the fixed safety reply.
export const URGENT_THRESHOLD = 0.3;

export const URGENT_DESCRIPTION =
  "a symptom that may need urgent medical attention, such as fever in a newborn, trouble breathing, blue lips, unresponsiveness, dehydration or a seizure";

export const INTENT_DESCRIPTIONS: Record<Intent, string> = {
  log_event: "Record a feed, sleep or diaper that happened",
  ask_about_data: "A question about the baby's own logged feeds, sleep or diapers",
  ask_guidance: "A general baby care question that needs trusted guidance",
  other: "Anything else",
};
