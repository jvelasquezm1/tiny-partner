/**
 * One Claude model for every step. The bot routes, extracts, rewrites follow-ups and answers in a few
 * short sentences from given passages or tool results: none of it needs deep reasoning. Haiku 5.5
 * does it at a tenth of Haiku 4.5's price for prompts under 100k tokens, which every prompt here is.
 * It has no server-side fallback: a refusal shows up as stop_reason "refusal" and is handled per step.
 */
export const CLAUDE_MODEL = "claude-haiku-5-5";

/**
 * Haiku 5.5 thinks adaptively by default; low effort keeps these short tasks short and fast. Its
 * thinking counts toward max_tokens, so calls leave room for it.
 */
export const CLAUDE_EFFORT = "low";

/** List price per million tokens, for the evals' cost columns. Check anthropic.com/pricing before publishing. */
export const CLAUDE_USD_PER_MTOK = { input: 0.1, output: 0.5 };
