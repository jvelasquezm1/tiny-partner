/**
 * One Claude model for every step. The bot routes, extracts, rewrites follow-ups and answers in a few
 * short sentences from given passages or tool results: none of it needs deep reasoning, so Haiku 4.5
 * does it at a quarter of Opus 5.5's price. On the routing eval it matched Opus 5.5 (urgent recall
 * 7/7, no false urgencies, intent 25/25) and answered faster.
 * Haiku 4.5 takes no `effort` setting and is not one of the models server-side fallbacks are for.
 */
export const CLAUDE_MODEL = "claude-haiku-4-5";

/** List price per million tokens, for the evals' cost columns. Check anthropic.com/pricing before publishing. */
export const CLAUDE_USD_PER_MTOK = { input: 1, output: 5 };
