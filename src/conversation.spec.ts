import { describe, expect, it } from "vitest";
import { Conversations } from "./conversation.js";

describe("Conversations", () => {
  it("keeps each chat's last six turns, cut to 500 characters", () => {
    const conversations = new Conversations();
    for (let i = 1; i <= 8; i++) conversations.add(7, i % 2 ? "parent" : "bot", `turn ${i}`, 0);
    conversations.add(7, "bot", "x".repeat(800), 0);
    const turns = conversations.recent(7, 0);
    expect(turns.map(({ text }) => text.slice(0, 6))).toEqual(["turn 4", "turn 5", "turn 6", "turn 7", "turn 8", "xxxxxx"]);
    expect(turns.at(-1)!.text).toHaveLength(500);
    expect(conversations.recent(8, 0)).toEqual([]);
  });

  it("forgets a chat 30 minutes after its last turn", () => {
    const conversations = new Conversations();
    conversations.add(7, "parent", "¿puedo dormir con el bebé en mi cama?", 0);
    expect(conversations.recent(7, 29 * 60_000)).toHaveLength(1);
    expect(conversations.recent(7, 31 * 60_000)).toEqual([]);
  });
});
