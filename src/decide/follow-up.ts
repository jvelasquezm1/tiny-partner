import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Turn } from "../conversation.js";
import { CLAUDE_EFFORT, CLAUDE_MODEL } from "../models.js";

/** Rewrites a follow-up so it stands alone; every step after it reads only the rewritten message. */
export interface FollowUpResolver {
  resolve(message: string, turns: Turn[]): Promise<string>;
}

export const FOLLOW_UP_SYSTEM = `You read a parent's new message to a baby-care assistant together with their recent conversation.
If the message only makes sense with that conversation ("¿por qué no conmigo?", "¿y ayer?", "¿y de noche?"), rewrite it as one message that stands alone, in the parent's language, adding only what the conversation makes clear.
If it already stands alone, or starts a new topic, return it exactly as written.
Never drop, soften or add a symptom, and never answer the message: only rewrite it.`;

export const FollowUpSchema = z.object({ message: z.string().describe("The parent's message, standing alone") });

export function followUpPrompt(message: string, turns: Turn[]): string {
  const history = turns.map(({ role, text }) => `${role === "parent" ? "Parent" : "Assistant"}: ${text}`).join("\n");
  return `Conversation so far:\n${history}\n\nNew message: ${message}`;
}

// Runs before routing on every message that follows another, so it must be cheap and fast.
export class ClaudeFollowUpResolver implements FollowUpResolver {
  constructor(private readonly client: Anthropic) {}

  async resolve(message: string, turns: Turn[]): Promise<string> {
    const response = await this.client.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      output_config: { effort: CLAUDE_EFFORT, format: zodOutputFormat(FollowUpSchema) },
      system: FOLLOW_UP_SYSTEM,
      messages: [{ role: "user", content: followUpPrompt(message, turns) }],
    });
    return response.parsed_output?.message.trim() || message;
  }
}
