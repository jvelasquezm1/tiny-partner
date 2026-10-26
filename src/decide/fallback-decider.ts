import type { Decided, Decider } from "./decider.js";

/** Both deciders failed: the bot cannot tell an urgent message from a routine one. */
export class DecidersUnavailableError extends Error {
  constructor(readonly causes: unknown[]) {
    super("no decider available");
    this.name = "DecidersUnavailableError";
  }
}

/**
 * Tries the primary decider (Jev: cheap) and falls back to the secondary one (Claude: pricier,
 * same interface) when it fails, so an outage costs money instead of silence.
 */
export class FallbackDecider implements Decider {
  readonly name: string;

  constructor(
    private readonly primary: Decider,
    private readonly fallback: Decider,
  ) {
    this.name = `${primary.name}→${fallback.name}`;
  }

  async decide(text: string): Promise<Decided> {
    try {
      return await this.primary.decide(text);
    } catch (primaryError) {
      console.warn(`${this.primary.name} failed, falling back to ${this.fallback.name}`, primaryError);
      try {
        return await this.fallback.decide(text);
      } catch (fallbackError) {
        throw new DecidersUnavailableError([primaryError, fallbackError]);
      }
    }
  }
}
