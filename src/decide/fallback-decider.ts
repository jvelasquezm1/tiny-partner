import type { Decided, Decider } from "./decider.js";

/** Every decider failed: the bot cannot tell an urgent message from a routine one. */
export class DecidersUnavailableError extends Error {
  constructor(readonly causes: unknown[]) {
    super("no decider available");
    this.name = "DecidersUnavailableError";
  }
}

/**
 * Tries each decider in order (Jev: cheap, then Claude: pricier, same interface), so an outage
 * costs money instead of silence. When every one fails it throws DecidersUnavailableError and the
 * bot points to emergency services; wrap a single decider too, or its failure would go unanswered.
 */
export class FallbackDecider implements Decider {
  readonly name: string;
  private readonly deciders: Decider[];

  constructor(...deciders: [Decider, ...Decider[]]) {
    this.deciders = deciders;
    this.name = deciders.map((decider) => decider.name).join("→");
  }

  async decide(text: string): Promise<Decided> {
    const causes: unknown[] = [];
    for (const [i, decider] of this.deciders.entries()) {
      try {
        return await decider.decide(text);
      } catch (error) {
        causes.push(error);
        const next = this.deciders[i + 1];
        if (next) console.warn(`${decider.name} failed, falling back to ${next.name}`, error);
      }
    }
    throw new DecidersUnavailableError(causes);
  }
}
